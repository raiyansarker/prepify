import { Data } from "effect";

// ============================================
// Base Application Errors
// ============================================

export class NotFoundError extends Data.TaggedError("NotFoundError")<{
  readonly entity: string;
  readonly id: string;
}> {}

export class UnauthorizedError extends Data.TaggedError("UnauthorizedError")<{
  readonly message: string;
}> {}

export class ForbiddenError extends Data.TaggedError("ForbiddenError")<{
  readonly message: string;
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly message: string;
  readonly field?: string;
}> {}

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ExternalServiceError extends Data.TaggedError(
  "ExternalServiceError",
)<{
  readonly service: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ============================================
// Domain-Specific Errors
// ============================================

export class DocumentProcessingError extends Data.TaggedError(
  "DocumentProcessingError",
)<{
  readonly documentId: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ExamError extends Data.TaggedError("ExamError")<{
  readonly examId: string;
  readonly message: string;
}> {}

export class ExamSessionExpiredError extends Data.TaggedError(
  "ExamSessionExpiredError",
)<{
  readonly sessionId: string;
}> {}

export class AiGenerationError extends Data.TaggedError("AiGenerationError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class StorageError extends Data.TaggedError("StorageError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class RateLimitError extends Data.TaggedError("RateLimitError")<{
  readonly service: string;
  readonly message: string;
  readonly retryAfterMs?: number;
  readonly cause?: unknown;
}> {}

// ============================================
// Union type of all application errors
// ============================================

export type AppError =
  | NotFoundError
  | UnauthorizedError
  | ForbiddenError
  | ValidationError
  | DatabaseError
  | ExternalServiceError
  | DocumentProcessingError
  | ExamError
  | ExamSessionExpiredError
  | AiGenerationError
  | StorageError
  | RateLimitError;
