import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  ChartBreakoutCircleIcon,
  Clock01Icon,
  NoteEditIcon,
  PlayIcon,
  RefreshIcon,
  SparklesIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card";
import { Textarea } from "#/components/ui/textarea";
import { Progress } from "#/components/ui/progress";
import { useExamWebSocket } from "#/hooks/use-exam-websocket";
import { api } from "#/lib/api";
import { cn } from "#/lib/utils";
import type {
  ExamContextSource,
  ExamDurationMode,
  ExamStatus,
  ExamType,
  QuestionType,
} from "@repo/shared";

export const Route = createFileRoute("/_authenticated/exams/$examId/")({
  component: ExamWorkspacePage,
});

type GenerationState = {
  current: number;
  total: number;
  status: "started" | "in_progress" | "complete" | "failed";
  error?: string;
};

type ExamQuestion = {
  id: string;
  type: QuestionType;
  topic: string | null;
  content: string;
  options: { id: string; text: string }[] | null;
  orderIndex: number;
};

type ExamWorkspace = {
  id: string;
  title: string;
  topic: string;
  type: ExamType;
  questionCount: number;
  durationMinutes: number | null;
  durationMode: ExamDurationMode;
  status: ExamStatus;
  contextSource: ExamContextSource;
  createdAt: string;
  updatedAt: string;
  questions: ExamQuestion[];
  examDocuments: {
    documentId: string;
    document?: {
      id: string;
      name: string;
    } | null;
  }[];
};

type ExamSession = {
  id: string;
  examId: string;
  status: "in_progress" | "submitted" | "timed_out";
  startedAt: string;
  endsAt: string;
};

function hasTimerSignal(timer?: {
  remainingSeconds?: number;
  submitted?: boolean;
}): boolean {
  if (!timer) return false;
  if (typeof timer.remainingSeconds === "number") return true;
  if (timer.submitted) return true;
  return false;
}

type SessionAnswer = {
  id: string;
  questionId: string;
  userAnswer: string | null;
};

type SessionDetails = {
  id: string;
  examId: string;
  status: "in_progress" | "submitted" | "timed_out";
  startedAt: string;
  endsAt: string;
  submittedAt: string | null;
  answers: SessionAnswer[];
};

const statusMeta: Record<
  ExamStatus,
  {
    label: string;
    className: string;
    dotClassName: string;
  }
> = {
  draft: {
    label: "Draft",
    className:
      "border-slate-200 bg-slate-100 text-slate-800 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-200",
    dotClassName: "bg-slate-500",
  },
  generating: {
    label: "Generating",
    className:
      "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/50 dark:bg-amber-500/10 dark:text-amber-100",
    dotClassName: "bg-amber-500",
  },
  active: {
    label: "Ready",
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-500/10 dark:text-emerald-100",
    dotClassName: "bg-emerald-500",
  },
  completed: {
    label: "Completed",
    className:
      "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800/50 dark:bg-sky-500/10 dark:text-sky-100",
    dotClassName: "bg-sky-500",
  },
  failed: {
    label: "Failed",
    className:
      "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/50 dark:bg-rose-500/10 dark:text-rose-100",
    dotClassName: "bg-rose-500",
  },
};

const examTypeCopy: Record<ExamType, string> = {
  mcq: "Multiple choice",
  written: "Descriptive",
  mixed: "Mixed",
};

const contextCopy: Record<ExamContextSource, string> = {
  uploaded: "Uploaded docs",
  global: "Global knowledge",
  both: "Docs + global",
};

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getDurationLabel(
  exam: Pick<ExamWorkspace, "durationMode" | "durationMinutes">,
): string {
  if (exam.durationMode === "ai_decided") return "AI decides";
  if (exam.durationMinutes) return `${exam.durationMinutes} min`;
  return "Unset";
}

function getGenerationProgress(generation?: GenerationState): number {
  if (!generation) return 8;
  if (generation.status === "complete") return 100;
  if (generation.total > 0) {
    return Math.min(
      100,
      Math.round((generation.current / generation.total) * 100),
    );
  }
  return generation.status === "started" ? 8 : 0;
}

function getExamTimeRemainingSeconds(
  session: Pick<ExamSession, "endsAt" | "status"> | null,
): number {
  if (!session || session.status !== "in_progress") return 0;
  return Math.max(
    0,
    Math.floor((new Date(session.endsAt).getTime() - Date.now()) / 1000),
  );
}

