import { Context, Duration, Effect, Layer } from "effect";
import { InferenceClient } from "@huggingface/inference";
import { env } from "#/lib/env";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "#/lib/embedding-config";
import { RateLimitError, ExternalServiceError } from "#/lib/errors";

// ============================================
// Embedding Service
// ============================================
// Provides rate-limit-aware embedding generation via HuggingFace Inference API
// using BAAI/bge-large-en-v1.5 (1024-dimensional embeddings).
//
// Key features:
// - Global Semaphore(1): serializes all embedding API calls across
//   concurrent BullMQ workers (concurrency=3) so only one batch
//   hits the API at a time.
// - 1-second spacing between batches.
// - 429-aware retry: on rate limit, waits the exact duration the API specifies
//   then retries. Retries indefinitely until the embedding succeeds.
// - Exponential backoff + jitter for transient errors (up to 3 retries).

const EMBED_BATCH_SIZE = 100;

// ============================================
// Rate-limit detection & retry delay parsing
// ============================================

const DEFAULT_RATE_LIMIT_DELAY_MS = 60_000;
const MAX_TRANSIENT_RETRIES = 3;

/**
 * Checks whether an error from HuggingFace is a 429 rate-limit response.
 * HuggingFace's InferenceClientProviderApiError has `httpResponse.status`.
 */
const isRateLimitError = (err: unknown): boolean => {
  if (err == null || typeof err !== "object") return false;

  // Check HuggingFace error structure: httpResponse.status === 429
  if ("httpResponse" in err) {
    const resp = (err as { httpResponse: { status?: number } }).httpResponse;
    if (resp?.status === 429) return true;
  }

  // Check generic statusCode field (duck typing)
  if (
    "statusCode" in err &&
    (err as { statusCode: number }).statusCode === 429
  ) {
    return true;
  }

  // Check error message as fallback (covers wrapped errors)
  const msg =
    "message" in err ? String((err as { message: string }).message) : "";
  if (
    msg.includes("429") ||
    msg.toLowerCase().includes("rate limit") ||
    msg.toLowerCase().includes("quota exceeded") ||
    msg.toLowerCase().includes("too many requests")
  ) {
    return true;
  }

  // Check nested cause
  if ("cause" in err) {
    return isRateLimitError((err as { cause: unknown }).cause);
  }

  return false;
};

/**
 * Extracts the retry delay (in ms) from a rate-limit error.
 *
 * Checks, in order:
 * 1. HuggingFace httpResponse.body for `estimated_time` field
 * 2. HuggingFace httpResponse.body for retry delay patterns
 * 3. Error message for retry delay patterns
 * 4. Falls back to DEFAULT_RATE_LIMIT_DELAY_MS (60s)
 *
 * Adds a 2-second buffer to account for clock skew.
 */
const parseRetryDelayMs = (err: unknown): number => {
  const BUFFER_MS = 2_000;

  if (err == null || typeof err !== "object")
    return DEFAULT_RATE_LIMIT_DELAY_MS;

  // 1. Check HuggingFace httpResponse.body
  if ("httpResponse" in err) {
    const resp = (err as { httpResponse: { body?: unknown } }).httpResponse;
    if (resp?.body != null) {
      const bodyStr =
        typeof resp.body === "string" ? resp.body : JSON.stringify(resp.body);

      // Check for estimated_time field (HuggingFace specific)
      try {
        const parsed =
          typeof resp.body === "string" ? JSON.parse(resp.body) : resp.body;
        if (
          parsed &&
          typeof parsed === "object" &&
          "estimated_time" in parsed
        ) {
          const secs = Number.parseFloat(String(parsed.estimated_time));
          if (!Number.isNaN(secs) && secs > 0) {
            return Math.ceil(secs * 1_000) + BUFFER_MS;
          }
        }
      } catch {
        // Not valid JSON, continue
      }

      // Check for retry-after patterns in body
      const bodyMatch = bodyStr.match(
        /retry[\s-]*(?:in|after)\s+([\d.]+)\s*s/i,
      );
      if (bodyMatch) {
        const secs = Number.parseFloat(bodyMatch[1]!);
        if (!Number.isNaN(secs) && secs > 0) {
          return Math.ceil(secs * 1_000) + BUFFER_MS;
        }
      }
    }
  }

  // 2. Parse from error message
  const msg =
    "message" in err ? String((err as { message: string }).message) : "";
  const msgMatch = msg.match(/retry[\s-]*(?:in|after)\s+([\d.]+)\s*s/i);
  if (msgMatch) {
    const secs = Number.parseFloat(msgMatch[1]!);
    if (!Number.isNaN(secs) && secs > 0) {
      return Math.ceil(secs * 1_000) + BUFFER_MS;
    }
  }

  // 3. Check nested cause
  if ("cause" in err) {
    const nested = parseRetryDelayMs((err as { cause: unknown }).cause);
    if (nested !== DEFAULT_RATE_LIMIT_DELAY_MS) return nested;
  }

  return DEFAULT_RATE_LIMIT_DELAY_MS;
};

