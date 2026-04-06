import { sql, eq, and, inArray } from "drizzle-orm";
import { InferenceClient } from "@huggingface/inference";
import { db } from "#/db";
import { documentChunks, documents } from "#/db/schema";
import { MAX_CONTEXT_CHUNKS } from "@repo/shared";
import { env } from "#/lib/env";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "#/lib/embedding-config";

// ============================================
// Embedding provider for queries
// ============================================

export interface SimilarChunk {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  similarity: number;
  metadata: Record<string, unknown> | null;
}

// ============================================
// Similarity Search
// ============================================

/**
 * Find the most similar document chunks to a query string.
 * Uses pgvector cosine distance for similarity ranking.
 *
 * @param query - The search query
 * @param userId - The user's Clerk ID (to scope results)
 * @param options - Optional filters
 */
export async function findSimilarChunks(
  query: string,
  userId: string,
  options: {
    documentIds?: string[];
    limit?: number;
    minSimilarity?: number;
  } = {},
): Promise<SimilarChunk[]> {
  const {
    documentIds,
    limit = MAX_CONTEXT_CHUNKS,
    minSimilarity = 0.3,
  } = options;

  // 1. Embed the query via HuggingFace
  const hf = new InferenceClient(env().ai.huggingFaceApiKey);
  const result = await hf.featureExtraction({
    model: EMBEDDING_MODEL,
    inputs: query,
    provider: "hf-inference",
  });
  // featureExtraction for a single string returns a number[] (1D vector)
  const queryEmbedding = result as number[];
  if (queryEmbedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Query embedding dimension mismatch: expected ${EMBEDDING_DIMENSIONS}, received ${queryEmbedding.length}`,
    );
  }

  // 2. Build the vector similarity query
  // cosine distance: 1 - (a <=> b) gives similarity (0 to 1)
  const vectorStr = `[${queryEmbedding.join(",")}]`;

  const results = await db
    .select({
      id: documentChunks.id,
      documentId: documentChunks.documentId,
      content: documentChunks.content,
      chunkIndex: documentChunks.chunkIndex,
      metadata: documentChunks.metadata,
      similarity: sql<number>`1 - (${documentChunks.embedding} <=> ${vectorStr}::vector)`,
    })
    .from(documentChunks)
    .innerJoin(documents, eq(documentChunks.documentId, documents.id))
    .where(
      and(
        eq(documents.userId, userId),
        eq(documents.status, "ready"),
        sql`${documentChunks.embedding} IS NOT NULL`,
        sql`1 - (${documentChunks.embedding} <=> ${vectorStr}::vector) >= ${minSimilarity}`,
        ...(documentIds && documentIds.length > 0
          ? [inArray(documents.id, documentIds)]
          : []),
      ),
    )
    .orderBy(sql`${documentChunks.embedding} <=> ${vectorStr}::vector`)
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    content: r.content,
    chunkIndex: r.chunkIndex,
    similarity: r.similarity,
    metadata: r.metadata,
  }));
}

/**
 * Build a context string from similar chunks for use in AI prompts.
 */
export function buildContextFromChunks(chunks: SimilarChunk[]): string {
  if (chunks.length === 0) return "";

  return chunks
    .map(
      (chunk, i) =>
        `[Source ${i + 1}] (relevance: ${(chunk.similarity * 100).toFixed(0)}%)\n${chunk.content}`,
    )
    .join("\n\n---\n\n");
}
