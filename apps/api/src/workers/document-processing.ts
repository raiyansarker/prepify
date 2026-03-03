import { Worker, type Job } from "bullmq";
import { eq } from "drizzle-orm";
import { generateText, embedMany } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createHuggingFace } from "@ai-sdk/huggingface";
import { db } from "#/db";
import { documents, documentChunks } from "#/db/schema";
import { redisConnection } from "#/lib/redis";
import { QUEUE_NAMES } from "#/lib/queues";
import { chunkText } from "#/lib/chunking";
import { workerLogger } from "#/lib/logger";
import type { DocumentProcessingJob } from "@repo/shared";

// ============================================
// AI Providers (standalone, not via Effect for worker)
// ============================================

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const huggingface = createHuggingFace({
  apiKey: process.env.HUGGINGFACE_API_KEY,
});

// ============================================
// Text Extraction via AI
// ============================================

async function extractTextFromDocument(
  url: string,
  mimeType: string,
): Promise<string> {
  // For plain text, just fetch it
  if (mimeType === "text/plain") {
    const res = await fetch(url);
    return res.text();
  }

  // For PDFs and images, fetch the file and use AI to extract text
  const res = await fetch(url);
  const buffer = Buffer.from(await res.arrayBuffer());
  const base64 = buffer.toString("base64");

  if (mimeType === "application/pdf") {
    const { text } = await generateText({
      model: openrouter("z-ai/glm-4.5-air:free"),
      messages: [
        {
          role: "user" as const,
          content: [
            {
              type: "text" as const,
              text: "Extract ALL text content from this PDF document. Return ONLY the raw text, preserving the structure and paragraphs. Do not add commentary, summaries, or formatting instructions.",
            },
            {
              type: "file" as const,
              data: buffer,
              mediaType: "application/pdf",
            },
          ],
        },
      ],
      maxOutputTokens: 16000,
    });

    return text;
  }

  // For images, use OpenRouter with GLM-4.5
  if (mimeType.startsWith("image/")) {
    const { text } = await generateText({
      model: openrouter("z-ai/glm-4.5-air:free"),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract ALL text content visible in this image. If the image contains handwritten notes, diagrams with labels, or any readable text, transcribe it all. Return ONLY the raw text.",
            },
            {
              type: "image",
              image: `data:${mimeType};base64,${base64}`,
            },
          ],
        },
      ],
      maxOutputTokens: 8000,
    });

    return text;
  }

  throw new Error(`Unsupported mime type: ${mimeType}`);
}

// ============================================
// Embedding Generation
// ============================================

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const { embeddings } = await embedMany({
    model: huggingface.textEmbeddingModel(
      "sentence-transformers/all-mpnet-base-v2",
    ),
    values: texts,
  });

  return embeddings;
}

// ============================================
// Document Processing Worker
// ============================================

const worker = new Worker<DocumentProcessingJob>(
  QUEUE_NAMES.DOCUMENT_PROCESSING,
  async (job: Job<DocumentProcessingJob>) => {
    const { documentId } = job.data;

    workerLogger.info({ documentId }, "Processing document");

    // 1. Fetch document record
    const doc = await db.query.documents.findFirst({
      where: eq(documents.id, documentId),
    });

    if (!doc) {
      throw new Error(`Document ${documentId} not found`);
    }

    // 2. Mark as processing
    await db
      .update(documents)
      .set({ status: "processing", updatedAt: new Date() })
      .where(eq(documents.id, documentId));

    await job.updateProgress(10);

    try {
      // 3. Extract text via AI
      const extractedText = await extractTextFromDocument(
        doc.s3Url,
        doc.mimeType || "application/octet-stream",
      );
      console.log("🚀 ~ extractedText:", extractedText);

      if (!extractedText.trim()) {
        throw new Error("No text could be extracted from document");
      }

      await job.updateProgress(40);

      // 4. Chunk the text
      const chunks = chunkText(extractedText);

      if (chunks.length === 0) {
        throw new Error("Text chunking produced no chunks");
      }

      await job.updateProgress(50);

      // 5. Generate embeddings for all chunks
      const chunkTexts = chunks.map((c) => c.content);
      const embeddings = await generateEmbeddings(chunkTexts);

      await job.updateProgress(80);

      // 6. Store chunks with embeddings in DB
      const chunkRecords = chunks.map((chunk, i) => ({
        documentId,
        content: chunk.content,
        embedding: embeddings[i] ?? null,
        chunkIndex: chunk.chunkIndex,
        metadata: chunk.metadata as Record<string, unknown>,
      }));

      // Insert in batches of 50 to avoid overwhelming the DB
      const BATCH_SIZE = 50;
      for (let i = 0; i < chunkRecords.length; i += BATCH_SIZE) {
        const batch = chunkRecords.slice(i, i + BATCH_SIZE);
        await db.insert(documentChunks).values(batch);
      }

      await job.updateProgress(95);

      // 7. Mark document as ready
      await db
        .update(documents)
        .set({
          status: "ready",
          pageCount: chunks.length,
          updatedAt: new Date(),
        })
        .where(eq(documents.id, documentId));

      await job.updateProgress(100);

      workerLogger.info(
        { documentId, chunks: chunks.length },
        "Document processed successfully",
      );

      return { chunks: chunks.length };
    } catch (error) {
      // Mark document as failed
      await db
        .update(documents)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(documents.id, documentId));

      workerLogger.error(
        { err: error, documentId },
        "Document processing failed",
      );
      throw error;
    }
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
