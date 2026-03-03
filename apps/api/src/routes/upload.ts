import { Elysia } from "elysia";
import { uploadRouter } from "#/lib/upload";

// ============================================
// Upload Routes (Pushduck S3 handler)
// ============================================
// Routes GET and POST to Pushduck's handlers.
// This route must NOT use authMiddleware — Pushduck has
// its own middleware that checks the Authorization header.
//
// We clone the request before passing it to Pushduck because
// Elysia's body parser / middleware may consume the body first,
// causing "Body already used" errors.

export const uploadRoutes = new Elysia({ prefix: "/upload" })
  .get("/", ({ request }) =>
    uploadRouter.handlers.GET(request.clone() as unknown as Request),
  )
  .post("/", ({ request }) =>
    uploadRouter.handlers.POST(request.clone() as unknown as Request),
  );
