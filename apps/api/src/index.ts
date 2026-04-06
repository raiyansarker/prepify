import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { Logestic } from "logestic";
import { env } from "#/lib/env";
import { apiLogger } from "#/lib/logger";
import { uploadRoutes } from "#/routes/upload";
import { folderRoutes } from "#/routes/folders";
import { documentRoutes } from "#/routes/documents";
import { chatRoutes } from "#/routes/chat";
import { examWsRoutes } from "#/routes/exam-ws";
import { examRoutes } from "#/routes/exams";
import { flashcardRoutes } from "#/routes/flashcards";

// ============================================
// Validate environment variables (fail fast)
// ============================================

const config = env();

// ============================================
// Elysia App
// ============================================

const app = new Elysia()
  .use(
    cors({
      origin:
        config.server.nodeEnv === "production"
          ? [config.server.frontendUrl]
          : true,
      allowedHeaders: ["Content-Type", "Authorization"],
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    }),
  )
  .use(
    openapi({
      documentation: {
        info: {
          title: "Prepify API",
          version: "0.0.1",
          description: "AI-powered study platform API",
        },
      },
    }),
  )
  .use(Logestic.preset("common"))

  // ============================================
  // Global error handler — catches unhandled exceptions
  // ============================================
  .onError(({ code, error, set }) => {
    // Elysia validation errors (schema mismatch)
    if (code === "VALIDATION") {
      apiLogger.warn(
        { code, error: error.message },
        "Request validation failed",
      );
      set.status = 400;
      return {
        success: false,
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: error.all,
      };
    }

    // 404 — route not found
    if (code === "NOT_FOUND") {
      set.status = 404;
      return {
        success: false,
        error: "Route not found",
        code: "NOT_FOUND",
      };
    }

    // Everything else — unexpected server error
    apiLogger.error({ code, err: error }, "Unhandled server error");
    set.status = 500;
    return {
      success: false,
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    };
  })

  .get("/health", () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }))
  .use(uploadRoutes)
  .use(folderRoutes)
  .use(documentRoutes)
  .use(chatRoutes)
  .use(examRoutes)
  .use(flashcardRoutes)
  .use(examWsRoutes)
  .listen(config.server.port);

apiLogger.info(
  { port: app.server?.port, env: config.server.nodeEnv },
  `Prepify API running on port ${app.server?.port}`,
);

export type App = typeof app;
