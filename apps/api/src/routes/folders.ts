import { Elysia, t } from "elysia";
import { Effect } from "effect";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "#/db";
import { folders, documents } from "#/db/schema";
import { requireAuth } from "#/middleware/auth";
import { DatabaseError, NotFoundError } from "#/lib/errors";
import { effectHandler } from "#/services/runtime";

type Auth = { userId: string };

// ============================================
// DB helpers wrapped in Effect
// ============================================

const queryFolders = (userId: string, parentId: string | null) =>
  Effect.tryPromise({
    try: () =>
      db.query.folders.findMany({
        where: parentId
          ? and(eq(folders.userId, userId), eq(folders.parentId, parentId))
          : and(eq(folders.userId, userId), isNull(folders.parentId)),
        orderBy: (folders, { asc }) => [asc(folders.name)],
      }),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to query folders", cause }),
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

const insertFolder = (data: {
  userId: string;
  name: string;
  parentId: string | null;
}) =>
  Effect.tryPromise({
    try: () => db.insert(folders).values(data).returning(),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to insert folder", cause }),
  });

const updateFolder = (folderId: string, data: Record<string, unknown>) =>
  Effect.tryPromise({
    try: () =>
      db.update(folders).set(data).where(eq(folders.id, folderId)).returning(),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to update folder", cause }),
  });

const deleteFolder = (folderId: string) =>
  Effect.tryPromise({
    try: () => db.delete(folders).where(eq(folders.id, folderId)),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to delete folder", cause }),
  });

const reparentDocuments = (folderId: string) =>
  Effect.tryPromise({
    try: () =>
      db
        .update(documents)
        .set({ folderId: null, updatedAt: new Date() })
        .where(eq(documents.folderId, folderId)),
    catch: (cause) =>
      new DatabaseError({
        message: "Failed to reparent documents",
        cause,
      }),
  });

const reparentChildFolders = (
  folderId: string,
  newParentId: string | null,
  userId: string,
) =>
  Effect.tryPromise({
    try: () =>
      db
        .update(folders)
        .set({ parentId: newParentId, updatedAt: new Date() })
        .where(and(eq(folders.parentId, folderId), eq(folders.userId, userId))),
    catch: (cause) =>
      new DatabaseError({
        message: "Failed to reparent child folders",
        cause,
      }),
  });

// ============================================
// Folder CRUD Routes
// ============================================

export const folderRoutes = new Elysia({ prefix: "/folders" })
  .use(requireAuth)

  // List folders for current user (optionally filter by parentId)
  .get(
    "/",
    async (ctx) => {
      const auth = (ctx as unknown as { auth: Auth }).auth;
      const parentId = ctx.query.parentId || null;

      return effectHandler(
        ctx,
        Effect.gen(function* () {
          const userFolders = yield* queryFolders(auth.userId, parentId);
          yield* Effect.logDebug(`Listed ${userFolders.length} folders`);
          return { success: true as const, data: userFolders };
        }),
      );
    },
    {
      query: t.Object({
        parentId: t.Optional(t.String()),
      }),
    },
  )

  // Get the ancestor path for a folder (for rebuilding breadcrumbs)
  .get(
    "/path/:id",
    async (ctx) => {
      const auth = (ctx as unknown as { auth: Auth }).auth;

      return effectHandler(
        ctx,
        Effect.gen(function* () {
          const path: { id: string; name: string }[] = [];
          let currentId: string | null = ctx.params.id;

          while (currentId && path.length < 20) {
            const ancestor: Awaited<
              ReturnType<typeof db.query.folders.findFirst>
            > = yield* findFolder(currentId, auth.userId);
            if (!ancestor) break;
            path.unshift({ id: ancestor.id, name: ancestor.name });
            currentId = ancestor.parentId;
          }

          return { success: true as const, data: path };
        }),
      );
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Create a folder
  .post(
    "/",
    async (ctx) => {
      const auth = (ctx as unknown as { auth: Auth }).auth;

      return effectHandler(
        ctx,
        Effect.gen(function* () {
          // Validate parent folder if provided
          if (ctx.body.parentId) {
            const parentFolder = yield* findFolder(
              ctx.body.parentId,
              auth.userId,
            );
            if (!parentFolder) {
              return yield* new NotFoundError({
                entity: "Parent folder",
                id: ctx.body.parentId,
              });
            }
          }

          const results = yield* insertFolder({
            userId: auth.userId,
            name: ctx.body.name,
            parentId: ctx.body.parentId || null,
          });
          const folder = results[0]!;

          yield* Effect.logInfo("Folder created").pipe(
            Effect.annotateLogs("folderId", folder.id),
          );

          return { success: true as const, data: folder };
        }),
      );
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 255 }),
        parentId: t.Optional(t.String()),
      }),
    },
  )

  // Rename a folder
  .patch(
    "/:id",
    async (ctx) => {
      const auth = (ctx as unknown as { auth: Auth }).auth;

      return effectHandler(
        ctx,
        Effect.gen(function* () {
          const folder = yield* findFolder(ctx.params.id, auth.userId);
          if (!folder) {
            return yield* new NotFoundError({
              entity: "Folder",
              id: ctx.params.id,
            });
          }

          const [updated] = yield* updateFolder(ctx.params.id, {
            name: ctx.body.name,
            updatedAt: new Date(),
          });

          yield* Effect.logInfo("Folder renamed").pipe(
            Effect.annotateLogs("folderId", ctx.params.id),
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
        name: t.String({ minLength: 1, maxLength: 255 }),
      }),
    },
  )

  // Delete a folder (moves child docs to root, reparents child folders)
  .delete(
    "/:id",
    async (ctx) => {
      const auth = (ctx as unknown as { auth: Auth }).auth;

      return effectHandler(
        ctx,
        Effect.gen(function* () {
          const folder = yield* findFolder(ctx.params.id, auth.userId);
          if (!folder) {
            return yield* new NotFoundError({
              entity: "Folder",
              id: ctx.params.id,
            });
          }

          // Move documents in this folder to root
          yield* reparentDocuments(ctx.params.id);

          // Reparent child folders to this folder's parent
          yield* reparentChildFolders(
            ctx.params.id,
            folder.parentId,
            auth.userId,
          );

          // Delete the folder
          yield* deleteFolder(ctx.params.id);

          yield* Effect.logInfo("Folder deleted").pipe(
            Effect.annotateLogs("folderId", ctx.params.id),
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
  );
