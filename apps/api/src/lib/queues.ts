import { Queue } from "bullmq";
import { redisConnection } from "./redis";
import type {
  DocumentProcessingJob,
  ExamGenerationJob,
  ExamGradingJob,
  FlashcardGenerationJob,
} from "@repo/shared";

// ============================================
// Queue Names
// ============================================

export const QUEUE_NAMES = {
  DOCUMENT_PROCESSING: "document-processing",
  EXAM_GENERATION: "exam-generation",
  EXAM_GRADING: "exam-grading",
  FLASHCARD_GENERATION: "flashcard-generation",
} as const;

// ============================================
// Queue Instances
// ============================================

export const documentProcessingQueue = new Queue<DocumentProcessingJob>(
  QUEUE_NAMES.DOCUMENT_PROCESSING,
  {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  },
);

export const examGenerationQueue = new Queue<ExamGenerationJob>(
  QUEUE_NAMES.EXAM_GENERATION,
  {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  },
);

export const examGradingQueue = new Queue<ExamGradingJob>(
  QUEUE_NAMES.EXAM_GRADING,
  {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: "exponential",
        delay: 3000,
      },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  },
);

export const flashcardGenerationQueue = new Queue<FlashcardGenerationJob>(
  QUEUE_NAMES.FLASHCARD_GENERATION,
  {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: "exponential",
        delay: 3000,
      },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  },
);
