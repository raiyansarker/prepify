import { Worker, type Job } from "bullmq";
import { Effect, Schedule } from "effect";
import { eq } from "drizzle-orm";
import { generateObject, generateText } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { db } from "#/db";
import { exams, examSessions, answers, questions, results } from "#/db/schema";
import { redisConnection } from "#/lib/redis";
import { QUEUE_NAMES } from "#/lib/queues";
import { workerLogger, LogLayer } from "#/lib/logger";
import { env } from "#/lib/env";
import { STRUCTURED_GEN_MODEL } from "#/services/ai";
import { DatabaseError, AiGenerationError } from "#/lib/errors";
import {
  aiGradingResultSchema,
  examResultFeedbackSchema,
} from "#/lib/exam-schemas";
import { publishEvent, channels } from "#/lib/pubsub";
import type { ExamGradingJob, AnswerAttachment } from "@repo/shared";

// ============================================
// AI Providers (standalone — workers run outside
// the Elysia request lifecycle)
// ============================================

const groq = createGroq({
  apiKey: env().ai.groqApiKey,
});

const google = createGoogleGenerativeAI({
  apiKey: env().ai.googleApiKey,
});

// ============================================
// Retry schedule for transient AI/network failures
// ============================================

const transientRetry = Schedule.exponential("3 seconds").pipe(
  Schedule.compose(Schedule.recurs(2)),
);

// ============================================
// Pipeline Steps
// ============================================

/** Step 1: Fetch session with all answers, their questions, and the parent exam */
const fetchSessionData = (sessionId: string) =>
  Effect.tryPromise({
    try: async () => {
      const session = await db.query.examSessions.findFirst({
        where: eq(examSessions.id, sessionId),
      });
      if (!session) return null;

      const exam = await db.query.exams.findFirst({
        where: eq(exams.id, session.examId),
      });
      if (!exam) return null;

      // Fetch all answers for this session
      const sessionAnswers = await db
        .select()
        .from(answers)
        .where(eq(answers.sessionId, sessionId));

      // Fetch all questions for the exam (to pair with answers)
      const examQuestions = await db
        .select()
        .from(questions)
        .where(eq(questions.examId, session.examId));

      const answerMap = new Map(sessionAnswers.map((answer) => [answer.questionId, answer]));
      const missingQuestions = examQuestions.filter(
        (question) => !answerMap.has(question.id),
      );

      if (missingQuestions.length > 0) {
        const createdAnswers = await db
          .insert(answers)
          .values(
            missingQuestions.map((question) => ({
              sessionId,
              questionId: question.id,
              userAnswer: null,
              attachments: null,
              answeredAt: new Date(),
            })),
          )
          .returning();

        for (const createdAnswer of createdAnswers) {
          answerMap.set(createdAnswer.questionId, createdAnswer);
        }
      }

      const answersWithQuestions = examQuestions.map((question) => ({
        question,
        answer: answerMap.get(question.id)!,
      }));

      return { session, exam, answersWithQuestions };
    },
    catch: (cause) =>
      new DatabaseError({
        message: "Failed to fetch session data for grading",
        cause,
      }),
  }).pipe(
    Effect.flatMap((data) =>
      data
        ? Effect.succeed(data)
        : Effect.fail(
            new DatabaseError({
              message: `Session or exam not found for grading`,
            }),
          ),
    ),
  );

/** Step 2: Extract text from an image attachment using Gemini */
const extractTextFromAttachment = (
  s3Url: string,
  mimeType: string,
  answerId: string,
) =>
  Effect.tryPromise({
    try: async () => {
      // Fetch the file from S3
      const res = await fetch(s3Url);
      if (!res.ok) {
        throw new Error(
          `Failed to fetch attachment: ${res.status} ${res.statusText}`,
        );
      }
      const fileBuffer = Buffer.from(await res.arrayBuffer());

      const { text } = await generateText({
        model: google("gemini-2.5-flash"),
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract all text and written content from this image. This is a student's exam answer. Preserve the original content, structure, and any formulas or diagrams described in text. Return only the extracted text with no commentary.",
              },
              {
                type: "file",
                data: fileBuffer,
                mediaType: mimeType as
                  | "image/jpeg"
                  | "image/png"
                  | "image/gif"
                  | "image/webp",
              },
            ],
          },
        ],
      });
      return text.trim();
    },
    catch: (cause) =>
      new AiGenerationError({
        message: `Failed to extract text from attachment for answer ${answerId}`,
        cause,
      }),
  }).pipe(Effect.retry(transientRetry));

