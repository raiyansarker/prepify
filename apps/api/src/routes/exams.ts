import { Elysia, t } from "elysia";
import { Effect } from "effect";
import { eq, and, desc } from "drizzle-orm";
import { db } from "#/db";
import {
  exams,
  examDocuments,
  questions,
  examSessions,
  answers,
  results,
  documents,
} from "#/db/schema";
import { requireAuth } from "#/middleware/auth";
import { examGenerationQueue, examGradingQueue } from "#/lib/queues";
import { publishEvent, channels } from "#/lib/pubsub";
import {
  DatabaseError,
  NotFoundError,
  ExternalServiceError,
  ValidationError,
  ExamError,
  ExamSessionExpiredError,
} from "#/lib/errors";
import { effectHandler } from "#/services/runtime";
import {
  MIN_QUESTION_COUNT,
  MAX_QUESTION_COUNT,
  DEFAULT_QUESTION_COUNT,
  MIN_EXAM_DURATION_MINUTES,
  MAX_EXAM_DURATION_MINUTES,
} from "@repo/shared";

type Auth = { userId: string };

// ============================================
// DB helpers wrapped in Effect
// ============================================

const queryExams = (userId: string) =>
  Effect.tryPromise({
    try: () =>
      db.query.exams.findMany({
        where: eq(exams.userId, userId),
        orderBy: [desc(exams.createdAt)],
      }),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to query exams", cause }),
  });

const findExam = (examId: string, userId: string) =>
  Effect.tryPromise({
    try: () =>
      db.query.exams.findFirst({
        where: and(eq(exams.id, examId), eq(exams.userId, userId)),
      }),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to find exam", cause }),
  });

const findExamWithQuestions = (examId: string, userId: string) =>
  Effect.tryPromise({
    try: () =>
      db.query.exams.findFirst({
        where: and(eq(exams.id, examId), eq(exams.userId, userId)),
        with: {
          questions: {
            orderBy: [desc(questions.orderIndex)],
          },
          examDocuments: {
            with: { document: true },
          },
        },
      }),
    catch: (cause) =>
      new DatabaseError({
        message: "Failed to find exam with questions",
        cause,
      }),
  });

const insertExam = (data: Record<string, unknown>) =>
  Effect.tryPromise({
    try: () =>
      db
        .insert(exams)
        .values(data as any)
        .returning(),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to insert exam", cause }),
  });

const insertExamDocuments = (rows: { examId: string; documentId: string }[]) =>
  Effect.tryPromise({
    try: () => db.insert(examDocuments).values(rows),
    catch: (cause) =>
      new DatabaseError({
        message: "Failed to insert exam documents",
        cause,
      }),
  });

const deleteExamById = (examId: string) =>
  Effect.tryPromise({
    try: () => db.delete(exams).where(eq(exams.id, examId)),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to delete exam", cause }),
  });

const enqueueExamGeneration = (examId: string, userId: string) =>
  Effect.tryPromise({
    try: () =>
      examGenerationQueue.add(
        "generate",
        { examId, userId },
        { jobId: `exam-${examId}` },
      ),
    catch: (cause) =>
      new ExternalServiceError({
        service: "BullMQ",
        message: "Failed to enqueue exam generation",
        cause,
      }),
  });

const findExamQuestions = (examId: string) =>
  Effect.tryPromise({
    try: () =>
      db.query.questions.findMany({
        where: eq(questions.examId, examId),
        orderBy: [desc(questions.orderIndex)],
      }),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to find questions", cause }),
  });

const insertSession = (data: Record<string, unknown>) =>
  Effect.tryPromise({
    try: () =>
      db
        .insert(examSessions)
        .values(data as any)
        .returning(),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to insert session", cause }),
  });

const findSession = (sessionId: string, userId: string) =>
  Effect.tryPromise({
    try: () =>
      db.query.examSessions.findFirst({
        where: and(
          eq(examSessions.id, sessionId),
          eq(examSessions.userId, userId),
        ),
      }),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to find session", cause }),
  });

