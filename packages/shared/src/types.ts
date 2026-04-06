// ============================================
// Document Types
// ============================================

export type DocumentStatus = "pending" | "processing" | "ready" | "failed";
export type DocumentType = "pdf" | "image" | "text";

// ============================================
// Exam Types
// ============================================

export type ExamType = "mcq" | "written" | "mixed";
export type ExamStatus =
  | "draft"
  | "generating"
  | "active"
  | "completed"
  | "failed";
export type ExamContextSource = "uploaded" | "global" | "both";
export type ExamDurationMode = "user_set" | "ai_decided";
export type QuestionType = "mcq" | "descriptive";

export type ExamSessionStatus = "in_progress" | "submitted" | "timed_out";

// ============================================
// Flashcard Types
// ============================================

export type FlashcardDifficulty = "easy" | "medium" | "hard";

// ============================================
// Chat Types
// ============================================

export type ChatRole = "user" | "assistant" | "system";

// ============================================
// Job Types
// ============================================

export type JobStatus = "pending" | "processing" | "completed" | "failed";

export type DocumentProcessingJob = {
  documentId: string;
  userId: string;
};

export type ExamGenerationJob = {
  examId: string;
  userId: string;
};

export type ExamGradingJob = {
  sessionId: string;
  userId: string;
};

export type FlashcardGenerationJob = {
  deckId: string;
  userId: string;
  topic: string;
  documentIds?: string[];
};

// ============================================
// API Response Types
// ============================================

export type ApiResponse<T> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      error: string;
      code?: string;
    };

// ============================================
// MCQ Option Type
// ============================================

export type McqOption = {
  id: string;
  text: string;
};

// ============================================
// Answer Attachment Type
// ============================================

export type AnswerAttachment = {
  s3Key: string;
  s3Url: string;
  mimeType: string;
};

// ============================================
// AI Grading Result
// ============================================

export type AiGradingResult = {
  score: number;
  maxScore: number;
  feedback: string;
  strengths: string[];
  weaknesses: string[];
};

// ============================================
// Exam Result Feedback
// ============================================

export type ExamResultFeedback = {
  overallFeedback: string;
  topicStrengths: string[];
  topicWeaknesses: string[];
  recommendations: string[];
};

// ============================================
// WebSocket Message Types
// ============================================

// Server → Client: Exam generation progress
export type WsExamGenerationMessage =
  | { type: "generation_started"; examId: string }
  | {
      type: "generation_progress";
      examId: string;
      current: number;
      total: number;
    }
  | { type: "generation_complete"; examId: string }
  | { type: "generation_failed"; examId: string; error: string };

// Server → Client: Exam timer sync
export type WsExamTimerMessage =
  | { type: "timer_sync"; sessionId: string; remainingSeconds: number }
  | { type: "exam_started"; sessionId: string; endsAt: string }
  | { type: "exam_submitted"; sessionId: string; reason: "user" | "timeout" };

// Server → Client: Grading progress
export type WsGradingMessage =
  | { type: "grading_started"; sessionId: string }
  | {
      type: "grading_progress";
      sessionId: string;
      current: number;
      total: number;
    }
  | { type: "grading_complete"; sessionId: string }
  | { type: "grading_failed"; sessionId: string; error: string };

// Union of all server → client messages
export type WsServerMessage =
  | WsExamGenerationMessage
  | WsExamTimerMessage
  | WsGradingMessage;

// Client → Server messages
export type WsClientMessage =
  | { type: "ping" }
  | { type: "submit_exam"; sessionId: string }
  | { type: "subscribe_exam"; examId: string }
  | { type: "subscribe_session"; sessionId: string }
  | { type: "unsubscribe_exam"; examId: string }
  | { type: "unsubscribe_session"; sessionId: string };
