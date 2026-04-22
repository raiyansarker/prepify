import { Worker, type Job } from "bullmq";
import { Effect, Schedule } from "effect";
import { eq } from "drizzle-orm";
import { generateObject } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { db } from "#/db";
import { exams, examDocuments, questions } from "#/db/schema";
import { redisConnection } from "#/lib/redis";
import { QUEUE_NAMES } from "#/lib/queues";
import { workerLogger, LogLayer } from "#/lib/logger";
import { env } from "#/lib/env";
import { STRUCTURED_GEN_MODEL } from "#/services/ai";
import { DatabaseError, AiGenerationError, ExamError } from "#/lib/errors";
import { findSimilarChunks, buildContextFromChunks } from "#/lib/similarity";
import {
  mcqExamResponseSchema,
  descriptiveExamResponseSchema,
  mixedExamResponseSchema,
  type McqQuestionOutput,
  type DescriptiveQuestionOutput,
} from "#/lib/exam-schemas";
import { publishEvent, channels } from "#/lib/pubsub";
import {
  DEFAULT_EXAM_DURATION_MINUTES,
  MAX_CONTEXT_CHUNKS,
} from "@repo/shared";
import type { ExamGenerationJob, McqOption } from "@repo/shared";

// ============================================
// AI Provider (standalone — not from Effect layer since workers
// run outside the Elysia request lifecycle)
// ============================================

