import { Worker, type Job } from "bullmq";
import { Effect, Layer, Schedule } from "effect";
import { eq, and, isNotNull } from "drizzle-orm";
import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { db } from "#/db";
import { documents, documentChunks } from "#/db/schema";
import { redisConnection } from "#/lib/redis";
import { QUEUE_NAMES } from "#/lib/queues";
import { chunkText, type TextChunk } from "#/lib/chunking";
import { workerLogger } from "#/lib/logger";
import { env } from "#/lib/env";
import {
  DocumentProcessingError,
  DatabaseError,
  type RateLimitError,
  type ExternalServiceError,
} from "#/lib/errors";
import { LogLayer } from "#/lib/logger";
import { EmbeddingService, EmbeddingServiceLive } from "#/services/embedding";
import type { DocumentProcessingJob } from "@repo/shared";

// ============================================
// AI Providers
// ============================================

const google = createGoogleGenerativeAI({
  apiKey: env().ai.googleApiKey,
});

// ============================================
// Retry schedule for transient AI/network failures
// ============================================

const transientRetry = Schedule.exponential("2 seconds").pipe(
  Schedule.compose(Schedule.recurs(3)),
);

// ============================================
// Worker Layer — EmbeddingService + Logging
// ============================================

const WorkerLayer = Layer.mergeAll(EmbeddingServiceLive, LogLayer);

// ============================================
// Pipeline Steps — each is an Effect with tagged errors
// ============================================

/** Step 1: Fetch the document record from the DB */
const fetchDocument = (documentId: string) =>
  Effect.tryPromise({
    try: () =>
      db.query.documents.findFirst({
        where: eq(documents.id, documentId),
      }),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to fetch document record", cause }),
  }).pipe(
    Effect.flatMap((doc) =>
      doc
        ? Effect.succeed(doc)
        : Effect.fail(
            new DocumentProcessingError({
              documentId,
              message: `Document ${documentId} not found`,
            }),
          ),
    ),
  );

/** Step 2: Mark document status in DB */
const updateDocumentStatus = (
  documentId: string,
  status: "processing" | "ready" | "failed",
  extra?: Record<string, unknown>,
) =>
  Effect.tryPromise({
    try: () =>
      db
        .update(documents)
        .set({ status, updatedAt: new Date(), ...extra })
        .where(eq(documents.id, documentId)),
    catch: (cause) =>
      new DatabaseError({
        message: `Failed to update document status to ${status}`,
        cause,
      }),
  });

/** Step 3a: Fetch file content from URL */
const fetchFileContent = (url: string, mimeType: string, documentId: string) =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      if (mimeType === "text/plain") {
        return { text: await res.text(), buffer: null };
      }
      return { text: null, buffer: Buffer.from(await res.arrayBuffer()) };
    },
    catch: (cause) =>
      new DocumentProcessingError({
        documentId,
        message: "Failed to fetch document file",
        cause,
      }),
  });

/** Step 3b: Extract text from a file buffer using Gemini */
const extractTextWithGemini = (
  fileBuffer: Buffer,
  mimeType: string,
  documentId: string,
) =>
  Effect.tryPromise({
    try: async () => {
      const { text } = await generateText({
        model: google("gemini-2.5-flash"),
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract all text from this document exactly as it appears. Preserve the original formatting, paragraphs, and structure. Return only the extracted text with no commentary, headers, or explanations.",
              },
              {
                type: "file",
                data: fileBuffer,
                mediaType: mimeType as
                  | "application/pdf"
                  | "image/jpeg"
                  | "image/png"
                  | "image/gif"
                  | "image/webp",
              },
            ],
          },
        ],
      });
      return text.trim();
    },
    catch: (cause) =>
      new DocumentProcessingError({
        documentId,
        message: "Gemini text extraction failed",
        cause,
      }),
  }).pipe(Effect.retry(transientRetry));

/** Step 3: Full text extraction dispatcher */
const extractText = (url: string, mimeType: string, documentId: string) =>
  Effect.gen(function* () {
    const file = yield* fetchFileContent(url, mimeType, documentId);

    // Plain text — already have the text
    if (file.text !== null) {
      return file.text;
    }

    // PDF or image — use Gemini
    if (mimeType === "application/pdf" || mimeType.startsWith("image/")) {
      return yield* extractTextWithGemini(file.buffer!, mimeType, documentId);
    }

    return yield* Effect.fail(
      new DocumentProcessingError({
        documentId,
        message: `Unsupported mime type: ${mimeType}`,
      }),
    );
  });

// ============================================
// Checkpoint-aware helpers
// ============================================

/**
 * Ensure extracted text is available. If the document already has
 * `extractedText` persisted (from a previous partial run), skip the
 * expensive Gemini extraction and return the cached value.
 */