// ============================================
// Service interface
// ============================================

export class EmbeddingService extends Context.Tag("EmbeddingService")<
  EmbeddingService,
  {
    /**
     * Embed a single batch of texts (up to EMBED_BATCH_SIZE).
     * Callers should prefer `embedAll` for larger sets.
     */
    readonly embedBatch: (
      texts: string[],
    ) => Effect.Effect<number[][], RateLimitError | ExternalServiceError>;

    /**
     * Embed an arbitrary number of texts, automatically batching and
     * spacing API calls. Handles rate limits internally.
     */
    readonly embedAll: (
      texts: string[],
      batchSize?: number,
    ) => Effect.Effect<number[][], RateLimitError | ExternalServiceError>;
  }
>() {}

// ============================================
// Live implementation
// ============================================

export const EmbeddingServiceLive = Layer.effect(
  EmbeddingService,
  Effect.gen(function* () {
    const hf = new InferenceClient(env().ai.huggingFaceApiKey);

    // Global semaphore: only 1 embedding API call at a time across all workers
    const semaphore = yield* Effect.makeSemaphore(1);

    /**
     * Raw embedding call (no retry). Used as the base for retry wrappers.
     * Calls HuggingFace featureExtraction with BAAI/bge-large-en-v1.5.
     */
    const embedBatchRaw = (
      texts: string[],
    ): Effect.Effect<number[][], RateLimitError | ExternalServiceError> =>
      Effect.tryPromise({
        try: async () => {
          const result = await hf.featureExtraction({
            model: EMBEDDING_MODEL,
            inputs: texts,
            provider: "hf-inference",
          });
          const embeddings =
            Array.isArray(result) &&
            result.length > 0 &&
            typeof result[0] === "number"
              ? [result as number[]]
              : (result as number[][]);
          if (
            !Array.isArray(embeddings) ||
            embeddings.length !== texts.length
          ) {
            throw new Error(
              `Embedding response shape mismatch: expected ${texts.length} vectors`,
            );
          }
          for (const [index, vector] of embeddings.entries()) {
            if (
              !Array.isArray(vector) ||
              vector.length !== EMBEDDING_DIMENSIONS
            ) {
              throw new Error(
                `Embedding dimension mismatch at index ${index}: expected ${EMBEDDING_DIMENSIONS}, received ${Array.isArray(vector) ? vector.length : "non-array"}`,
              );
            }
          }
          return embeddings;
        },
        catch: (cause) => {
          console.log("🚀 ~ cause:", cause);
          if (isRateLimitError(cause)) {
            const retryAfterMs = parseRetryDelayMs(cause);
            return new RateLimitError({
              service: EMBEDDING_MODEL,
              message: `Embedding API rate limit exceeded — will retry in ${(retryAfterMs / 1_000).toFixed(1)}s`,
              retryAfterMs,
              cause,
            });
          }
          return new ExternalServiceError({
            service: EMBEDDING_MODEL,
            message: "Embedding generation failed",
            cause,
          });
        },
      });

    /**
     * Retry wrapper for rate-limit errors.
     * Reads the parsed `retryAfterMs` from each `RateLimitError` and sleeps
     * exactly that long before retrying. Retries indefinitely — the embedding
     * will eventually complete once the rate limit window resets.
     */
    const withRateLimitRetry = (
      texts: string[],
      attempt: number = 0,
    ): Effect.Effect<number[][], RateLimitError | ExternalServiceError> =>
      embedBatchRaw(texts).pipe(
        Effect.catchTag("RateLimitError", (err) => {
          const delayMs = err.retryAfterMs ?? DEFAULT_RATE_LIMIT_DELAY_MS;
          return Effect.logWarning(
            `Rate limited (attempt ${attempt + 1}): sleeping ${(delayMs / 1_000).toFixed(1)}s`,
          ).pipe(
            Effect.flatMap(() => Effect.sleep(Duration.millis(delayMs))),
            Effect.flatMap(() => withRateLimitRetry(texts, attempt + 1)),
          );
        }),
      );

    /**
     * Retry wrapper for transient (non-rate-limit) errors.
     * Uses exponential backoff: 2s, 4s, 8s with jitter.
     */
    const withTransientRetry = (
      texts: string[],
      attempt: number = 0,
    ): Effect.Effect<number[][], RateLimitError | ExternalServiceError> =>
      withRateLimitRetry(texts).pipe(
        Effect.catchTag("ExternalServiceError", (err) => {
          if (attempt >= MAX_TRANSIENT_RETRIES) {
            return Effect.fail(err);
          }
          const baseMs = 2_000 * Math.pow(2, attempt);
          const jitter = Math.random() * baseMs * 0.5;
          const delayMs = baseMs + jitter;
          return Effect.logWarning(
            `Transient error (attempt ${attempt + 1}/${MAX_TRANSIENT_RETRIES}): retrying in ${(delayMs / 1_000).toFixed(1)}s — ${err.message}`,
          ).pipe(
            Effect.flatMap(() => Effect.sleep(Duration.millis(delayMs))),
            Effect.flatMap(() => withTransientRetry(texts, attempt + 1)),
          );
        }),
      );

    /**
     * Core single-batch embedding call.
     * Wrapped in the semaphore — only one in-flight at a time.
     */
    const embedBatchCore = (
      texts: string[],
    ): Effect.Effect<number[][], RateLimitError | ExternalServiceError> =>
      semaphore.withPermits(1)(withTransientRetry(texts));

    /**
     * Embed all texts with automatic batching + inter-batch spacing.
     */
    const embedAllTexts = (
      texts: string[],
      batchSize: number = EMBED_BATCH_SIZE,
    ): Effect.Effect<number[][], RateLimitError | ExternalServiceError> =>
      Effect.gen(function* () {
        if (texts.length === 0) return [] as number[][];

        const allEmbeddings: number[][] = [];
        const totalBatches = Math.ceil(texts.length / batchSize);

        for (let i = 0; i < texts.length; i += batchSize) {
          const batch = texts.slice(i, i + batchSize);
          const batchNum = Math.floor(i / batchSize) + 1;

          yield* Effect.logDebug(
            `Embedding batch ${batchNum}/${totalBatches} (${batch.length} texts)`,
          );

          const embeddings = yield* embedBatchCore(batch);
          allEmbeddings.push(...embeddings);

          // Space batches 1 second apart
          if (i + batchSize < texts.length) {
            yield* Effect.sleep("1 second");
          }
        }

        yield* Effect.logDebug(
          `All embeddings complete: ${allEmbeddings.length} vectors`,
        );

        return allEmbeddings;
      });

    return {
      embedBatch: embedBatchCore,
      embedAll: embedAllTexts,
    };
  }),
);