function formatRemaining(seconds: number): string {
  const mm = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const ss = (seconds % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function ExamWorkspacePage() {
  const { examId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [localRemainingSeconds, setLocalRemainingSeconds] = useState<number>(0);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [mcqAnswers, setMcqAnswers] = useState<Record<string, string>>({});
  const [writtenAnswers, setWrittenAnswers] = useState<Record<string, string>>(
    {},
  );

  const {
    generation,
    timers,
    lastMessage,
    status: wsStatus,
    subscribeExam,
    unsubscribeExam,
    subscribeSession,
    unsubscribeSession,
  } = useExamWebSocket();

  const {
    data: exam,
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: ["exam", examId],
    queryFn: async () => {
      const res = await api.exams({ id: examId }).get();
      if (res.data?.success) {
        return (res.data as { success: true; data: ExamWorkspace }).data;
      }

      throw new Error(
        (res.data as { error?: string } | undefined)?.error ||
          "Failed to load exam",
      );
    },
    refetchInterval: (query) => {
      const data = query.state.data as ExamWorkspace | undefined;
      if (!data) return false;
      return data.status === "generating" ? 3000 : false;
    },
  });

  const {
    data: session,
    isFetching: sessionFetching,
    error: sessionError,
  } = useQuery({
    queryKey: ["exam-session", activeSessionId],
    queryFn: async () => {
      if (!activeSessionId) return null;
      const res = await api.exams
        .sessions({ sessionId: activeSessionId })
        .get();
      if (res.data?.success) {
        return (res.data as { success: true; data: SessionDetails }).data;
      }
      throw new Error(
        (res.data as { error?: string } | undefined)?.error ||
          "Failed to load exam session",
      );
    },
    enabled: !!activeSessionId,
  });

  useEffect(() => {
    subscribeExam(examId);
    return () => {
      unsubscribeExam(examId);
    };
  }, [examId, subscribeExam, unsubscribeExam]);

  useEffect(() => {
    if (!activeSessionId) return;
    subscribeSession(activeSessionId);
    return () => {
      unsubscribeSession(activeSessionId);
    };
  }, [activeSessionId, subscribeSession, unsubscribeSession]);

  useEffect(() => {
    if (!lastMessage) return;
    if (
      (lastMessage.type === "generation_complete" ||
        lastMessage.type === "generation_failed" ||
        lastMessage.type === "generation_progress") &&
      lastMessage.examId === examId
    ) {
      queryClient.invalidateQueries({ queryKey: ["exam", examId] });
      queryClient.invalidateQueries({ queryKey: ["exams"] });
    }
  }, [lastMessage, examId, queryClient]);

  const startSessionMutation = useMutation({
    mutationFn: async () => {
      const res = await api.exams({ id: examId }).sessions.post({});
      if (res.data?.success) {
        return (res.data as { success: true; data: ExamSession }).data;
      }
      throw new Error(
        (res.data as { error?: string } | undefined)?.error ||
          "Failed to start exam",
      );
    },
    onSuccess: (started) => {
      setActiveSessionId(started.id);
      setLocalRemainingSeconds(getExamTimeRemainingSeconds(started));
      queryClient.invalidateQueries({ queryKey: ["exam", examId] });
      queryClient.invalidateQueries({ queryKey: ["exams"] });
    },
  });

  const submitAnswerMutation = useMutation({
    mutationFn: async (payload: { questionId: string; userAnswer: string }) => {
      if (!activeSessionId) throw new Error("No active session");
      const res = await api.exams
        .sessions({ sessionId: activeSessionId })
        .answers.post(payload);
      if (res.data?.success) {
        return res.data;
      }
      throw new Error(
        (res.data as { error?: string } | undefined)?.error ||
          "Failed to save answer",
      );
    },
  });

  const submitExamMutation = useMutation({
    mutationFn: async () => {
      if (!activeSessionId) throw new Error("No active session");
      const res = await api.exams
        .sessions({ sessionId: activeSessionId })
        .submit.post({});
      if (res.data?.success) {
        return res.data;
      }
      throw new Error(
        (res.data as { error?: string } | undefined)?.error ||
          "Failed to submit exam",
      );
    },
    onSuccess: () => {
      if (!activeSessionId) return;
      queryClient.invalidateQueries({
        queryKey: ["exam-session", activeSessionId],
      });
      queryClient.invalidateQueries({ queryKey: ["exams"] });
      navigate({
        to: "/exams/$examId/results",
        params: { examId },
        search: { sessionId: activeSessionId },
      });
    },
  });

  const generationState = generation.get(examId);
  const timerState = activeSessionId ? timers.get(activeSessionId) : undefined;
  const timerConnected = hasTimerSignal(timerState);

  const statusBadge = exam ? statusMeta[exam.status] : null;

  const summary = useMemo(() => {
    if (!exam) return null;
    return {
      documents: exam.examDocuments.length,
      generatedQuestions: exam.questions.length,
      createdAt: formatDate(exam.createdAt),
      updatedAt: formatDate(exam.updatedAt),
    };
  }, [exam]);

  const orderedQuestions = useMemo(() => {
    if (!exam) return [];
    return [...exam.questions].sort((a, b) => a.orderIndex - b.orderIndex);
  }, [exam]);

  const activeQuestion = orderedQuestions[questionIndex] ?? null;

  useEffect(() => {
    if (!session) return;
    const nextMcq: Record<string, string> = {};
    const nextWritten: Record<string, string> = {};
    for (const ans of session.answers) {
      const q = orderedQuestions.find((item) => item.id === ans.questionId);
      if (!q || !ans.userAnswer) continue;
      if (q.type === "mcq") {
        nextMcq[q.id] = ans.userAnswer;
      } else {
        nextWritten[q.id] = ans.userAnswer;
      }
    }
    setMcqAnswers((prev) => ({ ...nextMcq, ...prev }));
    setWrittenAnswers((prev) => ({ ...nextWritten, ...prev }));
  }, [session, orderedQuestions]);

  useEffect(() => {
    if (!activeSessionId) {
      setLocalRemainingSeconds(0);
      return;
    }
    if (typeof timerState?.remainingSeconds === "number") {
      setLocalRemainingSeconds(timerState.remainingSeconds);
      return;
    }
    setLocalRemainingSeconds(getExamTimeRemainingSeconds(session ?? null));
  }, [activeSessionId, timerState?.remainingSeconds, session]);

  useEffect(() => {
    if (!activeSessionId) return;
    const interval = setInterval(() => {
      setLocalRemainingSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [activeSessionId]);

  useEffect(() => {
    if (!activeSessionId) return;
    if (timerState?.submitted && !submitExamMutation.isPending) {
      navigate({
        to: "/exams/$examId/results",
        params: { examId },
        search: { sessionId: activeSessionId },
      });
    }
  }, [
    timerState?.submitted,
    activeSessionId,
    examId,
    navigate,
    submitExamMutation.isPending,
  ]);

  useEffect(() => {
    setQuestionIndex(0);
  }, [activeSessionId]);

  const answeredCount = useMemo(() => {
    let count = 0;
    for (const q of orderedQuestions) {
      if (q.type === "mcq" && mcqAnswers[q.id]) count += 1;
      if (q.type === "descriptive" && writtenAnswers[q.id]?.trim()) count += 1;
    }
    return count;
  }, [orderedQuestions, mcqAnswers, writtenAnswers]);

  const onSelectMcq = useCallback(
    async (questionId: string, optionId: string) => {
      setMcqAnswers((prev) => ({ ...prev, [questionId]: optionId }));
      try {
        await submitAnswerMutation.mutateAsync({
          questionId,
          userAnswer: optionId,
        });
      } catch {
        // keep optimistic choice
      }
    },
    [submitAnswerMutation],
  );

  const onSaveWritten = useCallback(
    async (questionId: string, text: string) => {
      const payload = text.trim();
      if (!payload) return;
      try {
        await submitAnswerMutation.mutateAsync({
          questionId,
          userAnswer: payload,
        });
      } catch {
        // keep local draft
      }
    },
    [submitAnswerMutation],
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <title>Exam workspace - Prepify</title>
        <div className="h-40 animate-pulse rounded-xl border bg-muted/40" />
        <div className="h-72 animate-pulse rounded-xl border bg-muted/40" />
      </div>
    );
  }

  if (error || !exam) {
    return (
      <div className="space-y-4">
        <title>Exam workspace - Prepify</title>
        <h1 className="text-2xl font-semibold">
          Unable to load exam workspace
        </h1>
        <p className="text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "Exam not found"}
        </p>
        <Button onClick={() => navigate({ to: "/exams" })}>
          <HugeiconsIcon
            icon={ArrowLeft01Icon}
            strokeWidth={2}
            className="size-4"
          />
          Back to exams
        </Button>
      </div>
    );
  }

  const canStart = exam.status === "active" && !activeSessionId;
  const isSessionBootstrapping =
    !!activeSessionId && !session && sessionFetching;
  const isSessionSubmitted =
    !!timerState?.submitted ||
    session?.status === "submitted" ||
    session?.status === "timed_out";
  const isInSession =
    !!activeSessionId &&
    (isSessionBootstrapping || session?.status === "in_progress") &&
    !isSessionSubmitted;

  useEffect(() => {
    if (!activeSessionId || !session) return;
    if (session.status !== "in_progress") return;
    if (!timerConnected) return;
    if (timerState?.submitted) return;
    if (localRemainingSeconds > 0) return;
    if (submitExamMutation.isPending) return;
    submitExamMutation.mutate();
  }, [
    activeSessionId,
    session,
    timerConnected,
    timerState?.submitted,
    localRemainingSeconds,
    submitExamMutation,
  ]);

  return (
    <>
      <title>{exam.title} - Exam workspace</title>

      <div className="space-y-6">
        <section className="relative overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-slate-50 via-background to-sky-50/30 p-5 sm:p-6 dark:from-slate-950 dark:via-background dark:to-sky-950/10">
          <div className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-sky-200/35 blur-3xl dark:bg-sky-500/10" />
          <div className="relative space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {statusBadge && (
                    <Badge
                      className={cn("gap-1 border", statusBadge.className)}
                    >
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          statusBadge.dotClassName,
                        )}
                      />
                      {statusBadge.label}
                    </Badge>
                  )}
                  <Badge variant="outline" className="gap-1">
                    <HugeiconsIcon
                      icon={SparklesIcon}
                      strokeWidth={2}
                      className="size-3"
                    />
                    {contextCopy[exam.contextSource]}
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate({ to: "/exams" })}
                >
                  <HugeiconsIcon
                    icon={ArrowLeft01Icon}
                    strokeWidth={2}
                    className="size-4"
                  />
                  Back to exams
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    queryClient.invalidateQueries({
                      queryKey: ["exam", examId],
                    })
                  }
                >
                  <HugeiconsIcon
                    icon={RefreshIcon}
                    strokeWidth={2}
                    className={cn("size-4", isFetching && "animate-spin")}
                  />
                  Refresh
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
                {examTypeCopy[exam.type]}
              </Badge>
              <Badge variant="outline">{exam.questionCount} questions</Badge>
              <Badge variant="outline">{getDurationLabel(exam)}</Badge>
              <Badge variant="outline">WebSocket: {wsStatus}</Badge>
              {activeSessionId && (
                <Badge variant="outline" className="gap-1">
                  <HugeiconsIcon
                    icon={Clock01Icon}
                    strokeWidth={2}
                    className="size-3"
                  />
                  {formatRemaining(localRemainingSeconds)} left
                </Badge>
              )}
            </div>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <Card className="border-border/70">
            <CardHeader>
              <CardTitle>Workspace status</CardTitle>
              <CardDescription>
                This page tracks generation and lets you start and submit your
                exam.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {exam.status === "generating" && (
                <GeneratingStateCard generationState={generationState} />
              )}

              {exam.status === "active" && !activeSessionId && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-800/40 dark:bg-emerald-500/10">
                  <h2 className="text-lg font-semibold text-emerald-900 dark:text-emerald-100">
                    Exam is ready
                  </h2>
                  <p className="mt-1 text-sm text-emerald-800/90 dark:text-emerald-100/80">
                    Start your timed attempt now. Answers are saved as you go.
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Button
                      onClick={() => startSessionMutation.mutate()}
                      disabled={!canStart || startSessionMutation.isPending}
                    >
                      <HugeiconsIcon
                        icon={PlayIcon}
                        strokeWidth={2}
                        className="size-4"
                      />
                      {startSessionMutation.isPending
                        ? "Starting..."
                        : "Start exam"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => navigate({ to: "/exams" })}
                    >
                      Return to list
                    </Button>
                  </div>
                </div>
              )}

              {isInSession && !activeQuestion && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-800/40 dark:bg-emerald-500/10">
                  <h2 className="text-lg font-semibold text-emerald-900 dark:text-emerald-100">
                    Loading your attempt
                  </h2>
                  <p className="mt-1 text-sm text-emerald-800/90 dark:text-emerald-100/80">
                    Your session started. Fetching generated questions now...
                  </p>
                </div>
              )}

              {isInSession && activeQuestion && (
                <ExamAttemptCard
                  question={activeQuestion}
                  index={questionIndex}
                  total={orderedQuestions.length}
                  mcqValue={mcqAnswers[activeQuestion.id]}
                  writtenValue={writtenAnswers[activeQuestion.id] ?? ""}
                  onChangeWritten={(text) =>
                    setWrittenAnswers((prev) => ({
                      ...prev,
                      [activeQuestion.id]: text,
                    }))
                  }
                  onSaveWritten={() =>
                    onSaveWritten(
                      activeQuestion.id,
                      writtenAnswers[activeQuestion.id] ?? "",
                    )
                  }
                  onSelectMcq={(optionId) =>
                    onSelectMcq(activeQuestion.id, optionId)
                  }
                  onPrev={() => setQuestionIndex((v) => Math.max(0, v - 1))}
                  onNext={() =>
                    setQuestionIndex((v) =>
                      Math.min(orderedQuestions.length - 1, v + 1),
                    )
                  }
                  onJump={(idx) => setQuestionIndex(idx)}
                  submitPending={submitExamMutation.isPending}
                  onSubmit={() => submitExamMutation.mutate()}
                  answeredCount={answeredCount}
                  savePending={submitAnswerMutation.isPending}
                  sessionFetching={sessionFetching}
                />
              )}

              {activeSessionId && !isInSession && (
                <div className="rounded-lg border border-sky-200 bg-sky-50/70 p-4 dark:border-sky-800/40 dark:bg-sky-500/10">
                  <h2 className="text-lg font-semibold text-sky-900 dark:text-sky-100">
                    Exam attempt finished
                  </h2>
                  <p className="mt-1 text-sm text-sky-900/90 dark:text-sky-100/80">
                    {timerState?.submitReason === "timeout"
                      ? "Your session timed out and was submitted for grading."
                      : "Your session has been submitted for grading."}
                  </p>
                  <div className="mt-4 flex gap-2">
                    <Button
                      onClick={() =>
                        navigate({
                          to: "/exams/$examId/results",
                          params: { examId },
                          search: { sessionId: activeSessionId },
                        })
                      }
                    >
                      <HugeiconsIcon
                        icon={ChartBreakoutCircleIcon}
                        strokeWidth={2}
                        className="size-4"
                      />
                      View results
                    </Button>
                  </div>
                </div>
              )}

              {exam.status === "completed" && !activeSessionId && (
                <div className="rounded-lg border border-sky-200 bg-sky-50/70 p-4 dark:border-sky-800/40 dark:bg-sky-500/10">
                  <h2 className="text-lg font-semibold text-sky-900 dark:text-sky-100">
                    Exam completed
                  </h2>
                  <p className="mt-1 text-sm text-sky-900/90 dark:text-sky-100/80">
                    This exam has at least one submitted attempt. Open the
                    results view for performance insights.
                  </p>
                </div>
              )}

              {exam.status === "failed" && (
                <div className="rounded-lg border border-rose-200 bg-rose-50/70 p-4 dark:border-rose-800/40 dark:bg-rose-500/10">
                  <h2 className="text-lg font-semibold text-rose-900 dark:text-rose-100">
                    Generation failed
                  </h2>
                  <p className="mt-1 text-sm text-rose-800/90 dark:text-rose-100/80">
                    This exam failed during AI generation. You can return to the
                    exams list and create another one with adjusted context.
                  </p>
                  <div className="mt-4">
                    <Button
                      variant="outline"
                      onClick={() => navigate({ to: "/exams/new" })}
                    >
                      Create a new exam
                    </Button>
                  </div>
                </div>
              )}

              {exam.status === "draft" && (
                <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800/40 dark:bg-slate-900/60">
                  <h2 className="text-lg font-semibold">Draft exam</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    This exam is still in draft state. Refresh shortly or return
                    to the list to track updates.
                  </p>
                </div>
              )}

              {sessionError && (
                <p className="text-sm text-destructive">
                  {sessionError instanceof Error
                    ? sessionError.message
                    : "Failed to load session"}
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/70">
            <CardHeader>
              <CardTitle>Exam snapshot</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <SnapshotItem
                label="Generated questions"
                value={`${summary?.generatedQuestions ?? 0}/${exam.questionCount}`}
              />
              <SnapshotItem label="Answered" value={`${answeredCount}`} />
              <SnapshotItem
                label="Attached documents"
                value={`${summary?.documents ?? 0}`}
              />
              <SnapshotItem label="Created" value={summary?.createdAt ?? "-"} />
              <SnapshotItem label="Updated" value={summary?.updatedAt ?? "-"} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function ExamAttemptCard({
  question,
  index,
  total,
  mcqValue,
  writtenValue,
  onChangeWritten,
  onSaveWritten,
  onSelectMcq,
  onPrev,
  onNext,
  onJump,
  onSubmit,
  submitPending,
  answeredCount,
  savePending,
  sessionFetching,
}: {
  question: ExamQuestion;
  index: number;
  total: number;
  mcqValue?: string;
  writtenValue: string;
  onChangeWritten: (text: string) => void;
  onSaveWritten: () => void;
  onSelectMcq: (optionId: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onJump: (idx: number) => void;
  onSubmit: () => void;
  submitPending: boolean;
  answeredCount: number;
  savePending: boolean;
  sessionFetching: boolean;
}) {
  return (
    <div className="space-y-4 rounded-lg border border-emerald-200 bg-emerald-50/40 p-4 dark:border-emerald-800/40 dark:bg-emerald-500/5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-emerald-900 dark:text-emerald-100">
            Question {index + 1} of {total}
          </h2>
          <p className="text-xs text-emerald-800/90 dark:text-emerald-100/80">
            {answeredCount}/{total} answered
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onSubmit}
            disabled={submitPending}
          >
            {submitPending ? "Submitting..." : "Submit exam"}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border/70 bg-background p-4">
        <p className="text-sm font-medium text-muted-foreground">
          {question.topic ?? "General"}
        </p>
        <p className="mt-2 text-base leading-7">{question.content}</p>

        {question.type === "mcq" && question.options && (
          <div className="mt-4 space-y-2">
            {question.options.map((opt) => {
              const selected = mcqValue === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onSelectMcq(opt.id)}
                  className={cn(
                    "w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                    selected
                      ? "border-emerald-400 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-500/10"
                      : "border-border/70 bg-background hover:bg-muted/30",
                  )}
                >
                  <span className="font-semibold uppercase">{opt.id}.</span>{" "}
                  {opt.text}
                </button>
              );
            })}
          </div>
        )}

        {question.type === "descriptive" && (
          <div className="mt-4 space-y-2">
            <Textarea
              value={writtenValue}
              onChange={(e) => onChangeWritten(e.target.value)}
              placeholder="Write your answer here..."
              className="min-h-40"
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {writtenValue.trim().length} characters
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={onSaveWritten}
                disabled={savePending || !writtenValue.trim()}
              >
                <HugeiconsIcon
                  icon={NoteEditIcon}
                  strokeWidth={2}
                  className="size-4"
                />
                {savePending ? "Saving..." : "Save answer"}
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: total }).map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onJump(i)}
              className={cn(
                "size-7 rounded-md border text-xs",
                i === index
                  ? "border-emerald-500 bg-emerald-500 text-white"
                  : "border-border/70 bg-background",
              )}
            >
              {i + 1}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onPrev}
            disabled={index === 0}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onNext}
            disabled={index === total - 1}
          >
            Next
          </Button>
        </div>
      </div>

      {sessionFetching && (
        <p className="text-xs text-muted-foreground">
          Syncing latest session data...
        </p>
      )}
    </div>
  );
}

