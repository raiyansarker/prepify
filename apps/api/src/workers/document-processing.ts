import { Worker, type Job } from "bullmq";
import { Effect, Schedule } from "effect";
import { eq } from "drizzle-orm";
import { embedMany, generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { db } from "#/db";
import { documents, documentChunks } from "#/db/schema";
import { redisConnection } from "#/lib/redis";
import { QUEUE_NAMES } from "#/lib/queues";
import { chunkText, type TextChunk } from "#/lib/chunking";
import { workerLogger } from "#/lib/logger";
import { env } from "#/lib/env";
import { DocumentProcessingError, DatabaseError } from "#/lib/errors";
import { LogLayer } from "#/lib/logger";
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

/** Step 5: Generate embeddings for chunk texts (batched, with retry) */
const generateEmbeddings = (chunks: TextChunk[], documentId: string) =>
  Effect.gen(function* () {
    const texts = chunks.map((c) => c.content);
    if (texts.length === 0) return [] as number[][];

    const EMBED_BATCH_SIZE = 100;
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
      const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
      const batchNum = Math.floor(i / EMBED_BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(texts.length / EMBED_BATCH_SIZE);

      yield* Effect.logDebug(
        `Embedding batch ${batchNum}/${totalBatches}`,
      ).pipe(
        Effect.annotateLogs("documentId", documentId),
        Effect.annotateLogs("batchSize", String(batch.length)),
      );

      const embeddings = yield* Effect.tryPromise({
        try: async () => {
          const { embeddings } = await embedMany({
            model: google.embeddingModel("gemini-embedding-001"),
            values: batch,
            providerOptions: {
              google: { outputDimensionality: 768 },
            },
          });
          return embeddings;
        },
        catch: (cause) =>
          new DocumentProcessingError({
            documentId,
            message: `Embedding generation failed (batch ${batchNum})`,
            cause,
          }),
      }).pipe(Effect.retry(transientRetry));

      allEmbeddings.push(...embeddings);
    }

    return allEmbeddings;
  });

/** Step 6: Store chunks with embeddings in DB (batched inserts) */
const storeChunks = (
  documentId: string,
  chunks: TextChunk[],
  embeddings: number[][],
) =>
  Effect.gen(function* () {
    const chunkRecords = chunks.map((chunk, i) => ({
      documentId,
      content: chunk.content,
      embedding: embeddings[i] ?? null,
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

    yield* Effect.logDebug("Chunks stored in DB").pipe(
      Effect.annotateLogs("documentId", documentId),
      Effect.annotateLogs("totalChunks", String(chunkRecords.length)),
    );
  });

// ============================================
// Main processing pipeline
// ============================================

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

    // 3. Extract text
    const extractedText = yield* extractText(
      doc.s3Url,
      doc.mimeType || "application/octet-stream",
      documentId,
    );
    yield* Effect.tryPromise({
      try: () => reportProgress(40),
      catch: () =>
        new DocumentProcessingError({
          documentId,
          message: "Failed to report progress",
        }),
    });

    yield* Effect.logInfo("Text extracted").pipe(
      Effect.annotateLogs("documentId", documentId),
      Effect.annotateLogs("textLength", String(extractedText.length)),
    );

    // 4. Chunk the text
    const chunks = yield* chunkExtractedText(extractedText, documentId);
    yield* Effect.tryPromise({
      try: () => reportProgress(50),
      catch: () =>
        new DocumentProcessingError({
          documentId,
          message: "Failed to report progress",
        }),
    });

    // 5. Generate embeddings
    const embeddings = yield* generateEmbeddings(chunks, documentId);
    yield* Effect.tryPromise({
      try: () => reportProgress(80),
      catch: () =>
        new DocumentProcessingError({
          documentId,
          message: "Failed to report progress",
        }),
    });

    yield* Effect.logInfo("Embeddings generated").pipe(
      Effect.annotateLogs("documentId", documentId),
      Effect.annotateLogs("embeddingCount", String(embeddings.length)),
    );

    // 6. Store chunks in DB
    yield* storeChunks(documentId, chunks, embeddings);
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
    );

    return { chunks: chunks.length };
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
        Effect.provide(LogLayer),
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
