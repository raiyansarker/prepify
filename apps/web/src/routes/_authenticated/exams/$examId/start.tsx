import { useEffect, useMemo, useState, useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  Clock01Icon,
  NoteEditIcon,
  SparklesIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Textarea } from "#/components/ui/textarea";
import { useExamWebSocket } from "#/hooks/use-exam-websocket";
import { api } from "#/lib/api";
import { cn } from "#/lib/utils";
import type { QuestionType } from "@repo/shared";

export const Route = createFileRoute("/_authenticated/exams/$examId/start")({
  component: StartExamPage,
});

type ExamQuestion = {
  id: string;
  type: QuestionType;
  topic: string | null;
  content: string;
  options: { id: string; text: string }[] | null;
  orderIndex: number;
};

type ExamData = {
  id: string;
  title: string;
  topic: string;
  questions: ExamQuestion[];
};

type SessionAnswer = {
  id: string;
  questionId: string;
  userAnswer: string | null;
};

type SessionData = {
  id: string;
  examId: string;
  status: "in_progress" | "submitted" | "timed_out";
  startedAt: string;
  endsAt: string;
  submittedAt: string | null;
  answers: SessionAnswer[];
};

function computeRemainingSeconds(endsAt: string): number {
  return Math.max(
    0,
    Math.floor((new Date(endsAt).getTime() - Date.now()) / 1000),
  );
}