function GeneratingStateCard({
  generationState,
}: {
  generationState?: GenerationState;
}) {
  const progress = getGenerationProgress(generationState);

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-800/40 dark:bg-amber-500/10">
      <h2 className="text-lg font-semibold text-amber-900 dark:text-amber-100">
        Generation in progress
      </h2>
      <p className="mt-1 text-sm text-amber-800/90 dark:text-amber-100/80">
        Stay on this workspace while AI builds your questions. Status updates
        are streamed in real-time over WebSocket.
      </p>

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between text-xs font-medium text-amber-900 dark:text-amber-100">
          <span className="inline-flex items-center gap-1.5">
            <HugeiconsIcon
              icon={RefreshIcon}
              strokeWidth={2}
              className="size-3.5 animate-spin"
            />
            Building question set
          </span>
          <span>
            {generationState?.status === "failed"
              ? "Failed"
              : `${generationState?.current ?? 0}/${generationState?.total ?? "?"}`}
          </span>
        </div>
        <Progress
          value={generationState?.status === "failed" ? 0 : progress}
          className="h-2"
        />

        {generationState?.error && (
          <p className="text-xs text-rose-700 dark:text-rose-200">
            {generationState.error}
          </p>
        )}
      </div>
    </div>
  );
}

function SnapshotItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 font-medium">{value}</p>
    </div>
  );
}

export default ExamWorkspacePage;
