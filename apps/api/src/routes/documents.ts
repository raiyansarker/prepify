import { Elysia, t } from "elysia";
import { Effect } from "effect";
import { eq, and, isNull, desc } from "drizzle-orm";
import { db } from "#/db";
import { documents, documentChunks, folders } from "#/db/schema";
import { requireAuth } from "#/middleware/auth";
import { documentProcessingQueue } from "#/lib/queues";
import {
  DatabaseError,
  NotFoundError,
  ExternalServiceError,
} from "#/lib/errors";
import { effectHandler } from "#/services/runtime";

type Auth = { userId: string };

// Helper to determine document type from mime type
function getDocumentType(mimeType: string): "pdf" | "image" | "text" {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("image/")) return "image";
  return "text";
}

// ============================================
// DB helpers wrapped in Effect
// ============================================

const queryDocuments = (userId: string, folderId?: string) =>
  Effect.tryPromise({
    try: () =>
      db.query.documents.findMany({
        where: folderId
          ? and(
              eq(documents.userId, userId),
              folderId === "root"
                ? isNull(documents.folderId)
                : eq(documents.folderId, folderId),
            )
          : eq(documents.userId, userId),
        orderBy: [desc(documents.createdAt)],
      }),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to query documents", cause }),
  });

const findDocument = (documentId: string, userId: string) =>
  Effect.tryPromise({
    try: () =>
      db.query.documents.findFirst({
        where: and(eq(documents.id, documentId), eq(documents.userId, userId)),
      }),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to find document", cause }),
  });

const findFolder = (folderId: string, userId: string) =>
  Effect.tryPromise({
    try: () =>
      db.query.folders.findFirst({
        where: and(eq(folders.id, folderId), eq(folders.userId, userId)),
      }),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to find folder", cause }),
  });

const insertDocument = (data: Record<string, unknown>) =>
  Effect.tryPromise({
    try: () =>
      db
        .insert(documents)
        .values(data as any)
        .returning(),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to insert document", cause }),
  });

const updateDocument = (documentId: string, data: Record<string, unknown>) =>
  Effect.tryPromise({
    try: () =>
      db
        .update(documents)
        .set(data)
        .where(eq(documents.id, documentId))
        .returning(),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to update document", cause }),
  });

const deleteDocument = (documentId: string) =>
  Effect.tryPromise({
    try: () => db.delete(documents).where(eq(documents.id, documentId)),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to delete document", cause }),
  });

const enqueueProcessing = (documentId: string, userId: string) =>
  Effect.tryPromise({
    try: () =>
      documentProcessingQueue.add(
        "process",
        { documentId, userId },
        { jobId: `doc-${documentId}` },
      ),
    catch: (cause) =>
      new ExternalServiceError({
        service: "BullMQ",
        message: "Failed to enqueue document processing",
        cause,
      }),
  });

const deleteDocumentChunks = (documentId: string) =>
  Effect.tryPromise({
    try: () =>
      db
        .delete(documentChunks)
        .where(eq(documentChunks.documentId, documentId)),
    catch: (cause) =>
      new DatabaseError({
        message: "Failed to delete document chunks",
        cause,
      }),
  });

const enqueueRetryProcessing = (documentId: string, userId: string) =>
  Effect.tryPromise({
    try: () =>
      documentProcessingQueue.add(
        "process",
        { documentId, userId },
        { jobId: `doc-${documentId}-retry-${Date.now()}` },
      ),
    catch: (cause) =>
      new ExternalServiceError({
        service: "BullMQ",
        message: "Failed to enqueue document retry processing",
        cause,
      }),
  });

// ============================================
// Document CRUD Routes
// ============================================

