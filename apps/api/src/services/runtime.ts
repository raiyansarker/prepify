import { Effect, Layer, pipe, Logger } from "effect";
import {
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  DatabaseError,
  ExternalServiceError,
  type AppError,
} from "#/lib/errors";
import { DatabaseServiceLive } from "./database";
import { AiServiceLive } from "./ai";
import { LogLayer } from "#/lib/logger";
import { apiLogger } from "#/lib/logger";

// ============================================
// Main Application Layer (composes all service layers)
// ============================================

export const AppLayer = Layer.mergeAll(
  DatabaseServiceLive,
  AiServiceLive,
  LogLayer,
);

// ============================================
// Run an Effect program with the full app context
// ============================================

export const runEffect = <A, E extends AppError>(
  effect: Effect.Effect<A, E, never>,
): Promise<A> => {
  return Effect.runPromise(effect);
};

export const runEffectWithLayer = <A, E extends AppError>(
  effect: Effect.Effect<A, E, any>,
): Promise<A> => {
  return Effect.runPromise(
    pipe(effect, Effect.provide(AppLayer)) as Effect.Effect<A, E, never>,
  );
};

// ============================================
// Convert Effect errors to HTTP error responses
// ============================================

export type HttpErrorResponse = {
  status: number;
  body: {
    success: false;
    error: string;
    code: string;
    field?: string;
  };
};

export const mapErrorToHttp = (error: AppError): HttpErrorResponse => {
  switch (error._tag) {
    case "NotFoundError":
      return {
        status: 404,
        body: {
          success: false,
          error: `${error.entity} not found`,
          code: "NOT_FOUND",
        },
      };
    case "UnauthorizedError":
      return {
        status: 401,
        body: {
          success: false,
          error: error.message,
          code: "UNAUTHORIZED",
        },
      };
    case "ForbiddenError":
      return {
        status: 403,
        body: {
          success: false,
          error: error.message,
          code: "FORBIDDEN",
        },
      };
    case "ValidationError":
      return {
        status: 400,
        body: {
          success: false,
          error: error.message,
          code: "VALIDATION_ERROR",
          field: error.field,
        },
      };
    case "DatabaseError":
      return {
        status: 500,
        body: {
          success: false,
          error: "Internal server error",
          code: "DATABASE_ERROR",
        },
      };
    case "ExternalServiceError":
      return {
        status: 502,
        body: {
          success: false,
          error: `External service error: ${error.service}`,
          code: "EXTERNAL_SERVICE_ERROR",
        },
      };
    case "DocumentProcessingError":
      return {
        status: 422,
        body: {
          success: false,
          error: error.message,
          code: "DOCUMENT_PROCESSING_ERROR",
        },
      };
    case "ExamError":
      return {
        status: 400,
        body: {
          success: false,
          error: error.message,
          code: "EXAM_ERROR",
        },
      };
    case "ExamSessionExpiredError":
      return {
        status: 410,
        body: {
          success: false,
          error: "Exam session has expired",
          code: "EXAM_SESSION_EXPIRED",
        },
      };
    case "AiGenerationError":
      return {
        status: 500,
        body: {
          success: false,
          error: "AI generation failed",
          code: "AI_GENERATION_ERROR",
        },
      };
    case "StorageError":
      return {
        status: 500,
        body: {
          success: false,
          error: "Storage operation failed",
          code: "STORAGE_ERROR",
        },
      };
    default:
      return {
        status: 500,
        body: {
          success: false,
          error: "Internal server error",
          code: "UNKNOWN_ERROR",
        },
      };
  }
};

// ============================================
// effectHandler — bridge between Effect pipelines and Elysia routes
// ============================================
// Usage in route handlers:
//
//   .get("/items", async (ctx) => {
//     const auth = (ctx as unknown as { auth: Auth }).auth;
//     return effectHandler(ctx,
//       Effect.gen(function* () {
//         const items = yield* fetchItems(auth.userId);
//         return { success: true as const, data: items };
//       })
//     );
//   })
//
// - On success: returns the value from the Effect.
// - On tagged AppError: maps to HTTP status + consistent JSON body.
// - On unexpected (defect): logs and returns 500.

export async function effectHandler<A>(
  ctx: { set: { status?: number | string } },
  effect: Effect.Effect<A, AppError, any>,
): Promise<A | HttpErrorResponse["body"]> {
  const program = pipe(effect, Effect.provide(AppLayer)) as Effect.Effect<
    A,
    AppError,
    never
  >;

  return Effect.runPromise(
    pipe(
      program,
      Effect.catchAll((error: AppError) => {
        const httpError = mapErrorToHttp(error);

        // Log at appropriate level based on status
        const logCtx = {
          errorTag: error._tag,
          status: httpError.status,
          code: httpError.body.code,
          ...("cause" in error && error.cause
            ? { cause: String(error.cause) }
            : {}),
        };

        if (httpError.status >= 500) {
          apiLogger.error(logCtx, `Effect error: ${httpError.body.error}`);
        } else {
          apiLogger.warn(logCtx, `Effect error: ${httpError.body.error}`);
        }

        ctx.set.status = httpError.status;
        return Effect.succeed(httpError.body as HttpErrorResponse["body"]);
      }),
    ),
  ).catch((defect: unknown) => {
    // Unexpected errors (defects / thrown exceptions that aren't AppError)
    apiLogger.error({ err: defect }, "Unhandled defect in Effect pipeline");
    ctx.set.status = 500;
    return {
      success: false as const,
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    };
  });
}