const ensureTextExtracted = (doc: {
  id: string;
  s3Url: string;
  mimeType: string | null;
  extractedText: string | null;
}) =>
  Effect.gen(function* () {
    if (doc.extractedText) {
      yield* Effect.logInfo(
        "Using cached extracted text (checkpoint hit)",
      ).pipe(
        Effect.annotateLogs("documentId", doc.id),
        Effect.annotateLogs("textLength", String(doc.extractedText.length)),
      );
      return doc.extractedText;
    }

    // Extract text fresh
    const text = yield* extractText(
      doc.s3Url,
      doc.mimeType || "application/octet-stream",
      doc.id,
    );

    // Persist to DB as checkpoint
    yield* Effect.tryPromise({
      try: () =>
        db
          .update(documents)
          .set({ extractedText: text, updatedAt: new Date() })
          .where(eq(documents.id, doc.id)),
      catch: (cause) =>
        new DatabaseError({
          message: "Failed to persist extractedText checkpoint",
          cause,
        }),
    });

    yield* Effect.logInfo("Text extracted and checkpointed").pipe(
      Effect.annotateLogs("documentId", doc.id),
      Effect.annotateLogs("textLength", String(text.length)),
    );

    return text;
  });

/** Step 4: Chunk the extracted text */
const chunkExtractedText = (text: string, documentId: string) =>
  Effect.gen(function* () {
    if (!text.trim()) {
      return yield* Effect.fail(
        new DocumentProcessingError({
          documentId,
          message: "No text could be extracted from document",
        }),
      );
    }

    const chunks = chunkText(text);

    if (chunks.length === 0) {
      return yield* Effect.fail(
        new DocumentProcessingError({
          documentId,
          message: "Text chunking produced no chunks",
        }),
      );
    }

    yield* Effect.logDebug("Text chunked").pipe(
      Effect.annotateLogs("documentId", documentId),
      Effect.annotateLogs("chunkCount", String(chunks.length)),
    );

    return chunks;
  });

/**
 * Fetch existing chunk indices that already have embeddings in the DB.
 * Used to skip re-embedding on retry.
 */
const fetchExistingChunkIndices = (documentId: string) =>
  Effect.tryPromise({
    try: async () => {
      const rows = await db
        .select({ chunkIndex: documentChunks.chunkIndex })
        .from(documentChunks)
        .where(
          and(
            eq(documentChunks.documentId, documentId),
            isNotNull(documentChunks.embedding),
          ),
        );
      return new Set(rows.map((r) => r.chunkIndex));
    },
    catch: (cause) =>
      new DatabaseError({
        message: "Failed to fetch existing chunk indices",
        cause,
      }),
  });

/**
 * Ensure all chunks have embeddings. On retry, only embeds chunks that
 * are missing from the DB, avoiding redundant API calls.
 *
 * Returns the full set of chunks and their embeddings (existing + new).
 */
const ensureChunksEmbedded = (documentId: string, chunks: TextChunk[]) =>
  Effect.gen(function* () {
    const embeddingService = yield* EmbeddingService;
    const existingIndices = yield* fetchExistingChunkIndices(documentId);

    // Partition chunks into already-embedded vs missing
    const missingChunks = chunks.filter(
      (c) => !existingIndices.has(c.chunkIndex),
    );

    if (missingChunks.length === 0) {
      yield* Effect.logInfo(
        "All chunks already embedded (checkpoint hit)",
      ).pipe(
        Effect.annotateLogs("documentId", documentId),
        Effect.annotateLogs("totalChunks", String(chunks.length)),
      );
      return {
        missingChunks: [] as TextChunk[],
        newEmbeddings: [] as number[][],
      };
    }

    yield* Effect.logInfo(
      `Embedding ${missingChunks.length}/${chunks.length} chunks (${existingIndices.size} already done)`,
    ).pipe(Effect.annotateLogs("documentId", documentId));

    const missingTexts = missingChunks.map((c) => c.content);

    // Use EmbeddingService which handles rate limiting internally
    const newEmbeddings = yield* embeddingService.embedAll(missingTexts);

    yield* Effect.logInfo("Embeddings generated").pipe(
      Effect.annotateLogs("documentId", documentId),
      Effect.annotateLogs("newEmbeddings", String(newEmbeddings.length)),
    );

    return { missingChunks, newEmbeddings };
  });

/** Store only the newly-embedded chunks in DB (batched inserts) */
const storeNewChunks = (
  documentId: string,
  missingChunks: TextChunk[],
  newEmbeddings: number[][],
) =>
  Effect.gen(function* () {
    if (missingChunks.length === 0) return;

    const chunkRecords = missingChunks.map((chunk, i) => ({
      documentId,
      content: chunk.content,
      embedding: newEmbeddings[i] ?? null,
      chunkIndex: chunk.chunkIndex,
      metadata: chunk.metadata as Record<string, unknown>,
    }));

    const BATCH_SIZE = 50;
    for (let i = 0; i < chunkRecords.length; i += BATCH_SIZE) {
      const batch = chunkRecords.slice(i, i + BATCH_SIZE);
      yield* Effect.tryPromise({
        try: () => db.insert(documentChunks).values(batch),
        catch: (cause) =>
          new DatabaseError({
            message: `Failed to insert chunk batch at offset ${i}`,
            cause,
          }),
      });
    }

    yield* Effect.logDebug("New chunks stored in DB").pipe(
      Effect.annotateLogs("documentId", documentId),
      Effect.annotateLogs("storedChunks", String(chunkRecords.length)),
    );
  });

