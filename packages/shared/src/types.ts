// ============================================
// Document Types
// ============================================

export type DocumentStatus = "pending" | "processing" | "ready" | "failed";
export type DocumentType = "pdf" | "image" | "text";

// ============================================
// Exam Types
// ============================================

export type ExamType = "mcq" | "written" | "mixed";
export type ExamStatus = "draft" | "active" | "completed";
export type ExamContextSource = "uploaded" | "global" | "both";
export type ExamDurationMode = "user_set" | "ai_decided";
export type QuestionType = "mcq" | "written";

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

export type WsExamTimerMessage =
  | { type: "timer_sync"; remainingSeconds: number }
  | { type: "exam_submitted"; reason: "user" | "timeout" }
  | { type: "exam_started"; endsAt: string };

export type WsClientMessage = { type: "submit_exam" } | { type: "ping" };