/** Step 3: Grade a single descriptive answer using the structured generation model */
const gradeDescriptiveAnswer = (
  questionContent: string,
  correctAnswer: string,
  explanation: string | null,
  userAnswer: string,
  maxScore: number,
) =>
  Effect.tryPromise({
    try: async () => {
      const model = groq(STRUCTURED_GEN_MODEL);

      const { object } = await generateObject({
        model,
        schema: aiGradingResultSchema,
        prompt: `You are an expert exam grader for the study platform Prepify. Grade the following student answer fairly and constructively.

QUESTION:
${questionContent}

MODEL ANSWER:
${correctAnswer}

${explanation ? `GRADING RUBRIC:\n${explanation}\n` : ""}
MAXIMUM SCORE: ${maxScore}

STUDENT'S ANSWER:
${userAnswer}

GRADING GUIDELINES:
- Award partial credit where appropriate
- Score must be between 0 and ${maxScore}
- Be fair but thorough — check for key concepts and accuracy
- Provide specific, constructive feedback
- Identify concrete strengths and weaknesses
- Consider both factual accuracy and depth of understanding`,
      });

      return {
        ...object,
        // Clamp score to valid range
        score: Math.max(0, Math.min(maxScore, object.score)),
        maxScore,
      };
    },
    catch: (cause) =>
      new AiGenerationError({
        message: "AI grading failed for descriptive answer",
        cause,
      }),
  }).pipe(Effect.retry(transientRetry));

/** Step 4: Generate overall exam feedback */
const generateOverallFeedback = (
  examTitle: string,
  examTopic: string,
  totalScore: number,
  maxScore: number,
  percentage: number,
  gradingSummaries: {
    topic: string | null;
    type: string;
    score: number;
    maxScore: number;
  }[],
) =>
  Effect.tryPromise({
    try: async () => {
      const model = groq(STRUCTURED_GEN_MODEL);

      const summaryText = gradingSummaries
        .map(
          (s, i) =>
            `Q${i + 1} [${s.type}${s.topic ? ` - ${s.topic}` : ""}]: ${s.score}/${s.maxScore}`,
        )
        .join("\n");

      const { object } = await generateObject({
        model,
        schema: examResultFeedbackSchema,
        prompt: `You are an expert educational advisor for the study platform Prepify. Generate comprehensive feedback for a student's exam performance.

EXAM: ${examTitle}
TOPIC: ${examTopic}
OVERALL SCORE: ${totalScore}/${maxScore} (${percentage.toFixed(1)}%)

QUESTION-BY-QUESTION BREAKDOWN:
${summaryText}

FEEDBACK GUIDELINES:
- Provide an encouraging but honest overall assessment
- Identify specific topic areas of strength and weakness
- Give actionable, specific study recommendations
- Consider the score distribution across topics
- Keep recommendations practical and prioritized`,
      });

      return object;
    },
    catch: (cause) =>
      new AiGenerationError({
        message: "Failed to generate overall exam feedback",
        cause,
      }),
  }).pipe(Effect.retry(transientRetry));

/** Step 5: Update an answer row in the database */
const updateAnswer = (
  answerId: string,
  data: {
    isCorrect: boolean;
    score: number;
    aiGrading: typeof answers.$inferInsert.aiGrading;
    extractedText?: string | null;
  },
) =>
  Effect.tryPromise({
    try: () =>
      db
        .update(answers)
        .set({
          isCorrect: data.isCorrect,
          score: data.score,
          aiGrading: data.aiGrading,
          ...(data.extractedText !== undefined
            ? { extractedText: data.extractedText }
            : {}),
        })
        .where(eq(answers.id, answerId)),
    catch: (cause) =>
      new DatabaseError({
        message: `Failed to update answer ${answerId}`,
        cause,
      }),
  });

/** Step 6: Insert result row */
const insertResult = (data: typeof results.$inferInsert) =>
  Effect.tryPromise({
    try: () => db.insert(results).values(data),
    catch: (cause) =>
      new DatabaseError({
        message: "Failed to insert exam result",
        cause,
      }),
  });

/** Step 7: Update exam status to completed */
const updateExamStatus = (examId: string) =>
  Effect.tryPromise({
    try: () =>
      db
        .update(exams)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(exams.id, examId)),
    catch: (cause) =>
      new DatabaseError({
        message: "Failed to update exam status to completed",
        cause,
      }),
  });

// ============================================
// Main grading pipeline
// ============================================

