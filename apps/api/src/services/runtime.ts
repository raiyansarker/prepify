import { Effect, Layer, pipe } from "effect";
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

// ============================================
// Main Application Layer (composes all service layers)
// ============================================

export const AppLayer = Layer.mergeAll(DatabaseServiceLive, AiServiceLive);

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

export const mapErrorToHttp = (error: AppError) => {
  switch (error._tag) {
    case "NotFoundError":
      return {
        status: 404 as const,
        body: {
          success: false as const,
          error: `${error.entity} not found`,
          code: "NOT_FOUND",
        },
      };
    case "UnauthorizedError":
      return {
        status: 401 as const,
        body: {
          success: false as const,
          error: error.message,
          code: "UNAUTHORIZED",
        },
      };
    case "ForbiddenError":
      return {
        status: 403 as const,
        body: {
          success: false as const,
          error: error.message,
          code: "FORBIDDEN",
        },
      };
    case "ValidationError":
      return {
        status: 400 as const,
        body: {
          success: false as const,
          error: error.message,
          code: "VALIDATION_ERROR",
          field: error.field,
        },
      };
    case "DatabaseError":
      return {
        status: 500 as const,
        body: {
          success: false as const,
          error: "Internal server error",
          code: "DATABASE_ERROR",
        },
      };
    case "ExternalServiceError":
      return {
        status: 502 as const,
        body: {
          success: false as const,
          error: `External service error: ${error.service}`,
          code: "EXTERNAL_SERVICE_ERROR",
        },
      };
    case "DocumentProcessingError":
      return {
        status: 422 as const,
        body: {
          success: false as const,
          error: error.message,
          code: "DOCUMENT_PROCESSING_ERROR",
        },
      };
    case "ExamError":
      return {
        status: 400 as const,
        body: {
          success: false as const,
          error: error.message,
          code: "EXAM_ERROR",
        },
      };
    case "ExamSessionExpiredError":
      return {
        status: 410 as const,
        body: {
          success: false as const,
          error: "Exam session has expired",
          code: "EXAM_SESSION_EXPIRED",
        },
      };
    case "AiGenerationError":
      return {
        status: 500 as const,
        body: {
          success: false as const,
          error: "AI generation failed",
          code: "AI_GENERATION_ERROR",
        },
      };
    case "StorageError":
      return {
        status: 500 as const,
        body: {
          success: false as const,
          error: "Storage operation failed",
          code: "STORAGE_ERROR",
        },
      };
    default:
      return {
        status: 500 as const,
        body: {
          success: false as const,
          error: "Internal server error",
          code: "UNKNOWN_ERROR",
        },
      };
  }
};
