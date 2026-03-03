import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";

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
    swagger({
      documentation: {
        info: {
          title: "Prepify API",
          version: "0.0.1",
          description: "AI-powered study platform API",
        },
      },
    }),
  )
  .get("/health", () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }))
  .listen(process.env.PORT ?? 3001);

console.log(`Prepify API is running at http://localhost:${app.server?.port}`);

export type App = typeof app;