const groq = createGroq({
  apiKey: env().ai.groqApiKey,
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

/** Step 1: Fetch exam record with linked document IDs */
const fetchExam = (examId: string) =>
  Effect.tryPromise({
    try: async () => {
      const exam = await db.query.exams.findFirst({
        where: eq(exams.id, examId),
      });
      if (!exam) return null;

      const linkedDocs = await db
        .select({ documentId: examDocuments.documentId })
        .from(examDocuments)
        .where(eq(examDocuments.examId, examId));

      return {
        ...exam,
        documentIds: linkedDocs.map((d) => d.documentId),
      };
    },
    catch: (cause) =>
      new DatabaseError({ message: "Failed to fetch exam record", cause }),
  }).pipe(
    Effect.flatMap((exam) =>
      exam
        ? Effect.succeed(exam)
        : Effect.fail(
            new ExamError({ examId, message: `Exam ${examId} not found` }),
          ),
    ),
  );

/** Step 2: Update exam status */
const updateExamStatus = (
  examId: string,
  status: "generating" | "active" | "failed",
  extra?: Record<string, unknown>,
) =>
  Effect.tryPromise({
    try: () =>
      db
        .update(exams)
        .set({ status, updatedAt: new Date(), ...extra })
        .where(eq(exams.id, examId)),
    catch: (cause) =>
      new DatabaseError({
        message: `Failed to update exam status to ${status}`,
        cause,
      }),
  });

/** Step 3: Retrieve RAG context from user's documents */
const retrieveContext = (
  topic: string,
  userId: string,
  contextSource: string,
  documentIds: string[],
) =>
  Effect.tryPromise({
    try: async () => {
      // "global" means no document context — AI uses general knowledge only
      if (contextSource === "global") {
        return "";
      }

      const chunks = await findSimilarChunks(topic, userId, {
        documentIds: documentIds.length > 0 ? documentIds : undefined,
        limit: MAX_CONTEXT_CHUNKS,
        minSimilarity: 0.25,
      });

      if (chunks.length === 0) {
        workerLogger.warn(
          { topic, contextSource, documentIds },
          "No similar chunks found for exam topic — falling back to general knowledge",
        );
        return "";
      }

      return buildContextFromChunks(chunks);
    },
    catch: (cause) =>
      new AiGenerationError({
        message: "Failed to retrieve document context for exam generation",
        cause,
      }),
  });

/** Step 4: Build the system prompt for question generation */
const buildSystemPrompt = (
  examType: string,
  questionCount: number,
  topic: string,
  contextSource: string,
  durationMode: string,
  context: string,
) => {
  const hasContext = context.length > 0;

  let contextInstructions: string;
  if (contextSource === "global") {
    contextInstructions = `Use your general knowledge about "${topic}" to generate questions. Do NOT reference any specific documents.`;
  } else if (contextSource === "uploaded" && hasContext) {
    contextInstructions = `Generate questions STRICTLY based on the provided document context below. Do NOT use general knowledge beyond what is in the documents.`;
  } else if (contextSource === "both" && hasContext) {
    contextInstructions = `Use the provided document context as PRIMARY source material, but supplement with your general knowledge about "${topic}" where appropriate.`;
  } else {
    // "uploaded" or "both" but no context found — fall back
    contextInstructions = `No document context was available. Use your general knowledge about "${topic}" to generate questions.`;
  }

  let typeInstructions: string;
  if (examType === "mcq") {
    typeInstructions = `Generate exactly ${questionCount} multiple-choice questions. Each question must have exactly 4 options (a, b, c, d) with exactly one correct answer.`;
  } else if (examType === "written") {
    typeInstructions = `Generate exactly ${questionCount} descriptive/written questions that require detailed text answers.`;
  } else {
    // mixed — split roughly evenly
    const mcqCount = Math.ceil(questionCount / 2);
    const descCount = questionCount - mcqCount;
    typeInstructions = `Generate a mix of questions: exactly ${mcqCount} multiple-choice questions and exactly ${descCount} descriptive/written questions.`;
  }

  const durationInstructions =
    durationMode === "ai_decided"
      ? `Also suggest an appropriate exam duration in minutes based on the number and complexity of questions. Consider that MCQ questions take ~1-2 minutes each and descriptive questions take ~3-5 minutes each.`
      : `The exam duration has already been set by the user — still provide suggestedDurationMinutes but it may be ignored.`;

  let prompt = `You are an expert exam question generator for the study platform Prepify.

TOPIC: ${topic}

${contextInstructions}

${typeInstructions}

${durationInstructions}

QUESTION QUALITY GUIDELINES:
- Questions should test understanding, not just memorization
- Cover different subtopics within the main topic
- For each question, provide a specific subtopic label (e.g., "Photosynthesis - Light Reactions")
- MCQ distractors should be plausible but clearly wrong
- Descriptive questions should have clear model answers covering key points
- Explanations should be educational and help the student learn
- Vary difficulty: include easy, medium, and challenging questions
- Avoid ambiguous or trick questions`;

  if (hasContext) {
    prompt += `\n\n--- DOCUMENT CONTEXT ---\n\n${context}`;
  }

  return prompt;
};

/** Step 5: Call AI to generate questions via structured output */
const generateQuestions = (
  examType: string,
  systemPrompt: string,
  examId: string,
) =>
  Effect.tryPromise({
    try: async () => {
      const model = groq(STRUCTURED_GEN_MODEL);

      if (examType === "mcq") {
        const { object } = await generateObject({
          model,
          schema: mcqExamResponseSchema,
          prompt: systemPrompt,
        });
        return {
          mcqQuestions: object.questions,
          descriptiveQuestions: [] as DescriptiveQuestionOutput[],
          suggestedDurationMinutes: object.suggestedDurationMinutes,
        };
      }

      if (examType === "written") {
        const { object } = await generateObject({
          model,
          schema: descriptiveExamResponseSchema,
          prompt: systemPrompt,
        });
        return {
          mcqQuestions: [] as McqQuestionOutput[],
          descriptiveQuestions: object.questions,
          suggestedDurationMinutes: object.suggestedDurationMinutes,
        };
      }

      // mixed
      const { object } = await generateObject({
        model,
        schema: mixedExamResponseSchema,
        prompt: systemPrompt,
      });
      return {
        mcqQuestions: object.mcqQuestions,
        descriptiveQuestions: object.descriptiveQuestions,
        suggestedDurationMinutes: object.suggestedDurationMinutes,
      };
    },
    catch: (cause) =>
      new AiGenerationError({
        message: `AI question generation failed for exam ${examId}`,
        cause,
      }),
  }).pipe(Effect.retry(transientRetry));

/** Step 6: Store generated questions in the database */
const storeQuestions = (
  examId: string,
  mcqQuestions: McqQuestionOutput[],
  descriptiveQuestions: DescriptiveQuestionOutput[],
) =>
  Effect.tryPromise({
    try: async () => {
      const questionRecords: (typeof questions.$inferInsert)[] = [];

      // Add MCQ questions
      mcqQuestions.forEach((q, i) => {
        questionRecords.push({
          examId,
          type: "mcq" as const,
          topic: q.topic,
          content: q.content,
          options: q.options as McqOption[],
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
          points: 1,
          orderIndex: i,
        });
      });

      // Add descriptive questions (after MCQ in ordering)
      descriptiveQuestions.forEach((q, i) => {
        questionRecords.push({
          examId,
          type: "descriptive" as const,
          topic: q.topic,
          content: q.content,
          options: null,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
          points: 2, // descriptive questions worth more
          orderIndex: mcqQuestions.length + i,
        });
      });

      if (questionRecords.length === 0) {
        throw new Error("No questions generated");
      }

      // Batch insert
      const BATCH_SIZE = 25;
      for (let i = 0; i < questionRecords.length; i += BATCH_SIZE) {
        const batch = questionRecords.slice(i, i + BATCH_SIZE);
        await db.insert(questions).values(batch);
      }

      return questionRecords.length;
    },
    catch: (cause) =>
      new DatabaseError({
        message: "Failed to store generated questions",
        cause,
      }),
  });

// ============================================
// Main processing pipeline
// ============================================

const processExamGeneration = (
  examId: string,
  userId: string,
  reportProgress: (pct: number) => Promise<void>,
) =>
  Effect.gen(function* () {
    yield* Effect.logInfo("Starting exam generation").pipe(
      Effect.annotateLogs("examId", examId),
    );

    // 1. Fetch exam record
    const exam = yield* fetchExam(examId);
    yield* Effect.tryPromise({
      try: () => reportProgress(5),
      catch: () =>
        new AiGenerationError({ message: "Failed to report progress" }),
    });

    // 2. Mark as generating & publish WS event
    yield* updateExamStatus(examId, "generating");
    yield* Effect.tryPromise({
      try: () =>
        publishEvent(channels.exam(examId), {
          type: "generation_started",
          examId,
        }),
      catch: () =>
        new AiGenerationError({ message: "Failed to publish WS event" }),
    });
    yield* Effect.tryPromise({
      try: () => reportProgress(10),
      catch: () =>
        new AiGenerationError({ message: "Failed to report progress" }),
    });

    // 3. Retrieve RAG context
    yield* Effect.logInfo("Retrieving document context").pipe(
      Effect.annotateLogs("examId", examId),
      Effect.annotateLogs("contextSource", exam.contextSource),
    );
    const context = yield* retrieveContext(
      exam.topic,
      userId,
      exam.contextSource,
      exam.documentIds,
    );
    yield* Effect.tryPromise({
      try: () => reportProgress(30),
      catch: () =>
        new AiGenerationError({ message: "Failed to report progress" }),
    });

    // 4. Build system prompt
    const systemPrompt = buildSystemPrompt(
      exam.type,
      exam.questionCount,
      exam.topic,
      exam.contextSource,
      exam.durationMode,
      context,
    );
    yield* Effect.logInfo("System prompt built").pipe(
      Effect.annotateLogs("examId", examId),
      Effect.annotateLogs("promptLength", String(systemPrompt.length)),
      Effect.annotateLogs("hasContext", String(context.length > 0)),
    );

    // Publish progress — about to call AI
    yield* Effect.tryPromise({
      try: () =>
        publishEvent(channels.exam(examId), {
          type: "generation_progress",
          examId,
          current: 0,
          total: exam.questionCount,
        }),
      catch: () =>
        new AiGenerationError({ message: "Failed to publish WS event" }),
    });
    yield* Effect.tryPromise({
      try: () => reportProgress(40),
      catch: () =>
        new AiGenerationError({ message: "Failed to report progress" }),
    });

    // 5. Call AI for structured question generation
    yield* Effect.logInfo("Calling AI for question generation").pipe(
      Effect.annotateLogs("examId", examId),
      Effect.annotateLogs("model", STRUCTURED_GEN_MODEL),
      Effect.annotateLogs("examType", exam.type),
      Effect.annotateLogs("questionCount", String(exam.questionCount)),
    );
    const generated = yield* generateQuestions(exam.type, systemPrompt, examId);

    const totalGenerated =
      generated.mcqQuestions.length + generated.descriptiveQuestions.length;

    yield* Effect.logInfo("AI generation complete").pipe(
      Effect.annotateLogs("examId", examId),
      Effect.annotateLogs("mcqCount", String(generated.mcqQuestions.length)),
      Effect.annotateLogs(
        "descriptiveCount",
        String(generated.descriptiveQuestions.length),
      ),
      Effect.annotateLogs(
        "suggestedDuration",
        String(generated.suggestedDurationMinutes),
      ),
    );

    // Publish progress — AI done, storing questions
    yield* Effect.tryPromise({
      try: () =>
        publishEvent(channels.exam(examId), {
          type: "generation_progress",
          examId,
          current: totalGenerated,
          total: totalGenerated,
        }),
      catch: () =>
        new AiGenerationError({ message: "Failed to publish WS event" }),
    });
    yield* Effect.tryPromise({
      try: () => reportProgress(75),
      catch: () =>
        new AiGenerationError({ message: "Failed to report progress" }),
    });

    // 6. Store questions in DB
    const storedCount = yield* storeQuestions(
      examId,
      generated.mcqQuestions,
      generated.descriptiveQuestions,
    );
    yield* Effect.tryPromise({
      try: () => reportProgress(90),
      catch: () =>
        new AiGenerationError({ message: "Failed to report progress" }),
    });

    // 7. Update exam to "active" with duration
    const durationMinutes =
      exam.durationMode === "ai_decided"
        ? generated.suggestedDurationMinutes
        : (exam.durationMinutes ?? DEFAULT_EXAM_DURATION_MINUTES);

    yield* updateExamStatus(examId, "active", { durationMinutes });

    // 8. Publish completion event
    yield* Effect.tryPromise({
      try: () =>
        publishEvent(channels.exam(examId), {
          type: "generation_complete",
          examId,
        }),
      catch: () =>
        new AiGenerationError({ message: "Failed to publish WS event" }),
    });

    // Also publish to user channel for dashboard updates
    yield* Effect.tryPromise({
      try: () =>
        publishEvent(channels.user(userId), {
          type: "generation_complete",
          examId,
        }),
      catch: () =>
        new AiGenerationError({ message: "Failed to publish WS event" }),
    });

    yield* Effect.tryPromise({
      try: () => reportProgress(100),
      catch: () =>
        new AiGenerationError({ message: "Failed to report progress" }),
    });

    yield* Effect.logInfo("Exam generation completed successfully").pipe(
      Effect.annotateLogs("examId", examId),
      Effect.annotateLogs("questionsStored", String(storedCount)),
      Effect.annotateLogs("durationMinutes", String(durationMinutes)),
    );

    return { questionsStored: storedCount, durationMinutes };
  }).pipe(
    // On any failure, mark exam as failed and publish failure event
    Effect.tapError((error) =>
      Effect.gen(function* () {
        yield* Effect.logError("Exam generation failed").pipe(
          Effect.annotateLogs("examId", examId),
          Effect.annotateLogs("error", String(error)),
        );

        // Best-effort: update exam status to "failed"
        yield* updateExamStatus(examId, "failed").pipe(
          Effect.catchAll(() => Effect.void),
        );

        // Best-effort: publish failure event
        yield* Effect.tryPromise({
          try: () =>
            publishEvent(channels.exam(examId), {
              type: "generation_failed",
              examId,
              error:
                error instanceof AiGenerationError
                  ? error.message
                  : "Exam generation failed unexpectedly",
            }),
          catch: () =>
            new AiGenerationError({
              message: "Failed to publish failure event",
            }),
        }).pipe(Effect.catchAll(() => Effect.void));

        yield* Effect.tryPromise({
          try: () =>
            publishEvent(channels.user(userId), {
              type: "generation_failed",
              examId,
              error: "Exam generation failed",
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

const worker = new Worker<ExamGenerationJob>(
  QUEUE_NAMES.EXAM_GENERATION,
  async (job: Job<ExamGenerationJob>) => {
    const { examId, userId } = job.data;

    return Effect.runPromise(
      processExamGeneration(examId, userId, (pct) =>
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
    "Exam generation job completed",
  );
});

worker.on("failed", (job, error) => {
  workerLogger.error(
    { jobId: job?.id, err: error },
    "Exam generation job failed",
  );
});

worker.on("error", (err) => {
  workerLogger.error({ err }, "Exam generation worker error");
});

workerLogger.info("Exam generation worker running");