export const documentRoutes = new Elysia({ prefix: "/documents" })
  .use(requireAuth)

  // List documents for current user (optionally filter by folderId)
  .get(
    "/",
    async (ctx) => {
      const auth = (ctx as unknown as { auth: Auth }).auth;
      const folderId = ctx.query.folderId;

      return effectHandler(
        ctx,
        Effect.gen(function* () {
          const userDocuments = yield* queryDocuments(auth.userId, folderId);
          yield* Effect.logDebug(`Listed ${userDocuments.length} documents`);
          return { success: true as const, data: userDocuments };
        }),
      );
    },
    {
      query: t.Object({
        folderId: t.Optional(t.String()),
      }),
    },
  )

  // Get a single document by ID
  .get(
    "/:id",
    async (ctx) => {
      const auth = (ctx as unknown as { auth: Auth }).auth;

      return effectHandler(
        ctx,
        Effect.gen(function* () {
          const document = yield* findDocument(ctx.params.id, auth.userId);
          if (!document) {
            return yield* new NotFoundError({
              entity: "Document",
              id: ctx.params.id,
            });
          }
          return { success: true as const, data: document };
        }),
      );
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Create a document record (called after S3 upload completes)
  .post(
    "/",
    async (ctx) => {
      const auth = (ctx as unknown as { auth: Auth }).auth;

      return effectHandler(
        ctx,
        Effect.gen(function* () {
          // Validate folderId if provided
          if (ctx.body.folderId) {
            const folder = yield* findFolder(ctx.body.folderId, auth.userId);
            if (!folder) {
              return yield* new NotFoundError({
                entity: "Folder",
                id: ctx.body.folderId,
              });
            }
          }

          const results = yield* insertDocument({
            userId: auth.userId,
            name: ctx.body.name,
            type: getDocumentType(ctx.body.mimeType),
            mimeType: ctx.body.mimeType,
            fileSize: ctx.body.fileSize,
            s3Key: ctx.body.s3Key,
            s3Url: ctx.body.s3Url,
            folderId: ctx.body.folderId || null,
            status: "pending",
          });
          const document = results[0]!;

          // Enqueue document processing job
          yield* enqueueProcessing(document.id, auth.userId);

          yield* Effect.logInfo(
            "Document created and processing enqueued",
          ).pipe(Effect.annotateLogs("documentId", document.id));

          return { success: true as const, data: document };
        }),
      );
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 255 }),
        mimeType: t.String(),
        fileSize: t.Number(),
        s3Key: t.String(),
        s3Url: t.String(),
        folderId: t.Optional(t.String()),
      }),
    },
  )

  // Rename or move a document
  .patch(
    "/:id",
    async (ctx) => {
      const auth = (ctx as unknown as { auth: Auth }).auth;

      return effectHandler(
        ctx,
        Effect.gen(function* () {
          const document = yield* findDocument(ctx.params.id, auth.userId);
          if (!document) {
            return yield* new NotFoundError({
              entity: "Document",
              id: ctx.params.id,
            });
          }

          const updateData: Record<string, unknown> = {
            updatedAt: new Date(),
          };

          if (ctx.body.name !== undefined) {
            updateData.name = ctx.body.name;
          }

          if (ctx.body.folderId !== undefined) {
            if (ctx.body.folderId) {
              const folder = yield* findFolder(ctx.body.folderId, auth.userId);
              if (!folder) {
                return yield* new NotFoundError({
                  entity: "Folder",
                  id: ctx.body.folderId,
                });
              }
            }
            updateData.folderId = ctx.body.folderId || null;
          }

          const [updated] = yield* updateDocument(ctx.params.id, updateData);

          yield* Effect.logInfo("Document updated").pipe(
            Effect.annotateLogs("documentId", ctx.params.id),
          );

          return { success: true as const, data: updated! };
        }),
      );
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
        folderId: t.Optional(t.Nullable(t.String())),
      }),
    },
  )

  // Delete a document
  .delete(
    "/:id",
    async (ctx) => {
      const auth = (ctx as unknown as { auth: Auth }).auth;

      return effectHandler(
        ctx,
        Effect.gen(function* () {
          const document = yield* findDocument(ctx.params.id, auth.userId);
          if (!document) {
            return yield* new NotFoundError({
              entity: "Document",
              id: ctx.params.id,
            });
          }

          // TODO: Also delete from R2 when implementing file cleanup
          yield* deleteDocument(ctx.params.id);

          yield* Effect.logInfo("Document deleted").pipe(
            Effect.annotateLogs("documentId", ctx.params.id),
          );

          return { success: true as const, data: { id: ctx.params.id } };
        }),
      );
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Retry a failed document processing job
  .post(
    "/:id/retry",
    async (ctx) => {
      const auth = (ctx as unknown as { auth: Auth }).auth;

      return effectHandler(
        ctx,
        Effect.gen(function* () {
          const document = yield* findDocument(ctx.params.id, auth.userId);
          if (!document) {
            return yield* new NotFoundError({
              entity: "Document",
              id: ctx.params.id,
            });
          }

          if (document.status !== "failed") {
            return yield* new NotFoundError({
              entity: "Document",
              id: ctx.params.id,
            });
          }

          // Delete any partial chunks from the failed processing
          yield* deleteDocumentChunks(ctx.params.id);

          // Reset status to pending
          const [updated] = yield* updateDocument(ctx.params.id, {
            status: "pending",
            updatedAt: new Date(),
          });

          // Re-enqueue with a unique job ID
          yield* enqueueRetryProcessing(ctx.params.id, auth.userId);

          yield* Effect.logInfo("Document retry enqueued").pipe(
            Effect.annotateLogs("documentId", ctx.params.id),
          );

          return { success: true as const, data: updated! };
        }),
      );
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  );
