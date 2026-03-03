import { Elysia, t } from "elysia";
import { eq, and, isNull, desc } from "drizzle-orm";
import { db } from "#/db";
import { documents, folders } from "#/db/schema";
import { requireAuth } from "#/middleware/auth";
import { documentProcessingQueue } from "#/lib/queues";

type Auth = { userId: string };

// Helper to determine document type from mime type
function getDocumentType(mimeType: string): "pdf" | "image" | "text" {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("image/")) return "image";
  return "text";
}

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

      const userDocuments = await db.query.documents.findMany({
        where: folderId
          ? and(
              eq(documents.userId, auth.userId),
              folderId === "root"
                ? isNull(documents.folderId)
                : eq(documents.folderId, folderId),
            )
          : eq(documents.userId, auth.userId),
        orderBy: [desc(documents.createdAt)],
      });

      return {
        success: true as const,
        data: userDocuments,
      };
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

      const document = await db.query.documents.findFirst({
        where: and(
          eq(documents.id, ctx.params.id),
          eq(documents.userId, auth.userId),
        ),
      });

      if (!document) {
        ctx.set.status = 404;
        return { success: false as const, error: "Document not found" };
      }

      return {
        success: true as const,
        data: document,
      };
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

      // Validate folderId if provided
      if (ctx.body.folderId) {
        const folder = await db.query.folders.findFirst({
          where: and(
            eq(folders.id, ctx.body.folderId),
            eq(folders.userId, auth.userId),
          ),
        });

        if (!folder) {
          ctx.set.status = 404;
          return { success: false as const, error: "Folder not found" };
        }
      }

      const [document] = await db
        .insert(documents)
        .values({
          userId: auth.userId,
          name: ctx.body.name,
          type: getDocumentType(ctx.body.mimeType),
          mimeType: ctx.body.mimeType,
          fileSize: ctx.body.fileSize,
          s3Key: ctx.body.s3Key,
          s3Url: ctx.body.s3Url,
          folderId: ctx.body.folderId || null,
          status: "pending",
        })
        .returning();

      // Enqueue document processing job
      if (document) {
        await documentProcessingQueue.add(
          "process",
          { documentId: document.id, userId: auth.userId },
          { jobId: `doc-${document.id}` },
        );
      }

      return {
        success: true as const,
        data: document,
      };
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

      const document = await db.query.documents.findFirst({
        where: and(
          eq(documents.id, ctx.params.id),
          eq(documents.userId, auth.userId),
        ),
      });

      if (!document) {
        ctx.set.status = 404;
        return { success: false as const, error: "Document not found" };
      }

      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (ctx.body.name !== undefined) {
        updateData.name = ctx.body.name;
      }

      if (ctx.body.folderId !== undefined) {
        // folderId can be null (move to root) or a valid folder ID
        if (ctx.body.folderId) {
          const folder = await db.query.folders.findFirst({
            where: and(
              eq(folders.id, ctx.body.folderId),
              eq(folders.userId, auth.userId),
            ),
          });

          if (!folder) {
            ctx.set.status = 404;
            return { success: false as const, error: "Folder not found" };
          }
        }
        updateData.folderId = ctx.body.folderId || null;
      }

      const [updated] = await db
        .update(documents)
        .set(updateData)
        .where(eq(documents.id, ctx.params.id))
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

      const document = await db.query.documents.findFirst({
        where: and(
          eq(documents.id, ctx.params.id),
          eq(documents.userId, auth.userId),
        ),
      });

      if (!document) {
        ctx.set.status = 404;
        return { success: false as const, error: "Document not found" };
      }

      // TODO: Also delete from R2 when implementing file cleanup

      await db.delete(documents).where(eq(documents.id, ctx.params.id));

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
