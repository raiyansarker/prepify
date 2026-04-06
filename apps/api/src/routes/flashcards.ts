import { Elysia, t } from "elysia";
import { Effect } from "effect";
import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { db } from "#/db";
import {
  documents,
  flashcardDeckDocuments,
  flashcardDecks,
  flashcards,
} from "#/db/schema";
import { requireAuth } from "#/middleware/auth";
import { flashcardGenerationQueue } from "#/lib/queues";
import {
  DatabaseError,
  ExternalServiceError,
  NotFoundError,
  ValidationError,
} from "#/lib/errors";
import { effectHandler } from "#/services/runtime";
import {
  SM2_DEFAULT_INTERVAL,
  SM2_MIN_EASE_FACTOR,
  type FlashcardReviewRating,
} from "@repo/shared";

type Auth = { userId: string };

const queryDecks = (userId: string) =>
  Effect.tryPromise({
    try: () =>
      db.query.flashcardDecks.findMany({
        where: eq(flashcardDecks.userId, userId),
        with: {
          flashcards: true,
          flashcardDeckDocuments: {
            with: {
              document: true,
            },
          },
        },
        orderBy: [desc(flashcardDecks.updatedAt)],
      }),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to query flashcard decks", cause }),
  });

const findDeck = (deckId: string, userId: string) =>
  Effect.tryPromise({
    try: () =>
      db.query.flashcardDecks.findFirst({
        where: and(eq(flashcardDecks.id, deckId), eq(flashcardDecks.userId, userId)),
        with: {
          flashcards: {
            orderBy: [desc(flashcards.createdAt)],
          },
          flashcardDeckDocuments: {
            with: {
              document: true,
            },
          },
        },
      }),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to find flashcard deck", cause }),
  });

const findDeckRecord = (deckId: string, userId: string) =>
  Effect.tryPromise({
    try: () =>
      db.query.flashcardDecks.findFirst({
        where: and(eq(flashcardDecks.id, deckId), eq(flashcardDecks.userId, userId)),
      }),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to find flashcard deck", cause }),
  });

const verifyDocumentOwnership = (documentIds: string[], userId: string) =>
  Effect.tryPromise({
    try: () =>
      db.query.documents.findMany({
        where: and(eq(documents.userId, userId), inArray(documents.id, documentIds)),
      }),
    catch: (cause) =>
      new DatabaseError({
        message: "Failed to verify flashcard source documents",
        cause,
      }),
  }).pipe(
    Effect.flatMap((ownedDocs) => {
      if (ownedDocs.length !== documentIds.length) {
        return Effect.fail(
          new ValidationError({
            message: "One or more selected documents are invalid",
            field: "documentIds",
          }),
        );
      }
      return Effect.succeed(ownedDocs);
    }),
  );

const insertDeck = (data: typeof flashcardDecks.$inferInsert) =>
  Effect.tryPromise({
    try: () => db.insert(flashcardDecks).values(data).returning(),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to create flashcard deck", cause }),
  });

const insertDeckDocuments = (
  values: typeof flashcardDeckDocuments.$inferInsert[],
) =>
  Effect.tryPromise({
    try: () => db.insert(flashcardDeckDocuments).values(values),
    catch: (cause) =>
      new DatabaseError({
        message: "Failed to attach flashcard deck documents",
        cause,
      }),
  });

const enqueueDeckGeneration = (deckId: string, userId: string, topic: string, documentIds: string[]) =>
  Effect.tryPromise({
    try: () =>
      flashcardGenerationQueue.add(
        "generate",
        { deckId, userId, topic, documentIds },
        { jobId: `flashcards-${deckId}` },
      ),
    catch: (cause) =>
      new ExternalServiceError({
        service: "BullMQ",
        message: "Failed to enqueue flashcard generation",
        cause,
      }),
  });

const deleteDeck = (deckId: string) =>
  Effect.tryPromise({
    try: () => db.delete(flashcardDecks).where(eq(flashcardDecks.id, deckId)),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to delete flashcard deck", cause }),
  });

