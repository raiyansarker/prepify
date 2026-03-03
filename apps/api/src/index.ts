import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { Logestic } from "logestic";
import { uploadRoutes } from "#/routes/upload";
import { folderRoutes } from "#/routes/folders";
import { documentRoutes } from "#/routes/documents";
import { chatRoutes } from "#/routes/chat";
// import { apiLogger } from "#/lib/logger";

const app = new Elysia()
  .use(
    cors({
      origin:
        process.env.NODE_ENV === "production"
          ? [process.env.FRONTEND_URL!]
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
  .get("/health", () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }))
  .use(uploadRoutes)
  .use(folderRoutes)
  .use(documentRoutes)
  .use(chatRoutes)
  .listen(process.env.PORT ?? 3001);

// apiLogger.info({ port: app.server?.port }, "Prepify API is running");

export type App = typeof app;