const processExamGrading = (
  sessionId: string,
  userId: string,
  reportProgress: (pct: number) => Promise<void>,
) =>
  Effect.gen(function* () {
    yield* Effect.logInfo("Starting exam grading").pipe(
      Effect.annotateLogs("sessionId", sessionId),
    );

    // 1. Fetch all data
    const { session, exam, answersWithQuestions } =
      yield* fetchSessionData(sessionId);

    yield* Effect.tryPromise({
      try: () => reportProgress(5),
      catch: () =>
        new AiGenerationError({ message: "Failed to report progress" }),
    });

    const totalAnswers = answersWithQuestions.length;

    // 2. Publish grading_started
    yield* Effect.tryPromise({
      try: () =>
        publishEvent(channels.session(sessionId), {
          type: "grading_started",
          sessionId,
        }),
      catch: () =>
        new AiGenerationError({ message: "Failed to publish WS event" }),
    });
    yield* Effect.tryPromise({
      try: () =>
        publishEvent(channels.user(userId), {
          type: "grading_started",
          sessionId,
        }),
      catch: () =>
        new AiGenerationError({ message: "Failed to publish WS event" }),
    });

    yield* Effect.tryPromise({
      try: () => reportProgress(10),
      catch: () =>
        new AiGenerationError({ message: "Failed to report progress" }),
    });

    // 3. Grade each answer sequentially
    const gradingSummaries: {
      topic: string | null;
      type: string;
      score: number;
      maxScore: number;
    }[] = [];

    // Reserve 10-85% of progress for grading individual answers
    const progressPerAnswer = totalAnswers > 0 ? 75 / totalAnswers : 0;

    for (let i = 0; i < answersWithQuestions.length; i++) {
      const { answer, question } = answersWithQuestions[i]!;

      if (question.type === "mcq") {
        // ---- MCQ: deterministic grading ----
        const isCorrect =
          answer.userAnswer !== null &&
          answer.userAnswer === question.correctAnswer;
        const score = isCorrect ? question.points : 0;

        yield* updateAnswer(answer.id, {
          isCorrect,
          score,
          aiGrading: null,
        });

        gradingSummaries.push({
          topic: question.topic,
          type: "mcq",
          score,
          maxScore: question.points,
        });
      } else {
        // ---- Descriptive: AI grading ----
        let fullAnswer = answer.userAnswer ?? "";

        // Extract text from image attachments if present
        const attachmentList =
          (answer.attachments as AnswerAttachment[] | null) ?? [];
        if (attachmentList.length > 0) {
          const extractedParts: string[] = [];

          for (const attachment of attachmentList) {
            const extracted = yield* extractTextFromAttachment(
              attachment.s3Url,
              attachment.mimeType,
              answer.id,
            );
            if (extracted.length > 0) {
              extractedParts.push(extracted);
            }
          }

          const combinedExtracted = extractedParts.join("\n\n");

          // Combine typed answer with extracted text
          if (combinedExtracted.length > 0) {
            fullAnswer = fullAnswer
              ? `${fullAnswer}\n\n--- Extracted from uploaded images ---\n\n${combinedExtracted}`
              : combinedExtracted;
          }

          // Store extracted text on the answer row
          yield* updateAnswer(answer.id, {
            isCorrect: false, // placeholder — will be updated after grading
            score: 0,
            aiGrading: null,
            extractedText: combinedExtracted || null,
          });
        }

        // If the student didn't answer at all
        if (!fullAnswer || fullAnswer.trim().length === 0) {
          yield* updateAnswer(answer.id, {
            isCorrect: false,
            score: 0,
            aiGrading: {
              score: 0,
              maxScore: question.points,
              feedback: "No answer was provided.",
              strengths: [],
              weaknesses: ["No answer submitted"],
            },
            ...(attachmentList.length > 0 ? {} : {}),
          });

          gradingSummaries.push({
            topic: question.topic,
            type: "descriptive",
            score: 0,
            maxScore: question.points,
          });
        } else {
          // Grade with AI
          const gradingResult = yield* gradeDescriptiveAnswer(
            question.content,
            question.correctAnswer,
            question.explanation,
            fullAnswer,
            question.points,
          );

          const isCorrect = gradingResult.score >= question.points * 0.5;

          yield* updateAnswer(answer.id, {
            isCorrect,
            score: gradingResult.score,
            aiGrading: gradingResult,
            ...(attachmentList.length > 0
              ? {} // extractedText already set above
              : {}),
          });

          gradingSummaries.push({
            topic: question.topic,
            type: "descriptive",
            score: gradingResult.score,
            maxScore: question.points,
          });
        }
      }

      // Publish grading_progress after each answer
      yield* Effect.tryPromise({
        try: () =>
          publishEvent(channels.session(sessionId), {
            type: "grading_progress",
            sessionId,
            current: i + 1,
            total: totalAnswers,
          }),
        catch: () =>
          new AiGenerationError({ message: "Failed to publish WS event" }),
      });

      yield* Effect.tryPromise({
        try: () => reportProgress(Math.round(10 + (i + 1) * progressPerAnswer)),
        catch: () =>
          new AiGenerationError({ message: "Failed to report progress" }),
      });
    }

    yield* Effect.logInfo("Individual answer grading complete").pipe(
      Effect.annotateLogs("sessionId", sessionId),
      Effect.annotateLogs("totalAnswers", String(totalAnswers)),
    );

    // 4. Aggregate scores
    const totalScore = gradingSummaries.reduce((sum, s) => sum + s.score, 0);
    const maxScore = gradingSummaries.reduce((sum, s) => sum + s.maxScore, 0);
    const percentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;

    yield* Effect.tryPromise({
      try: () => reportProgress(88),
      catch: () =>
        new AiGenerationError({ message: "Failed to report progress" }),
    });

    // 5. Generate overall feedback via AI
    yield* Effect.logInfo("Generating overall exam feedback").pipe(
      Effect.annotateLogs("sessionId", sessionId),
      Effect.annotateLogs("totalScore", String(totalScore)),
      Effect.annotateLogs("maxScore", String(maxScore)),
    );

    const feedback = yield* generateOverallFeedback(
      exam.title,
      exam.topic,
      totalScore,
      maxScore,
      percentage,
      gradingSummaries,
    );

    yield* Effect.tryPromise({
      try: () => reportProgress(93),
      catch: () =>
        new AiGenerationError({ message: "Failed to report progress" }),
    });

    // 6. Insert result row
    yield* insertResult({
      sessionId,
      totalScore,
      maxScore,
      percentage,
      feedback,
      completedAt: new Date(),
    });

    // 7. Update exam status to completed
    yield* updateExamStatus(exam.id);

    yield* Effect.tryPromise({
      try: () => reportProgress(96),
      catch: () =>
        new AiGenerationError({ message: "Failed to report progress" }),
    });

    // 8. Publish grading_complete
    yield* Effect.tryPromise({
      try: () =>
        publishEvent(channels.session(sessionId), {
          type: "grading_complete",
          sessionId,
        }),
      catch: () =>
        new AiGenerationError({ message: "Failed to publish WS event" }),
    });
    yield* Effect.tryPromise({
      try: () =>
        publishEvent(channels.user(userId), {
          type: "grading_complete",
          sessionId,
        }),
      catch: () =>
        new AiGenerationError({ message: "Failed to publish WS event" }),
    });

    yield* Effect.tryPromise({
      try: () => reportProgress(100),
      catch: () =>
        new AiGenerationError({ message: "Failed to report progress" }),
    });

    yield* Effect.logInfo("Exam grading completed successfully").pipe(
      Effect.annotateLogs("sessionId", sessionId),
      Effect.annotateLogs("totalScore", String(totalScore)),
      Effect.annotateLogs("maxScore", String(maxScore)),
      Effect.annotateLogs("percentage", String(percentage.toFixed(1))),
    );

    return { totalScore, maxScore, percentage };
  }).pipe(
    // On any failure, publish grading_failed event (best-effort)
    // NOTE: We do NOT update exam/session status to "failed" on grading failure
    Effect.tapError((error) =>
      Effect.gen(function* () {
        yield* Effect.logError("Exam grading failed").pipe(
          Effect.annotateLogs("sessionId", sessionId),
          Effect.annotateLogs("error", String(error)),
        );

        // Best-effort: publish failure event to session channel
        yield* Effect.tryPromise({
          try: () =>
            publishEvent(channels.session(sessionId), {
              type: "grading_failed",
              sessionId,
              error:
                error instanceof AiGenerationError
                  ? error.message
                  : "Exam grading failed unexpectedly",
            }),
          catch: () =>
            new AiGenerationError({
              message: "Failed to publish failure event",
            }),
        }).pipe(Effect.catchAll(() => Effect.void));

        // Best-effort: publish failure event to user channel
        yield* Effect.tryPromise({
          try: () =>
            publishEvent(channels.user(userId), {
              type: "grading_failed",
              sessionId,
              error: "Exam grading failed",
            }),
          catch: () =>
            new AiGenerationError({
              message: "Failed to publish failure event",
            }),
        }).pipe(Effect.catchAll(() => Effect.void));
      }),
    ),
  );

// ============================================
// BullMQ Worker
// ============================================

const worker = new Worker<ExamGradingJob>(
  QUEUE_NAMES.EXAM_GRADING,
  async (job: Job<ExamGradingJob>) => {
    const { sessionId, userId } = job.data;

    return Effect.runPromise(
      processExamGrading(sessionId, userId, (pct) =>
        job.updateProgress(pct),
      ).pipe(Effect.provide(LogLayer)),
    );
  },
  {
    connection: redisConnection,
    concurrency: 2,
  },
);

worker.on("completed", (job, returnvalue) => {
  workerLogger.info(
    { jobId: job.id, result: returnvalue },
    "Exam grading job completed",
  );
});

worker.on("failed", (job, error) => {
  workerLogger.error({ jobId: job?.id, err: error }, "Exam grading job failed");
});

worker.on("error", (err) => {
  workerLogger.error({ err }, "Exam grading worker error");
});

workerLogger.info("Exam grading worker running");
