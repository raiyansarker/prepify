// ============================================
// Application Constants
// ============================================

export const APP_NAME = "Prepify";

// ============================================
// Upload Limits
// ============================================

export const MAX_FILE_SIZE_MB = 50;
export const MAX_IMAGE_SIZE_MB = 10;
export const ALLOWED_DOCUMENT_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
] as const;
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

// ============================================
// Exam Defaults
// ============================================

export const DEFAULT_EXAM_DURATION_MINUTES = 30;
export const MIN_EXAM_DURATION_MINUTES = 5;
export const MAX_EXAM_DURATION_MINUTES = 180;
export const DEFAULT_QUESTION_COUNT = 10;
export const MIN_QUESTION_COUNT = 5;
export const MAX_QUESTION_COUNT = 50;
export const MCQ_OPTIONS_COUNT = 4;

// ============================================
// Flashcard Defaults (SM-2 Algorithm)
// ============================================

export const SM2_DEFAULT_EASE_FACTOR = 2.5;
export const SM2_MIN_EASE_FACTOR = 1.3;
export const SM2_DEFAULT_INTERVAL = 1; // days

// ============================================
// RAG / Embedding
// ============================================

export const EMBEDDING_DIMENSIONS = 1024;
export const CHUNK_SIZE = 1000; // characters
export const CHUNK_OVERLAP = 200; // characters
export const MAX_CONTEXT_CHUNKS = 10;

// ============================================
// API Routes
// ============================================

export const API_BASE_URL =
  process.env.NODE_ENV === "production"
    ? "https://api.prepify.app"
    : "http://localhost:3001";
