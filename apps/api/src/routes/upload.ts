import { Elysia } from "elysia";
import { uploadRouter } from "#/lib/upload";

// ============================================
// Upload Routes (Pushduck S3 handler)
// ============================================
// Routes GET and POST to Pushduck's handlers.
// This route must NOT use authMiddleware — Pushduck has
// its own middleware that checks the Authorization header.

export const uploadRoutes = new Elysia({ prefix: "/upload" })
  .get("/", ({ request }) => uploadRouter.handlers.GET(request))
  .post("/", ({ request }) => uploadRouter.handlers.POST(request));