function formatRemaining(seconds: number): string {
  const mm = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const ss = (seconds % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function StartExamPage() {
  const { examId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [questionIndex, setQuestionIndex] = useState(0);
  const [mcqAnswers, setMcqAnswers] = useState<Record<string, string>>({});
  const [writtenAnswers, setWrittenAnswers] = useState<Record<string, string>>(
    {},
  );
  const [localRemainingSeconds, setLocalRemainingSeconds] = useState(0);

  const {
    timers,
    status: wsStatus,
    subscribeSession,
    unsubscribeSession,
  } = useExamWebSocket();

  const examQuery = useQuery({
    queryKey: ["exam", examId],
    queryFn: async () => {
      const res = await api.exams({ id: examId }).get();
      if (res.data?.success) {
        return (res.data as { success: true; data: ExamData }).data;
      }
      throw new Error(
        (res.data as { error?: string } | undefined)?.error ||
          "Failed to load exam",
      );
    },
  });

  const latestSessionQuery = useQuery({
    queryKey: ["exam-latest-session", examId],
    retry: false,
    queryFn: async () => {
      const res = await api.exams({ id: examId }).sessions.latest.get();
      if (res.data?.success) {
        return (res.data as { success: true; data: SessionData }).data;
      }
      return null;
    },
  });

  const startSessionMutation = useMutation({
    mutationFn: async () => {
      const res = await api.exams({ id: examId }).sessions.post({});
      if (res.data?.success) {
        return (res.data as { success: true; data: SessionData }).data;
      }
      throw new Error(
        (res.data as { error?: string } | undefined)?.error ||
          "Failed to start exam",
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["exam-latest-session", examId],
      });
    },
  });

  const sessionQuery = useQuery({
    queryKey: ["exam-session", latestSessionQuery.data?.id],
    enabled: !!latestSessionQuery.data?.id,
    queryFn: async () => {
      const sessionId = latestSessionQuery.data?.id;
      if (!sessionId) return null;
      const res = await api.exams.sessions({ sessionId }).get();
      if (res.data?.success) {
        return (res.data as { success: true; data: SessionData }).data;
      }
      throw new Error(
        (res.data as { error?: string } | undefined)?.error ||
          "Failed to load exam session",
      );
    },
  });

  const sessionId = sessionQuery.data?.id;
  const session = sessionQuery.data;

  const submitAnswerMutation = useMutation({
    mutationFn: async (payload: { questionId: string; userAnswer: string }) => {
      if (!sessionId) throw new Error("No active session");
      const res = await api.exams.sessions({ sessionId }).answers.post(payload);
      if (res.data?.success) return res.data;
      throw new Error(
        (res.data as { error?: string } | undefined)?.error ||
          "Failed to save answer",
      );
    },
  });

  const submitExamMutation = useMutation({
    mutationFn: async () => {
      if (!sessionId) throw new Error("No active session");
      await persistDraftAnswers();
      const res = await api.exams.sessions({ sessionId }).submit.post({});
      if (res.data?.success) {
        return res.data as {
          success: true;
          data: {
            sessionId: string;
            status: "in_progress" | "submitted" | "timed_out";
          };
        };
      }
      throw new Error(
        (res.data as { error?: string } | undefined)?.error ||
          "Failed to submit exam",
      );
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["exam-session", sessionId] });
      queryClient.invalidateQueries({
        queryKey: ["exam-latest-session", examId],
      });
      queryClient.invalidateQueries({ queryKey: ["exams"] });
      navigate({
        to: "/exams/$examId/results/pending",
        params: { examId },
        search: { sessionId: result.data.sessionId },
      });
    },
  });

  useEffect(() => {
    if (!sessionId) return;
    subscribeSession(sessionId);
    return () => unsubscribeSession(sessionId);
  }, [sessionId, subscribeSession, unsubscribeSession]);

  const exam = examQuery.data;
  const timerState = sessionId ? timers.get(sessionId) : undefined;

  const orderedQuestions = useMemo(() => {
    if (!exam) return [] as ExamQuestion[];
    return [...exam.questions].sort((a, b) => a.orderIndex - b.orderIndex);
  }, [exam]);

  const persistDraftAnswers = useCallback(async () => {
    if (!sessionId) throw new Error("No active session");

    const existingAnswerMap = new Map(
      (session?.answers ?? []).map((answer) => [
        answer.questionId,
        answer.userAnswer ?? "",
      ]),
    );

    for (const question of orderedQuestions) {
      if (question.type === "mcq") {
        const selectedOption = mcqAnswers[question.id];
        if (!selectedOption) continue;

        const existingValue = existingAnswerMap.get(question.id) ?? "";
        if (existingValue === selectedOption) continue;

        await submitAnswerMutation.mutateAsync({
          questionId: question.id,
          userAnswer: selectedOption,
        });
        continue;
      }

      const draftAnswer = writtenAnswers[question.id]?.trim();
      if (!draftAnswer) continue;

      const existingValue = (existingAnswerMap.get(question.id) ?? "").trim();
      if (existingValue === draftAnswer) continue;

      await submitAnswerMutation.mutateAsync({
        questionId: question.id,
        userAnswer: draftAnswer,
      });
    }
  }, [
    mcqAnswers,
    orderedQuestions,
    session?.answers,
    sessionId,
    submitAnswerMutation,
    writtenAnswers,
  ]);

  const activeQuestion = orderedQuestions[questionIndex] ?? null;

  useEffect(() => {
    if (!session?.answers) return;

    const nextMcq: Record<string, string> = {};
    const nextWritten: Record<string, string> = {};

    for (const answer of session.answers) {
      const question = orderedQuestions.find((q) => q.id === answer.questionId);
      if (!question || !answer.userAnswer) continue;
      if (question.type === "mcq") {
        nextMcq[question.id] = answer.userAnswer;
      } else {
        nextWritten[question.id] = answer.userAnswer;
      }
    }

    setMcqAnswers((prev) => ({ ...nextMcq, ...prev }));
    setWrittenAnswers((prev) => ({ ...nextWritten, ...prev }));
  }, [session, orderedQuestions]);

  useEffect(() => {
    if (!session) {
      setLocalRemainingSeconds(0);
      return;
    }

    if (typeof timerState?.remainingSeconds === "number") {
      setLocalRemainingSeconds(timerState.remainingSeconds);
      return;
    }

    if (session.status === "in_progress") {
      setLocalRemainingSeconds(computeRemainingSeconds(session.endsAt));
    } else {
      setLocalRemainingSeconds(0);
    }
  }, [session, timerState?.remainingSeconds]);

  useEffect(() => {
    if (!session || session.status !== "in_progress") return;
    const interval = setInterval(() => {
      setLocalRemainingSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [session?.status]);

  useEffect(() => {
    if (!session || !sessionId) return;
    if (session.status === "submitted" || session.status === "timed_out") {
      navigate({
        to: "/exams/$examId/results/pending",
        params: { examId },
        search: { sessionId },
      });
    }
  }, [session, sessionId, navigate, examId]);

  const answeredCount = useMemo(() => {
    let count = 0;
    for (const q of orderedQuestions) {
      if (q.type === "mcq" && mcqAnswers[q.id]) count += 1;
      if (q.type === "descriptive" && writtenAnswers[q.id]?.trim()) count += 1;
    }
    return count;
  }, [orderedQuestions, mcqAnswers, writtenAnswers]);

  if (examQuery.isLoading || latestSessionQuery.isLoading) {
    return (
      <div className="space-y-6">
        <title>Start exam - Prepify</title>
        <div className="h-40 animate-pulse rounded-xl border bg-muted/40" />
        <div className="h-72 animate-pulse rounded-xl border bg-muted/40" />
      </div>
    );
  }

  if (examQuery.error || !exam) {
    return (
      <div className="space-y-4">
        <title>Start exam - Prepify</title>
        <h1 className="text-2xl font-semibold">Unable to load exam</h1>
        <p className="text-sm text-muted-foreground">
          {examQuery.error instanceof Error
            ? examQuery.error.message
            : "Exam not found"}
        </p>
        <Button
          onClick={() => navigate({ to: "/exams/$examId", params: { examId } })}
        >
          <HugeiconsIcon
            icon={ArrowLeft01Icon}
            strokeWidth={2}
            className="size-4"
          />
          Back to workspace
        </Button>
      </div>
    );
  }

  if (!session || session.status !== "in_progress") {
    return (
      <div className="space-y-6">
        <title>Start exam - Prepify</title>
        <Card>
          <CardHeader>
            <CardTitle>Ready to start</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Start your attempt on this page. No auto submit will happen — you
              submit manually.
            </p>
            <div className="flex gap-2">
              <Button
                onClick={() => startSessionMutation.mutate()}
                disabled={startSessionMutation.isPending}
              >
                {startSessionMutation.isPending ? "Starting..." : "Start now"}
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  navigate({ to: "/exams/$examId", params: { examId } })
                }
              >
                Back to workspace
              </Button>
            </div>
            {startSessionMutation.error && (
              <p className="text-sm text-destructive">
                {startSessionMutation.error instanceof Error
                  ? startSessionMutation.error.message
                  : "Failed to start session"}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (orderedQuestions.length === 0) {
    return (
      <div className="space-y-4">
        <title>Start exam - Prepify</title>
        <h1 className="text-2xl font-semibold">No questions found</h1>
        <p className="text-sm text-muted-foreground">
          This exam has no generated questions yet. Return to workspace and
          refresh.
        </p>
        <Button
          onClick={() => navigate({ to: "/exams/$examId", params: { examId } })}
        >
          <HugeiconsIcon
            icon={ArrowLeft01Icon}
            strokeWidth={2}
            className="size-4"
          />
          Back to workspace
        </Button>
      </div>
    );
  }

  const onSelectMcq = async (questionId: string, optionId: string) => {
    setMcqAnswers((prev) => ({ ...prev, [questionId]: optionId }));
    try {
      await submitAnswerMutation.mutateAsync({
        questionId,
        userAnswer: optionId,
      });
    } catch {
      // optimistic UI retained
    }
  };

  const onSaveWritten = async (questionId: string, text: string) => {
    const payload = text.trim();
    if (!payload) return;
    try {
      await submitAnswerMutation.mutateAsync({
        questionId,
        userAnswer: payload,
      });
    } catch {
      // local draft retained
    }
  };

  return (
    <>
      <title>{exam.title} - Start exam</title>

      <div className="space-y-6">
        <section className="relative overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-slate-50 via-background to-sky-50/30 p-5 sm:p-6 dark:from-slate-950 dark:via-background dark:to-sky-950/10">
          <div className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-sky-200/35 blur-3xl dark:bg-sky-500/10" />
          <div className="relative space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge className="gap-1 border border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-500/10 dark:text-emerald-100">
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    In progress
                  </Badge>
                  <Badge variant="outline" className="gap-1">
                    <HugeiconsIcon
                      icon={SparklesIcon}
                      strokeWidth={2}
                      className="size-3"
                    />
                    WebSocket: {wsStatus}
                  </Badge>
                </div>
                <h1 className="text-3xl font-semibold tracking-tight">
                  {exam.title}
                </h1>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                  {exam.topic}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    "gap-1",
                    localRemainingSeconds <= 60 &&
                      "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800/60 dark:bg-rose-500/10 dark:text-rose-100",
                  )}
                >
                  <HugeiconsIcon
                    icon={Clock01Icon}
                    strokeWidth={2}
                    className="size-3"
                  />
                  {formatRemaining(localRemainingSeconds)} left
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    navigate({ to: "/exams/$examId", params: { examId } })
                  }
                >
                  <HugeiconsIcon
                    icon={ArrowLeft01Icon}
                    strokeWidth={2}
                    className="size-4"
                  />
                  Back to workspace
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline" className="gap-1">
                <HugeiconsIcon
                  icon={Tick02Icon}
                  strokeWidth={2}
                  className="size-3"
                />
                {orderedQuestions.length} questions
              </Badge>
              <Badge variant="outline">
                {answeredCount}/{orderedQuestions.length} answered
              </Badge>
            </div>
          </div>
        </section>

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle>
              Question {questionIndex + 1} of {orderedQuestions.length}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {activeQuestion && (
              <>
                <div className="rounded-lg border border-border/70 bg-background p-4">
                  <p className="text-sm font-medium text-muted-foreground">
                    {activeQuestion.topic ?? "General"}
                  </p>
                  <p className="mt-2 text-base leading-7">
                    {activeQuestion.content}
                  </p>

                  {activeQuestion.type === "mcq" && activeQuestion.options && (
                    <div className="mt-4 space-y-2">
                      {activeQuestion.options.map((opt) => {
                        const selected =
                          mcqAnswers[activeQuestion.id] === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() =>
                              onSelectMcq(activeQuestion.id, opt.id)
                            }
                            className={cn(
                              "w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                              selected
                                ? "border-emerald-400 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-500/10"
                                : "border-border/70 bg-background hover:bg-muted/30",
                            )}
                          >
                            <span className="font-semibold uppercase">
                              {opt.id}.
                            </span>{" "}
                            {opt.text}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {activeQuestion.type === "descriptive" && (
                    <div className="mt-4 space-y-2">
                      <Textarea
                        value={writtenAnswers[activeQuestion.id] ?? ""}
                        onChange={(e) =>
                          setWrittenAnswers((prev) => ({
                            ...prev,
                            [activeQuestion.id]: e.target.value,
                          }))
                        }
                        placeholder="Write your answer here..."
                        className="min-h-40"
                      />
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">
                          {
                            (writtenAnswers[activeQuestion.id] ?? "").trim()
                              .length
                          }{" "}
                          characters
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            onSaveWritten(
                              activeQuestion.id,
                              writtenAnswers[activeQuestion.id] ?? "",
                            )
                          }
                          disabled={
                            submitAnswerMutation.isPending ||
                            !(writtenAnswers[activeQuestion.id] ?? "").trim()
                          }
                        >
                          <HugeiconsIcon
                            icon={NoteEditIcon}
                            strokeWidth={2}
                            className="size-4"
                          />
                          {submitAnswerMutation.isPending
                            ? "Saving..."
                            : "Save answer"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1">
                    {Array.from({ length: orderedQuestions.length }).map(
                      (_, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setQuestionIndex(i)}
                          className={cn(
                            "size-7 rounded-md border text-xs",
                            i === questionIndex
                              ? "border-emerald-500 bg-emerald-500 text-white"
                              : "border-border/70 bg-background",
                          )}
                        >
                          {i + 1}
                        </button>
                      ),
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setQuestionIndex((i) => Math.max(0, i - 1))
                      }
                      disabled={questionIndex === 0}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setQuestionIndex((i) =>
                          Math.min(orderedQuestions.length - 1, i + 1),
                        )
                      }
                      disabled={questionIndex === orderedQuestions.length - 1}
                    >
                      Next
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => submitExamMutation.mutate()}
                      disabled={
                        submitExamMutation.isPending ||
                        submitAnswerMutation.isPending
                      }
                    >
                      {submitExamMutation.isPending
                        ? "Submitting..."
                        : "Submit exam"}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export default StartExamPage;