const findSessionWithDetails = (sessionId: string, userId: string) =>
  Effect.tryPromise({
    try: () =>
      db.query.examSessions.findFirst({
        where: and(
          eq(examSessions.id, sessionId),
          eq(examSessions.userId, userId),
        ),
        with: {
          answers: true,
          exam: true,
        },
      }),
    catch: (cause) =>
      new DatabaseError({
        message: "Failed to find session with details",
        cause,
      }),
  });

const upsertAnswer = (data: {
  sessionId: string;
  questionId: string;
  userAnswer: string | null;
  attachments: any[] | null;
}) =>
  Effect.tryPromise({
    try: async () => {
      // Check if answer already exists
      const existing = await db.query.answers.findFirst({
        where: and(
          eq(answers.sessionId, data.sessionId),
          eq(answers.questionId, data.questionId),
        ),
      });

      if (existing) {
        const [updated] = await db
          .update(answers)
          .set({
            userAnswer: data.userAnswer,
            attachments: data.attachments,
            answeredAt: new Date(),
          })
          .where(eq(answers.id, existing.id))
          .returning();
        return updated!;
      }

      const [created] = await db
        .insert(answers)
        .values({
          sessionId: data.sessionId,
          questionId: data.questionId,
          userAnswer: data.userAnswer,
          attachments: data.attachments,
          answeredAt: new Date(),
        } as any)
        .returning();
      return created!;
    },
    catch: (cause) =>
      new DatabaseError({ message: "Failed to upsert answer", cause }),
  });

const updateSessionStatus = (
  sessionId: string,
  status: "submitted" | "timed_out",
) =>
  Effect.tryPromise({
    try: () =>
      db
        .update(examSessions)
        .set({
          status,
          submittedAt: new Date(),
        })
        .where(eq(examSessions.id, sessionId))
        .returning(),
    catch: (cause) =>
      new DatabaseError({
        message: "Failed to update session status",
        cause,
      }),
  });

const enqueueGrading = (sessionId: string, userId: string) =>
  Effect.tryPromise({
    try: () =>
      examGradingQueue.add(
        "grade",
        { sessionId, userId },
        { jobId: `grade-${sessionId}` },
      ),
    catch: (cause) =>
      new ExternalServiceError({
        service: "BullMQ",
        message: "Failed to enqueue exam grading",
        cause,
      }),
  });

const findResult = (sessionId: string) =>
  Effect.tryPromise({
    try: () =>
      db.query.results.findFirst({
        where: eq(results.sessionId, sessionId),
      }),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to find result", cause }),
  });

const findAnswersForSession = (sessionId: string) =>
  Effect.tryPromise({
    try: () =>
      db.query.answers.findMany({
        where: eq(answers.sessionId, sessionId),
        with: {
          question: true,
        },
      }),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to find answers", cause }),
  });

const verifyDocumentOwnership = (documentIds: string[], userId: string) =>
  Effect.tryPromise({
    try: () =>
      db.query.documents.findMany({
        where: and(eq(documents.userId, userId)),
      }),
    catch: (cause) =>
      new DatabaseError({
        message: "Failed to verify document ownership",
        cause,
      }),
  }).pipe(
    Effect.flatMap((userDocs) => {
      const userDocIds = new Set(userDocs.map((d) => d.id));
      const invalid = documentIds.filter((id) => !userDocIds.has(id));
      if (invalid.length > 0) {
        return Effect.fail(
          new ValidationError({
            message: `Documents not found or not owned: ${invalid.join(", ")}`,
            field: "documentIds",
          }),
        );
      }
      return Effect.succeed(void 0);
    }),
  );

// ============================================
// Exam CRUD + Session Routes
// ============================================

