import { Worker, type Job } from "bullmq";
import { Effect, Schedule } from "effect";
import { eq } from "drizzle-orm";
import { generateObject } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { db } from "#/db";
import {
  documents,
  flashcardDeckDocuments,
  flashcardDecks,
  flashcards,
} from "#/db/schema";
import { redisConnection } from "#/lib/redis";
import { QUEUE_NAMES } from "#/lib/queues";
import { workerLogger, LogLayer } from "#/lib/logger";
import { env } from "#/lib/env";
import { STRUCTURED_GEN_MODEL } from "#/services/ai";
import { AiGenerationError, DatabaseError, ValidationError } from "#/lib/errors";
import {
  flashcardGenerationResponseSchema,
  type FlashcardOutput,
} from "#/lib/flashcard-schemas";
import {
  MAX_CONTEXT_CHUNKS,
  type FlashcardGenerationJob,
} from "@repo/shared";
import { buildContextFromChunks, findSimilarChunks } from "#/lib/similarity";

const groq = createGroq({
  apiKey: env().ai.groqApiKey,
});

const transientRetry = Schedule.exponential("3 seconds").pipe(
  Schedule.compose(Schedule.recurs(2)),
);

const fetchDeckContext = (deckId: string, userId: string, topic: string) =>
  Effect.tryPromise({
    try: async () => {
      const deck = await db.query.flashcardDecks.findFirst({
        where: eq(flashcardDecks.id, deckId),
      });
      if (!deck || deck.userId !== userId) return null;

      const linkedDocs = await db
        .select({
          id: documents.id,
          name: documents.name,
          extractedText: documents.extractedText,
          status: documents.status,
        })
        .from(flashcardDeckDocuments)
        .innerJoin(documents, eq(flashcardDeckDocuments.documentId, documents.id))
        .where(eq(flashcardDeckDocuments.deckId, deckId));

      const readyDocumentIds = linkedDocs
        .filter((doc) => doc.status === "ready")
        .map((doc) => doc.id);

      let context = "";
      if (readyDocumentIds.length > 0) {
        const similarChunks = await findSimilarChunks(topic, userId, {
          documentIds: readyDocumentIds,
          limit: MAX_CONTEXT_CHUNKS,
          minSimilarity: 0.2,
        }).catch(() => []);

        if (similarChunks.length > 0) {
          context = buildContextFromChunks(similarChunks);
        }
      }

      if (!context) {
        context = linkedDocs
          .map(
            (doc) =>
              `# ${doc.name}\n${(doc.extractedText ?? "").trim().slice(0, 4000)}`,
          )
          .filter((text) => text.trim().length > 0)
          .join("\n\n---\n\n")
          .slice(0, 18000);
      }

      return { deck, linkedDocs, context };
    },
    catch: (cause) =>
      new DatabaseError({
        message: "Failed to fetch flashcard deck generation context",
        cause,
      }),
  }).pipe(
    Effect.flatMap((data) =>
      data
        ? Effect.succeed(data)
        : Effect.fail(
            new ValidationError({
              message: "Flashcard deck not found",
            }),
          ),
    ),
  );

const updateDeck = (
  deckId: string,
  data: Partial<typeof flashcardDecks.$inferInsert>,
) =>
  Effect.tryPromise({
    try: () =>
      db
        .update(flashcardDecks)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(flashcardDecks.id, deckId)),
    catch: (cause) =>
      new DatabaseError({
        message: "Failed to update flashcard deck",
        cause,
      }),
  });

const replaceFlashcards = (deckId: string, cards: FlashcardOutput[]) =>
  Effect.tryPromise({
    try: async () => {
      await db.delete(flashcards).where(eq(flashcards.deckId, deckId));
      if (cards.length === 0) return [];

      return db.insert(flashcards).values(
        cards.map((card) => ({
          deckId,
          front: card.front,
          back: card.back,
          difficulty: card.difficulty,
        })),
      );
    },
    catch: (cause) =>
      new DatabaseError({
        message: "Failed to store flashcards",
        cause,
      }),
  });

const generateFlashcards = (topic: string, context: string) =>
  Effect.tryPromise({
    try: async () => {
      const { object } = await generateObject({
        model: groq(STRUCTURED_GEN_MODEL),
        schema: flashcardGenerationResponseSchema,
        prompt: `You are an expert flashcard generator for the study platform Prepify.

TOPIC: ${topic}

Generate 20 high-quality flashcards based only on the source material below.

CARD GUIDELINES:
- Front side should be a concise question, prompt, definition cue, or recall trigger
- Back side should be concise but complete
- Cover distinct concepts and avoid duplicates
- Prefer active recall over vague summaries
- Keep each card independently understandable
- Mark difficulty realistically as easy, medium, or hard
- Do not mention the source documents directly

SOURCE MATERIAL:
${context}`,
      });

      return object.cards;
    },
    catch: (cause) =>
      new AiGenerationError({
        message: "Failed to generate flashcards",
        cause,
      }),
  }).pipe(Effect.retry(transientRetry));

const processFlashcardGeneration = (job: FlashcardGenerationJob) =>
  Effect.gen(function* () {
    const { deckId, userId, topic } = job;

    const { linkedDocs, context } = yield* fetchDeckContext(deckId, userId, topic);

    if (!context.trim()) {
      return yield* new ValidationError({
        message: "Selected documents do not have enough processed content for flashcards",
      });
    }

    const cards = yield* generateFlashcards(topic, context);

    if (cards.length === 0) {
      return yield* new ValidationError({
        message: "AI did not return any flashcards",
      });
    }

    yield* replaceFlashcards(deckId, cards);
    yield* updateDeck(deckId, {
      status: "ready",
      errorMessage: null,
      cardCount: cards.length,
    });

    yield* Effect.logInfo("Flashcard generation completed").pipe(
      Effect.annotateLogs("deckId", deckId),
      Effect.annotateLogs("documentCount", String(linkedDocs.length)),
      Effect.annotateLogs("cardCount", String(cards.length)),
    );

    return { deckId, cardCount: cards.length };
  }).pipe(
    Effect.tapError((error) =>
      updateDeck(job.deckId, {
        status: "failed",
        errorMessage:
          error instanceof ValidationError || error instanceof AiGenerationError
            ? error.message
            : "Flashcard generation failed unexpectedly",
      }).pipe(Effect.catchAll(() => Effect.void)),
    ),
  );

const worker = new Worker<FlashcardGenerationJob>(
  QUEUE_NAMES.FLASHCARD_GENERATION,
  async (job: Job<FlashcardGenerationJob>) =>
    Effect.runPromise(
      processFlashcardGeneration(job.data).pipe(Effect.provide(LogLayer)),
    ),
  {
    connection: redisConnection,
    concurrency: 2,
  },
);

worker.on("completed", (job) => {
  workerLogger.info({ jobId: job.id }, "Flashcard generation job completed");
});

worker.on("failed", (job, err) => {
  workerLogger.error(
    { jobId: job?.id, err },
    "Flashcard generation job failed",
  );
});
