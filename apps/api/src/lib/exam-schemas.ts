import { z } from "zod";
import { MCQ_OPTIONS_COUNT } from "@repo/shared";

// ============================================
// Zod schemas for AI structured output
// ============================================
// Used with Vercel AI SDK `generateObject()` to get
// type-safe, validated responses from the structured generation model.

// ============================================
// MCQ Question Schema
// ============================================

export const mcqQuestionSchema = z.object({
  topic: z
    .string()
    .describe(
      "Specific subtopic this question covers, e.g. 'Photosynthesis - Light Reactions'",
    ),
  content: z.string().describe("The full question text"),
  options: z
    .array(
      z.object({
        id: z.string().describe("Option identifier: 'a', 'b', 'c', or 'd'"),
        text: z.string().describe("The option text"),
      }),
    )
    .length(MCQ_OPTIONS_COUNT)
    .describe(`Exactly ${MCQ_OPTIONS_COUNT} answer options`),
  correctAnswer: z
    .string()
    .describe("The id of the correct option (e.g. 'a', 'b', 'c', or 'd')"),
  explanation: z
    .string()
    .describe("Brief explanation of why the correct answer is right"),
});

// ============================================
// Descriptive Question Schema
// ============================================

export const descriptiveQuestionSchema = z.object({
  topic: z
    .string()
    .describe(
      "Specific subtopic this question covers, e.g. 'Photosynthesis - Light Reactions'",
    ),
  content: z.string().describe("The full question text"),
  correctAnswer: z
    .string()
    .describe(
      "A model answer that covers the key points expected in a good response",
    ),
  explanation: z
    .string()
    .describe(
      "Grading rubric: what key points and depth are expected for full marks",
    ),
});

// ============================================
// Full Exam Generation Response Schema
// ============================================

/** Schema for MCQ-only exams */
export const mcqExamResponseSchema = z.object({
  questions: z
    .array(mcqQuestionSchema)
    .describe("Array of multiple-choice questions"),
  suggestedDurationMinutes: z
    .number()
    .int()
    .min(5)
    .max(180)
    .describe(
      "Suggested exam duration in minutes based on question count and difficulty. Only used when durationMode is ai_decided.",
    ),
});

/** Schema for descriptive-only exams (type = 'written') */
export const descriptiveExamResponseSchema = z.object({
  questions: z
    .array(descriptiveQuestionSchema)
    .describe("Array of descriptive/written questions"),
  suggestedDurationMinutes: z
    .number()
    .int()
    .min(5)
    .max(180)
    .describe(
      "Suggested exam duration in minutes based on question count and difficulty. Only used when durationMode is ai_decided.",
    ),
});

/** Schema for mixed exams (both MCQ and descriptive) */
export const mixedExamResponseSchema = z.object({
  mcqQuestions: z
    .array(mcqQuestionSchema)
    .describe("Array of multiple-choice questions"),
  descriptiveQuestions: z
    .array(descriptiveQuestionSchema)
    .describe("Array of descriptive/written questions"),
  suggestedDurationMinutes: z
    .number()
    .int()
    .min(5)
    .max(180)
    .describe(
      "Suggested exam duration in minutes based on question count and difficulty. Only used when durationMode is ai_decided.",
    ),
});

// ============================================
// AI Grading Schemas (used by exam-grading worker)
// ============================================

/** Schema for grading a single descriptive answer via generateObject() */
export const aiGradingResultSchema = z.object({
  score: z
    .number()
    .min(0)
    .describe("Score awarded for this answer (0 to maxScore)"),
  maxScore: z
    .number()
    .min(1)
    .describe("Maximum possible score for this question"),
  feedback: z
    .string()
    .describe(
      "Detailed feedback explaining the grade — what was good and what was missing",
    ),
  strengths: z
    .array(z.string())
    .describe("Specific strengths in the student's answer"),
  weaknesses: z
    .array(z.string())
    .describe("Specific weaknesses or missing points in the student's answer"),
});

/** Schema for generating overall exam result feedback via generateObject() */
export const examResultFeedbackSchema = z.object({
  overallFeedback: z
    .string()
    .describe(
      "A comprehensive summary of the student's performance across the entire exam",
    ),
  topicStrengths: z
    .array(z.string())
    .describe("Topics/areas where the student performed well"),
  topicWeaknesses: z
    .array(z.string())
    .describe("Topics/areas where the student needs improvement"),
  recommendations: z
    .array(z.string())
    .describe("Actionable study recommendations to help the student improve"),
});

// ============================================
// Inferred Types
// ============================================

export type McqQuestionOutput = z.infer<typeof mcqQuestionSchema>;
export type DescriptiveQuestionOutput = z.infer<
  typeof descriptiveQuestionSchema
>;
export type McqExamResponse = z.infer<typeof mcqExamResponseSchema>;
export type DescriptiveExamResponse = z.infer<
  typeof descriptiveExamResponseSchema
>;
export type MixedExamResponse = z.infer<typeof mixedExamResponseSchema>;
export type AiGradingResultOutput = z.infer<typeof aiGradingResultSchema>;
export type ExamResultFeedbackOutput = z.infer<typeof examResultFeedbackSchema>;