export const examRoutes = new Elysia({ prefix: "/exams" })
  .use(requireAuth)

  // ============================================
  // POST /exams — Create exam + enqueue generation
  // ============================================
  .post(
    "/",
    async (ctx) => {
      const auth = (ctx as unknown as { auth: Auth }).auth;

      return effectHandler(
        ctx,
        Effect.gen(function* () {
          const {
            title,
            topic,
            type,
            questionCount,
            durationMinutes,
            durationMode,
            contextSource,
            documentIds,
          } = ctx.body;

          // Validate questionCount range
          const count = questionCount ?? DEFAULT_QUESTION_COUNT;
          if (count < MIN_QUESTION_COUNT || count > MAX_QUESTION_COUNT) {
            return yield* new ValidationError({
              message: `questionCount must be between ${MIN_QUESTION_COUNT} and ${MAX_QUESTION_COUNT}`,
              field: "questionCount",
            });
          }

          // Validate duration when user_set
          const mode = durationMode ?? "user_set";
          if (mode === "user_set") {
            if (!durationMinutes) {
              return yield* new ValidationError({
                message:
                  "durationMinutes is required when durationMode is user_set",
                field: "durationMinutes",
              });
            }
            if (
              durationMinutes < MIN_EXAM_DURATION_MINUTES ||
              durationMinutes > MAX_EXAM_DURATION_MINUTES
            ) {
              return yield* new ValidationError({
                message: `durationMinutes must be between ${MIN_EXAM_DURATION_MINUTES} and ${MAX_EXAM_DURATION_MINUTES}`,
                field: "durationMinutes",
              });
            }
          }

          // Validate contextSource + documentIds
          const source = contextSource ?? "both";
          if (
            (source === "uploaded" || source === "both") &&
            (!documentIds || documentIds.length === 0)
          ) {
            return yield* new ValidationError({
              message:
                "documentIds are required when contextSource is 'uploaded' or 'both'",
              field: "documentIds",
            });
          }

          // Verify document ownership if documentIds provided
          if (documentIds && documentIds.length > 0) {
            yield* verifyDocumentOwnership(documentIds, auth.userId);
          }

          // Insert exam
          const [exam] = yield* insertExam({
            userId: auth.userId,
            title,
            topic,
            type,
            questionCount: count,
            durationMinutes: mode === "user_set" ? durationMinutes : null,
            durationMode: mode,
            status: "generating",
            contextSource: source,
          });

          // Link documents to exam
          if (documentIds && documentIds.length > 0) {
            yield* insertExamDocuments(
              documentIds.map((docId) => ({
                examId: exam!.id,
                documentId: docId,
              })),
            );
          }

          // Enqueue generation job
          yield* enqueueExamGeneration(exam!.id, auth.userId);

          yield* Effect.logInfo("Exam created and generation enqueued").pipe(
            Effect.annotateLogs("examId", exam!.id),
          );

          return { success: true as const, data: exam! };
        }),
      );
    },
    {
      body: t.Object({
        title: t.String({ minLength: 1, maxLength: 255 }),
        topic: t.String({ minLength: 1, maxLength: 500 }),
        type: t.Union([
          t.Literal("mcq"),
          t.Literal("written"),
          t.Literal("mixed"),
        ]),
        questionCount: t.Optional(t.Number()),
        durationMinutes: t.Optional(t.Number()),
        durationMode: t.Optional(
          t.Union([t.Literal("user_set"), t.Literal("ai_decided")]),
        ),
        contextSource: t.Optional(
          t.Union([
            t.Literal("uploaded"),
            t.Literal("global"),
            t.Literal("both"),
          ]),
        ),
        documentIds: t.Optional(t.Array(t.String())),
      }),
    },
  )

  // ============================================
  // GET /exams — List user's exams
  // ============================================
  .get("/", async (ctx) => {
    const auth = (ctx as unknown as { auth: Auth }).auth;

    return effectHandler(
      ctx,
      Effect.gen(function* () {
        const userExams = yield* queryExams(auth.userId);
        yield* Effect.logDebug(`Listed ${userExams.length} exams`);
        return { success: true as const, data: userExams };
      }),
    );
  })

  // ============================================
  // GET /exams/:id — Get exam with questions
  // ============================================
  .get(
    "/:id",
    async (ctx) => {
      const auth = (ctx as unknown as { auth: Auth }).auth;

      return effectHandler(
        ctx,
        Effect.gen(function* () {
          const exam = yield* findExamWithQuestions(ctx.params.id, auth.userId);
          if (!exam) {
            return yield* new NotFoundError({
              entity: "Exam",
              id: ctx.params.id,
            });
          }
          return { success: true as const, data: exam };
        }),
      );
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // ============================================
  // DELETE /exams/:id — Delete exam
  // ============================================
  .delete(
    "/:id",
    async (ctx) => {
      const auth = (ctx as unknown as { auth: Auth }).auth;

      return effectHandler(
        ctx,
        Effect.gen(function* () {
          const exam = yield* findExam(ctx.params.id, auth.userId);
          if (!exam) {
            return yield* new NotFoundError({
              entity: "Exam",
              id: ctx.params.id,
            });
          }

          yield* deleteExamById(ctx.params.id);

          yield* Effect.logInfo("Exam deleted").pipe(
            Effect.annotateLogs("examId", ctx.params.id),
          );

          return { success: true as const, data: { id: ctx.params.id } };
        }),
      );
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // ============================================
  // POST /exams/:id/sessions — Start exam session
  // ============================================
  .post(
    "/:id/sessions",
    async (ctx) => {
      const auth = (ctx as unknown as { auth: Auth }).auth;

      return effectHandler(
        ctx,
        Effect.gen(function* () {
          const exam = yield* findExam(ctx.params.id, auth.userId);
          if (!exam) {
            return yield* new NotFoundError({
              entity: "Exam",
              id: ctx.params.id,
            });
          }

          // Exam must be active to start a session
          if (exam.status !== "active") {
            return yield* new ExamError({
              examId: exam.id,
              message: `Exam is not active (status: ${exam.status}). Cannot start a session.`,
            });
          }

          // Ensure duration is set
          if (!exam.durationMinutes) {
            return yield* new ExamError({
              examId: exam.id,
              message: "Exam duration is not set. Cannot start a session.",
            });
          }

          const now = new Date();
          const endsAt = new Date(
            now.getTime() + exam.durationMinutes * 60 * 1000,
          );

          const [session] = yield* insertSession({
            examId: exam.id,
            userId: auth.userId,
            startedAt: now,
            endsAt,
            status: "in_progress",
          });

          // Publish exam_started WS event
          const startedMsg = {
            type: "exam_started" as const,
            sessionId: session!.id,
            endsAt: endsAt.toISOString(),
          };

          yield* Effect.promise(() =>
            publishEvent(channels.session(session!.id), startedMsg),
          );
          yield* Effect.promise(() =>
            publishEvent(channels.user(auth.userId), startedMsg),
          );

          yield* Effect.logInfo("Exam session started").pipe(
            Effect.annotateLogs("sessionId", session!.id),
            Effect.annotateLogs("examId", exam.id),
          );

          return { success: true as const, data: session! };
        }),
      );
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // ============================================
  // GET /exams/sessions/:sessionId — Get session with answers
  // ============================================
  .get(
    "/sessions/:sessionId",
    async (ctx) => {
      const auth = (ctx as unknown as { auth: Auth }).auth;

      return effectHandler(
        ctx,
        Effect.gen(function* () {
          const session = yield* findSessionWithDetails(
            ctx.params.sessionId,
            auth.userId,
          );
          if (!session) {
            return yield* new NotFoundError({
              entity: "ExamSession",
              id: ctx.params.sessionId,
            });
          }
          return { success: true as const, data: session };
        }),
      );
    },
    {
      params: t.Object({
        sessionId: t.String(),
      }),
    },
  )

  // ============================================
  // POST /exams/sessions/:sessionId/answers — Submit answer
  // ============================================
  .post(
    "/sessions/:sessionId/answers",
    async (ctx) => {
      const auth = (ctx as unknown as { auth: Auth }).auth;

      return effectHandler(
        ctx,
        Effect.gen(function* () {
          const session = yield* findSession(ctx.params.sessionId, auth.userId);
          if (!session) {
            return yield* new NotFoundError({
              entity: "ExamSession",
              id: ctx.params.sessionId,
            });
          }

          // Check session is still in progress
          if (session.status !== "in_progress") {
            return yield* new ExamError({
              examId: session.examId,
              message: "Session is no longer in progress",
            });
          }

          // Check if session has expired
          if (new Date() > session.endsAt) {
            return yield* new ExamSessionExpiredError({
              sessionId: session.id,
            });
          }

          const answer = yield* upsertAnswer({
            sessionId: session.id,
            questionId: ctx.body.questionId,
            userAnswer: ctx.body.userAnswer ?? null,
            attachments: ctx.body.attachments ?? null,
          });

          return { success: true as const, data: answer };
        }),
      );
    },
    {
      params: t.Object({
        sessionId: t.String(),
      }),
      body: t.Object({
        questionId: t.String(),
        userAnswer: t.Optional(t.String()),
        attachments: t.Optional(
          t.Array(
            t.Object({
              s3Key: t.String(),
              s3Url: t.String(),
              mimeType: t.String(),
            }),
          ),
        ),
      }),
    },
  )

  // ============================================
  // POST /exams/sessions/:sessionId/submit — Submit exam
  // ============================================
  .post(
    "/sessions/:sessionId/submit",
    async (ctx) => {
      const auth = (ctx as unknown as { auth: Auth }).auth;

      return effectHandler(
        ctx,
        Effect.gen(function* () {
          const session = yield* findSession(ctx.params.sessionId, auth.userId);
          if (!session) {
            return yield* new NotFoundError({
              entity: "ExamSession",
              id: ctx.params.sessionId,
            });
          }

          // Already submitted
          if (session.status !== "in_progress") {
            return yield* new ExamError({
              examId: session.examId,
              message: `Session already ${session.status}`,
            });
          }

          // Determine if timed out vs user submission
          const isTimedOut = new Date() > session.endsAt;
          const status = isTimedOut ? "timed_out" : "submitted";

          yield* updateSessionStatus(session.id, status);

          // Enqueue grading
          yield* enqueueGrading(session.id, auth.userId);

          // Publish submission WS event
          const submittedMsg = {
            type: "exam_submitted" as const,
            sessionId: session.id,
            reason: (isTimedOut ? "timeout" : "user") as "user" | "timeout",
          };

          yield* Effect.promise(() =>
            publishEvent(channels.session(session.id), submittedMsg),
          );
          yield* Effect.promise(() =>
            publishEvent(channels.user(auth.userId), submittedMsg),
          );

          yield* Effect.logInfo("Exam session submitted").pipe(
            Effect.annotateLogs("sessionId", session.id),
            Effect.annotateLogs("reason", isTimedOut ? "timeout" : "user"),
          );

          return {
            success: true as const,
            data: { sessionId: session.id, status },
          };
        }),
      );
    },
    {
      params: t.Object({
        sessionId: t.String(),
      }),
    },
  )

  // ============================================
  // GET /exams/sessions/:sessionId/results — Get results
  // ============================================
  .get(
    "/sessions/:sessionId/results",
    async (ctx) => {
      const auth = (ctx as unknown as { auth: Auth }).auth;

      return effectHandler(
        ctx,
        Effect.gen(function* () {
          const session = yield* findSession(ctx.params.sessionId, auth.userId);
          if (!session) {
            return yield* new NotFoundError({
              entity: "ExamSession",
              id: ctx.params.sessionId,
            });
          }

          const result = yield* findResult(session.id);
          if (!result) {
            return yield* new NotFoundError({
              entity: "ExamResult",
              id: ctx.params.sessionId,
            });
          }

          // Also fetch detailed answer data
          const sessionAnswers = yield* findAnswersForSession(session.id);

          return {
            success: true as const,
            data: {
              result,
              answers: sessionAnswers,
            },
          };
        }),
      );
    },
    {
      params: t.Object({
        sessionId: t.String(),
      }),
    },
  );
