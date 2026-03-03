import { Elysia, t } from "elysia";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "#/db";
import { folders, documents } from "#/db/schema";
import { requireAuth } from "#/middleware/auth";

type Auth = { userId: string };

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

      const userFolders = await db.query.folders.findMany({
        where: parentId
          ? and(eq(folders.userId, auth.userId), eq(folders.parentId, parentId))
          : and(eq(folders.userId, auth.userId), isNull(folders.parentId)),
        orderBy: (folders, { asc }) => [asc(folders.name)],
      });

      return {
        success: true as const,
        data: userFolders,
      };
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

      const path: { id: string; name: string }[] = [];
      let currentId: string | null = ctx.params.id;

      // Walk up the parent chain (with a safety limit of 20 levels)
      while (currentId && path.length < 20) {
        const ancestor:
          | { id: string; name: string; parentId: string | null }
          | undefined = await db.query.folders.findFirst({
          where: and(
            eq(folders.id, currentId),
            eq(folders.userId, auth.userId),
          ),
        });

        if (!ancestor) break;
        path.unshift({ id: ancestor.id, name: ancestor.name });
        currentId = ancestor.parentId;
      }

      return {
        success: true as const,
        data: path,
      };
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

      // If parentId is provided, verify it exists and belongs to user
      if (ctx.body.parentId) {
        const parentFolder = await db.query.folders.findFirst({
          where: and(
            eq(folders.id, ctx.body.parentId),
            eq(folders.userId, auth.userId),
          ),
        });

        if (!parentFolder) {
          ctx.set.status = 404;
          return {
            success: false as const,
            error: "Parent folder not found",
          };
        }
      }

      const [folder] = await db
        .insert(folders)
        .values({
          userId: auth.userId,
          name: ctx.body.name,
          parentId: ctx.body.parentId || null,
        })
        .returning();

      return {
        success: true as const,
        data: folder,
      };
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

      const folder = await db.query.folders.findFirst({
        where: and(
          eq(folders.id, ctx.params.id),
          eq(folders.userId, auth.userId),
        ),
      });

      if (!folder) {
        ctx.set.status = 404;
        return { success: false as const, error: "Folder not found" };
      }

      const [updated] = await db
        .update(folders)
        .set({
          name: ctx.body.name,
          updatedAt: new Date(),
        })
        .where(eq(folders.id, ctx.params.id))
        .returning();

      return {
        success: true as const,
        data: updated,
      };
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

      const folder = await db.query.folders.findFirst({
        where: and(
          eq(folders.id, ctx.params.id),
          eq(folders.userId, auth.userId),
        ),
      });

      if (!folder) {
        ctx.set.status = 404;
        return { success: false as const, error: "Folder not found" };
      }

      // Move documents in this folder to root
      await db
        .update(documents)
        .set({ folderId: null, updatedAt: new Date() })
        .where(eq(documents.folderId, ctx.params.id));

      // Reparent child folders to this folder's parent
      await db
        .update(folders)
        .set({ parentId: folder.parentId, updatedAt: new Date() })
        .where(
          and(
            eq(folders.parentId, ctx.params.id),
            eq(folders.userId, auth.userId),
          ),
        );

      // Delete the folder
      await db.delete(folders).where(eq(folders.id, ctx.params.id));

      return {
        success: true as const,
        data: { id: ctx.params.id },
      };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  );