// ============================================
// Main processing pipeline (checkpoint-aware)
// ============================================
//
// On retry (BullMQ attempts > 1), the pipeline:
// - Re-fetches the document (cheap DB read)
// - SKIPS text extraction if extractedText is already persisted
// - Re-derives chunks (deterministic, CPU-only, fast)
// - SKIPS embedding for chunks that already exist in document_chunks with embeddings
// - Only stores newly-embedded chunks

const processDocument = (
  documentId: string,
  reportProgress: (pct: number) => Promise<void>,
) =>
  Effect.gen(function* () {
    yield* Effect.logInfo("Processing document").pipe(
      Effect.annotateLogs("documentId", documentId),
    );

    // 1. Fetch document record
    const doc = yield* fetchDocument(documentId);

    // 2. Mark as processing
    yield* updateDocumentStatus(documentId, "processing");
    yield* Effect.tryPromise({
      try: () => reportProgress(10),
      catch: () =>
        new DocumentProcessingError({
          documentId,
          message: "Failed to report progress",
        }),
    });

    // 3. Extract text (checkpoint-aware: skips if already persisted)
    const extractedText = yield* ensureTextExtracted(doc);
    yield* Effect.tryPromise({
      try: () => reportProgress(40),
      catch: () =>
        new DocumentProcessingError({
          documentId,
          message: "Failed to report progress",
        }),
    });

    // 4. Chunk the text (always re-derive — fast and deterministic)
    const chunks = yield* chunkExtractedText(extractedText, documentId);
    yield* Effect.tryPromise({
      try: () => reportProgress(50),
      catch: () =>
        new DocumentProcessingError({
          documentId,
          message: "Failed to report progress",
        }),
    });

    // 5. Generate embeddings (checkpoint-aware: skips already-embedded chunks)
    const { missingChunks, newEmbeddings } = yield* ensureChunksEmbedded(
      documentId,
      chunks,
    );
    yield* Effect.tryPromise({
      try: () => reportProgress(80),
      catch: () =>
        new DocumentProcessingError({
          documentId,
          message: "Failed to report progress",
        }),
    });

    // 6. Store only newly-embedded chunks in DB
    yield* storeNewChunks(documentId, missingChunks, newEmbeddings);
    yield* Effect.tryPromise({
      try: () => reportProgress(95),
      catch: () =>
        new DocumentProcessingError({
          documentId,
          message: "Failed to report progress",
        }),
    });

    // 7. Mark document as ready
    yield* updateDocumentStatus(documentId, "ready", {
      pageCount: chunks.length,
    });
    yield* Effect.tryPromise({
      try: () => reportProgress(100),
      catch: () =>
        new DocumentProcessingError({
          documentId,
          message: "Failed to report progress",
        }),
    });

    yield* Effect.logInfo("Document processed successfully").pipe(
      Effect.annotateLogs("documentId", documentId),
      Effect.annotateLogs("chunks", String(chunks.length)),
      Effect.annotateLogs("newlyEmbedded", String(missingChunks.length)),
    );

    return { chunks: chunks.length, newlyEmbedded: missingChunks.length };
  }).pipe(
    // On any failure, try to mark the document as failed in the DB
    Effect.tapError((error) =>
      Effect.gen(function* () {
        yield* Effect.logError("Document processing failed").pipe(
          Effect.annotateLogs("documentId", documentId),
          Effect.annotateLogs("error", String(error)),
        );

        // Best-effort update to "failed" — don't fail again if this fails
        yield* updateDocumentStatus(documentId, "failed").pipe(
          Effect.catchAll(() => Effect.void),
        );
      }),
    ),
  );

// ============================================
// BullMQ Worker — runs the Effect pipeline
// ============================================

const worker = new Worker<DocumentProcessingJob>(
  QUEUE_NAMES.DOCUMENT_PROCESSING,
  async (job: Job<DocumentProcessingJob>) => {
    const { documentId } = job.data;

    return Effect.runPromise(
      processDocument(documentId, (pct) => job.updateProgress(pct)).pipe(
        Effect.provide(WorkerLayer),
      ),
    );
  },
  {
    connection: redisConnection,
    concurrency: 3,
  },
);

worker.on("completed", (job, returnvalue) => {
  workerLogger.info({ jobId: job.id, result: returnvalue }, "Job completed");
});

worker.on("failed", (job, error) => {
  workerLogger.error({ jobId: job?.id, err: error }, "Job failed");
});

worker.on("error", (err) => {
  workerLogger.error({ err }, "Worker error");
});

workerLogger.info("Document processing worker running");