const findReviewCard = (deckId: string, flashcardId: string, userId: string) =>
  Effect.tryPromise({
    try: async () => {
      const deck = await db.query.flashcardDecks.findFirst({
        where: and(eq(flashcardDecks.id, deckId), eq(flashcardDecks.userId, userId)),
      });
      if (!deck) return null;

      const card = await db.query.flashcards.findFirst({
        where: and(eq(flashcards.id, flashcardId), eq(flashcards.deckId, deckId)),
      });

      return card ? { deck, card } : null;
    },
    catch: (cause) =>
      new DatabaseError({ message: "Failed to find flashcard review card", cause }),
  });

const updateFlashcardReview = (
  flashcardId: string,
  data: Partial<typeof flashcards.$inferInsert>,
) =>
  Effect.tryPromise({
    try: () =>
      db
        .update(flashcards)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(flashcards.id, flashcardId))
        .returning(),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to update flashcard review state", cause }),
  });

function addDays(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function computeReviewUpdate(
  current: {
    repetitions: number;
    interval: number;
    easeFactor: number;
  },
  rating: FlashcardReviewRating,
) {
  const repetitions = current.repetitions;
  const interval = current.interval || SM2_DEFAULT_INTERVAL;
  const easeFactor = current.easeFactor || 2.5;

  if (rating === "again") {
    const nextEase = Math.max(SM2_MIN_EASE_FACTOR, easeFactor - 0.2);
    return {
      repetitions: 0,
      interval: SM2_DEFAULT_INTERVAL,
      easeFactor: nextEase,
      difficulty: "hard" as const,
      nextReviewAt: new Date(),
    };
  }

  if (rating === "hard") {
    const nextEase = Math.max(SM2_MIN_EASE_FACTOR, easeFactor - 0.15);
    const nextInterval =
      repetitions <= 1 ? 2 : Math.max(2, Math.round(interval * 1.2));
    return {
      repetitions: repetitions + 1,
      interval: nextInterval,
      easeFactor: nextEase,
      difficulty: "hard" as const,
      nextReviewAt: addDays(nextInterval),
    };
  }

  if (rating === "easy") {
    const nextEase = easeFactor + 0.15;
    const nextInterval =
      repetitions === 0
        ? 3
        : repetitions === 1
          ? 6
          : Math.max(4, Math.round(interval * nextEase * 1.3));
    return {
      repetitions: repetitions + 1,
      interval: nextInterval,
      easeFactor: nextEase,
      difficulty: "easy" as const,
      nextReviewAt: addDays(nextInterval),
    };
  }

  const nextInterval =
    repetitions === 0
      ? 1
      : repetitions === 1
        ? 3
        : Math.max(2, Math.round(interval * easeFactor));

  return {
    repetitions: repetitions + 1,
    interval: nextInterval,
    easeFactor,
    difficulty: "medium" as const,
    nextReviewAt: addDays(nextInterval),
  };
}

function serializeDeck(
  deck: Awaited<ReturnType<typeof db.query.flashcardDecks.findFirst>> & {
    flashcards?: Array<(typeof flashcards.$inferSelect)>;
    flashcardDeckDocuments?: Array<{
      document: typeof documents.$inferSelect;
    }>;
  },
) {
  const dueCount = (deck?.flashcards ?? []).filter(
    (card) => new Date(card.nextReviewAt).getTime() <= Date.now(),
  ).length;

  return {
    ...deck,
    dueCount,
    documents:
      deck?.flashcardDeckDocuments?.map(({ document }) => ({
        id: document.id,
        name: document.name,
        status: document.status,
      })) ?? [],
  };
}

export const flashcardRoutes = new Elysia({ prefix: "/flashcards" })
  .use(requireAuth)
  .get("/", async (ctx) => {
    const auth = (ctx as unknown as { auth: Auth }).auth;

    return effectHandler(
      ctx,
      Effect.gen(function* () {
        const decks = yield* queryDecks(auth.userId);
        return {
          success: true as const,
          data: decks.map((deck) => serializeDeck(deck)),
        };
      }),
    );
  })
  .get("/review/due", async (ctx) => {
    const auth = (ctx as unknown as { auth: Auth }).auth;

    return effectHandler(
      ctx,
      Effect.gen(function* () {
        const dueCards = yield* Effect.tryPromise({
          try: () =>
            db.query.flashcards.findMany({
              where: lte(flashcards.nextReviewAt, new Date()),
              with: {
                deck: true,
              },
              orderBy: [desc(flashcards.nextReviewAt)],
            }),
          catch: (cause) =>
            new DatabaseError({
              message: "Failed to query due flashcards",
              cause,
            }),
        });

        return {
          success: true as const,
          data: dueCards.filter((card) => card.deck.userId === auth.userId),
        };
      }),
    );
  })
  .post(
    "/",
    async (ctx) => {
      const auth = (ctx as unknown as { auth: Auth }).auth;

      return effectHandler(
        ctx,
        Effect.gen(function* () {
          if (ctx.body.documentIds.length === 0) {
            return yield* new ValidationError({
              message: "Select at least one document",
              field: "documentIds",
            });
          }

          yield* verifyDocumentOwnership(ctx.body.documentIds, auth.userId);

          const [deck] = yield* insertDeck({
            userId: auth.userId,
            title: ctx.body.title,
            topic: ctx.body.topic,
            description: ctx.body.description ?? null,
            status: "generating",
          });

          yield* insertDeckDocuments(
            ctx.body.documentIds.map((documentId) => ({
              deckId: deck!.id,
              documentId,
            })),
          );

          yield* enqueueDeckGeneration(
            deck!.id,
            auth.userId,
            ctx.body.topic,
            ctx.body.documentIds,
          );

          return { success: true as const, data: deck! };
        }),
      );
    },
    {
      body: t.Object({
        title: t.String({ minLength: 1, maxLength: 255 }),
        topic: t.String({ minLength: 1, maxLength: 500 }),
        description: t.Optional(t.String({ maxLength: 2000 })),
        documentIds: t.Array(t.String(), { minItems: 1 }),
      }),
    },
  )
  .get(
    "/:deckId",
    async (ctx) => {
      const auth = (ctx as unknown as { auth: Auth }).auth;

      return effectHandler(
        ctx,
        Effect.gen(function* () {
          const deck = yield* findDeck(ctx.params.deckId, auth.userId);
          if (!deck) {
            return yield* new NotFoundError({
              entity: "FlashcardDeck",
              id: ctx.params.deckId,
            });
          }

          return { success: true as const, data: serializeDeck(deck) };
        }),
      );
    },
    {
      params: t.Object({
        deckId: t.String(),
      }),
    },
  )
  .delete(
    "/:deckId",
    async (ctx) => {
      const auth = (ctx as unknown as { auth: Auth }).auth;

      return effectHandler(
        ctx,
        Effect.gen(function* () {
          const deck = yield* findDeckRecord(ctx.params.deckId, auth.userId);
          if (!deck) {
            return yield* new NotFoundError({
              entity: "FlashcardDeck",
              id: ctx.params.deckId,
            });
          }

          yield* deleteDeck(ctx.params.deckId);
          return { success: true as const, data: { id: ctx.params.deckId } };
        }),
      );
    },
    {
      params: t.Object({
        deckId: t.String(),
      }),
    },
  )
  .post(
    "/:deckId/review",
    async (ctx) => {
      const auth = (ctx as unknown as { auth: Auth }).auth;

      return effectHandler(
        ctx,
        Effect.gen(function* () {
          const record = yield* findReviewCard(
            ctx.params.deckId,
            ctx.body.flashcardId,
            auth.userId,
          );
          if (!record) {
            return yield* new NotFoundError({
              entity: "Flashcard",
              id: ctx.body.flashcardId,
            });
          }

          const update = computeReviewUpdate(record.card, ctx.body.rating);
          const [updated] = yield* updateFlashcardReview(record.card.id, update);

          return { success: true as const, data: updated! };
        }),
      );
    },
    {
      params: t.Object({
        deckId: t.String(),
      }),
      body: t.Object({
        flashcardId: t.String(),
        rating: t.Union([
          t.Literal("again"),
          t.Literal("hard"),
          t.Literal("good"),
          t.Literal("easy"),
        ]),
      }),
    },
  );
