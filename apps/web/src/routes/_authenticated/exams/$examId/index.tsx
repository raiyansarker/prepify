import { useEffect, useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  Clock01Icon,
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

type SessionSummary = {
  id: string;
  examId: string;
  status: "in_progress" | "submitted" | "timed_out";
  startedAt: string;
  endsAt: string;
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

function formatRemaining(endsAt: string): string {
  const sec = Math.max(
    0,
    Math.floor((new Date(endsAt).getTime() - Date.now()) / 1000),
  );
  const mm = Math.floor(sec / 60)
    .toString()
    .padStart(2, "0");
  const ss = (sec % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
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

function ExamWorkspacePage() {
  const { examId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const {
    generation,
    lastMessage,
    status: wsStatus,
    subscribeExam,
    unsubscribeExam,
  } = useExamWebSocket();

  const examQuery = useQuery({
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

  const latestSessionQuery = useQuery({
    queryKey: ["exam-latest-session", examId],
    retry: false,
    queryFn: async () => {
      const res = await api.exams({ id: examId }).sessions.latest.get();
      if (res.data?.success) {
        return (res.data as { success: true; data: SessionSummary }).data;
      }
      return null;
    },
  });

  useEffect(() => {
    subscribeExam(examId);
    return () => unsubscribeExam(examId);
  }, [examId, subscribeExam, unsubscribeExam]);

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
        return (res.data as { success: true; data: SessionSummary }).data;
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
      navigate({
        to: "/exams/$examId/start",
        params: { examId },
      });
    },
  });

  const exam = examQuery.data;
  const latestSession = latestSessionQuery.data;
  const generationState = generation.get(examId);

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

  const hasResumableSession = latestSession?.status === "in_progress";

  if (examQuery.isLoading) {
    return (
      <div className="space-y-6">
        <title>Exam workspace - Prepify</title>
        <div className="h-40 animate-pulse rounded-xl border bg-muted/40" />
        <div className="h-72 animate-pulse rounded-xl border bg-muted/40" />
      </div>
    );
  }

  if (examQuery.error || !exam) {
    return (
      <div className="space-y-4">
        <title>Exam workspace - Prepify</title>
        <h1 className="text-2xl font-semibold">
          Unable to load exam workspace
        </h1>
        <p className="text-sm text-muted-foreground">
          {examQuery.error instanceof Error
            ? examQuery.error.message
            : "Exam not found"}
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
                  onClick={() => {
                    queryClient.invalidateQueries({
                      queryKey: ["exam", examId],
                    });
                    queryClient.invalidateQueries({
                      queryKey: ["exam-latest-session", examId],
                    });
                  }}
                >
                  <HugeiconsIcon
                    icon={RefreshIcon}
                    strokeWidth={2}
                    className={cn(
                      "size-4",
                      examQuery.isFetching && "animate-spin",
                    )}
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
            </div>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <Card className="border-border/70">
            <CardHeader>
              <CardTitle>Workspace status</CardTitle>
              <CardDescription>
                Start or resume your attempt from this workspace.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {exam.status === "generating" && (
                <GeneratingStateCard generationState={generationState} />
              )}

              {exam.status === "active" && !hasResumableSession && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-800/40 dark:bg-emerald-500/10">
                  <h2 className="text-lg font-semibold text-emerald-900 dark:text-emerald-100">
                    Exam is ready
                  </h2>
                  <p className="mt-1 text-sm text-emerald-800/90 dark:text-emerald-100/80">
                    Click Give exam to open the exam page with timer and
                    generated questions.
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Button
                      onClick={() => startSessionMutation.mutate()}
                      disabled={startSessionMutation.isPending}
                    >
                      <HugeiconsIcon
                        icon={PlayIcon}
                        strokeWidth={2}
                        className="size-4"
                      />
                      {startSessionMutation.isPending
                        ? "Starting..."
                        : "Give exam"}
                    </Button>
                  </div>
                </div>
              )}

              {hasResumableSession && latestSession && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-800/40 dark:bg-emerald-500/10">
                  <h2 className="text-lg font-semibold text-emerald-900 dark:text-emerald-100">
                    Attempt in progress
                  </h2>
                  <p className="mt-1 text-sm text-emerald-800/90 dark:text-emerald-100/80">
                    Resume your active attempt.
                  </p>
                  <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-100/70 px-2.5 py-1.5 text-xs text-emerald-900 dark:border-emerald-700/60 dark:bg-emerald-500/10 dark:text-emerald-100">
                    <HugeiconsIcon
                      icon={Clock01Icon}
                      strokeWidth={2}
                      className="size-3.5"
                    />
                    {formatRemaining(latestSession.endsAt)} left
                  </div>
                  <div className="mt-4">
                    <Button
                      onClick={() =>
                        navigate({
                          to: "/exams/$examId/start",
                          params: { examId },
                        })
                      }
                    >
                      <HugeiconsIcon
                        icon={PlayIcon}
                        strokeWidth={2}
                        className="size-4"
                      />
                      Resume attempt
                    </Button>
                  </div>
                </div>
              )}

              {latestSession &&
                (latestSession.status === "submitted" ||
                  latestSession.status === "timed_out") && (
                  <div className="rounded-lg border border-sky-200 bg-sky-50/70 p-4 dark:border-sky-800/40 dark:bg-sky-500/10">
                    <h2 className="text-lg font-semibold text-sky-900 dark:text-sky-100">
                      Last attempt submitted
                    </h2>
                    <p className="mt-1 text-sm text-sky-900/90 dark:text-sky-100/80">
                      Open your latest results.
                    </p>
                    <div className="mt-4">
                      <Button
                        onClick={() =>
                          navigate({
                            to: "/exams/$examId/results",
                            params: { examId },
                            search: { sessionId: latestSession.id },
                          })
                        }
                      >
                        View results
                      </Button>
                    </div>
                  </div>
                )}

              {exam.status === "failed" && (
                <div className="rounded-lg border border-rose-200 bg-rose-50/70 p-4 dark:border-rose-800/40 dark:bg-rose-500/10">
                  <h2 className="text-lg font-semibold text-rose-900 dark:text-rose-100">
                    Generation failed
                  </h2>
                  <p className="mt-1 text-sm text-rose-800/90 dark:text-rose-100/80">
                    This exam failed during AI generation. You can create
                    another exam with adjusted settings.
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

              {startSessionMutation.error && (
                <p className="text-sm text-destructive">
                  {startSessionMutation.error instanceof Error
                    ? startSessionMutation.error.message
                    : "Failed to start exam"}
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
