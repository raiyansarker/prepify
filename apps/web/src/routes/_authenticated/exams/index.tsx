import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  BookOpen01Icon,
  ChartBreakoutCircleIcon,
  Delete02Icon,
  FolderOpenIcon,
  MoreVerticalIcon,
  PlayIcon,
  RefreshIcon,
  SparklesIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { Progress } from "#/components/ui/progress";
import { useExamWebSocket } from "#/hooks/use-exam-websocket";
import { api } from "#/lib/api";
import { cn } from "#/lib/utils";
import type {
  ExamContextSource,
  ExamDurationMode,
  ExamStatus,
  ExamType,
} from "@repo/shared";

export const Route = createFileRoute("/_authenticated/exams/")({
  component: ExamsPage,
});

type Exam = {
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
};

type GenerationState = {
  current: number;
  total: number;
  status: "started" | "in_progress" | "complete" | "failed";
  error?: string;
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
  exam: Pick<Exam, "durationMode" | "durationMinutes">,
): string {
  if (exam.durationMode === "ai_decided") return "AI decides";
  if (exam.durationMinutes) return `${exam.durationMinutes} min`;
  return "Unset";
}

function getGenerationProgress(generation?: GenerationState): number {
  if (!generation) return 0;
  if (generation.status === "complete") return 100;
  if (generation.total > 0) {
    return Math.min(
      100,
      Math.round((generation.current / generation.total) * 100),
    );
  }
  return generation.status === "started" ? 8 : 0;
}

function ExamsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const subscribedGeneratingRef = useRef<Set<string>>(new Set());

  const [deleteTarget, setDeleteTarget] = useState<Exam | null>(null);

  const {
    generation,
    lastMessage,
    status: wsStatus,
    subscribeExam,
    unsubscribeExam,
  } = useExamWebSocket();

  const {
    data: exams = [],
    isLoading: examsLoading,
    isFetching: examsFetching,
  } = useQuery({
    queryKey: ["exams"],
    queryFn: async () => {
      const res = await api.exams.get();
      if (res.data?.success) {
        return (res.data as { success: true; data: Exam[] }).data;
      }
      return [] as Exam[];
    },
    refetchInterval: (query) => {
      const data = query.state.data as Exam[] | undefined;
      if (!data) return false;
      return data.some((exam) => exam.status === "generating") ? 3000 : false;
    },
  });

  useEffect(() => {
    const activeGenerating = new Set(
      exams
        .filter((exam) => exam.status === "generating")
        .map((exam) => exam.id),
    );

    activeGenerating.forEach((examId) => {
      if (!subscribedGeneratingRef.current.has(examId)) {
        subscribeExam(examId);
        subscribedGeneratingRef.current.add(examId);
      }
    });

    for (const examId of subscribedGeneratingRef.current) {
      if (!activeGenerating.has(examId)) {
        unsubscribeExam(examId);
        subscribedGeneratingRef.current.delete(examId);
      }
    }
  }, [exams, subscribeExam, unsubscribeExam]);

  useEffect(() => {
    if (!lastMessage) return;
    if (
      lastMessage.type === "generation_complete" ||
      lastMessage.type === "generation_failed"
    ) {
      queryClient.invalidateQueries({ queryKey: ["exams"] });
    }
  }, [lastMessage, queryClient]);

  useEffect(() => {
    return () => {
      for (const examId of subscribedGeneratingRef.current) {
        unsubscribeExam(examId);
      }
      subscribedGeneratingRef.current.clear();
    };
  }, [unsubscribeExam]);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.exams({ id }).delete();
      if (!(res.data && "success" in res.data && res.data.success)) {
        throw new Error(
          (res.data as { error?: string } | undefined)?.error ||
            "Failed to delete exam",
        );
      }
      return id;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["exams"] });
      unsubscribeExam(id);
      subscribedGeneratingRef.current.delete(id);
      setDeleteTarget(null);
    },
    onError: () => {
      setDeleteTarget(null);
    },
  });

  const stats = useMemo(() => {
    return {
      total: exams.length,
      generating: exams.filter((exam) => exam.status === "generating").length,
      ready: exams.filter((exam) => exam.status === "active").length,
      completed: exams.filter((exam) => exam.status === "completed").length,
      failed: exams.filter((exam) => exam.status === "failed").length,
    };
  }, [exams]);

  const loadingState = examsLoading || examsFetching;

  const handleTakeExam = useCallback(
    (examId: string) => {
      navigate({ to: "/exams/$examId", params: { examId } });
    },
    [navigate],
  );

  const handleViewResults = useCallback(
    (examId: string) => {
      navigate({
        to: "/exams/$examId/results",
        params: { examId },
        search: { sessionId: undefined },
      });
    },
    [navigate],
  );

  const handleCreateExam = useCallback(() => {
    navigate({ to: "/exams/new" });
  }, [navigate]);

  return (
    <>
      <title>Exams - Prepify</title>

      <div className="space-y-8">
        <section className="relative overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-slate-50 via-background to-amber-50/40 dark:from-slate-950 dark:via-background dark:to-amber-950/10">
          <div className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-amber-200/35 blur-3xl dark:bg-amber-500/10" />
          <div className="pointer-events-none absolute -bottom-20 left-8 size-52 rounded-full bg-sky-200/30 blur-3xl dark:bg-sky-500/10" />

          <div className="relative space-y-6 p-5 sm:p-6 lg:p-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-3xl space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Exam control center
                </p>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                  Build, monitor, and launch exams
                </h1>
                <p className="text-sm leading-6 text-muted-foreground sm:text-base">
                  Generate exams from your uploaded content or global context,
                  monitor AI generation live, and jump into exam workspaces when
                  each set is ready.
                </p>
              </div>

              <div className="flex items-center gap-2 self-start">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    queryClient.invalidateQueries({ queryKey: ["exams"] })
                  }
                  disabled={examsLoading}
                >
                  <HugeiconsIcon
                    icon={RefreshIcon}
                    strokeWidth={2}
                    className="size-4"
                  />
                  Refresh
                </Button>
                <Button size="sm" onClick={handleCreateExam}>
                  <HugeiconsIcon
                    icon={Add01Icon}
                    strokeWidth={2}
                    className="size-4"
                  />
                  New exam
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <ConnectionBadge status={wsStatus} />
              {loadingState && (
                <Badge
                  variant="outline"
                  className="gap-1 border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-500/10 dark:text-amber-100"
                >
                  <HugeiconsIcon
                    icon={RefreshIcon}
                    strokeWidth={2}
                    className="size-3 animate-spin"
                  />
                  Syncing
                </Badge>
              )}
              {stats.failed > 0 && (
                <Badge
                  variant="outline"
                  className="border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/60 dark:bg-rose-500/10 dark:text-rose-100"
                >
                  {stats.failed} failed exam{stats.failed > 1 ? "s" : ""}
                </Badge>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <HeroMetric
                label="Total"
                value={stats.total}
                icon={BookOpen01Icon}
                tone="default"
              />
              <HeroMetric
                label="Generating"
                value={stats.generating}
                icon={RefreshIcon}
                tone="amber"
              />
              <HeroMetric
                label="Ready"
                value={stats.ready}
                icon={PlayIcon}
                tone="emerald"
              />
              <HeroMetric
                label="Completed"
                value={stats.completed}
                icon={Tick02Icon}
                tone="sky"
              />
            </div>
          </div>
        </section>

        {examsLoading ? (
          <ExamSkeletonGrid />
        ) : exams.length === 0 ? (
          <EmptyState onCreate={handleCreateExam} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {exams.map((exam) => (
              <ExamCard
                key={exam.id}
                exam={exam}
                generation={generation.get(exam.id)}
                onDelete={() => setDeleteTarget(exam)}
                onTake={() => handleTakeExam(exam.id)}
                onViewResults={() => handleViewResults(exam.id)}
              />
            ))}
          </div>
        )}
      </div>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete exam?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.title}" and all related session data will be
              removed. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
              }}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ConnectionBadge({
  status,
}: {
  status: "connecting" | "connected" | "disconnected" | "error";
}) {
  const isConnected = status === "connected";

  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 border",
        isConnected
          ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-500/10 dark:text-emerald-100"
          : "border-muted bg-muted/40 text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          isConnected ? "bg-emerald-500" : "bg-muted-foreground/60",
        )}
      />
      WebSocket {isConnected ? "live" : status}
    </Badge>
  );
}

function HeroMetric({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: "default" | "amber" | "emerald" | "sky";
  icon: unknown;
}) {
  const toneClass =
    tone === "amber"
      ? "border-amber-200/80 bg-amber-50/80 dark:border-amber-800/30 dark:bg-amber-500/5"
      : tone === "emerald"
        ? "border-emerald-200/80 bg-emerald-50/80 dark:border-emerald-800/30 dark:bg-emerald-500/5"
        : tone === "sky"
          ? "border-sky-200/80 bg-sky-50/80 dark:border-sky-800/30 dark:bg-sky-500/5"
          : "border-border/70 bg-card";

  return (
    <div className={cn("rounded-xl border p-3 shadow-xs", toneClass)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
        <HugeiconsIcon icon={icon as any} strokeWidth={2} className="size-4" />
      </div>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function ExamCard({
  exam,
  generation,
  onDelete,
  onTake,
  onViewResults,
}: {
  exam: Exam;
  generation?: GenerationState;
  onDelete: () => void;
  onTake: () => void;
  onViewResults: () => void;
}) {
  const status = statusMeta[exam.status];
  const progress = getGenerationProgress(generation);

  return (
    <Card className="group relative overflow-hidden border-border/70 bg-card/95 transition-all hover:-translate-y-0.5 hover:border-border hover:shadow-lg">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-300 via-amber-300 to-emerald-300 opacity-70" />
      <CardHeader className="space-y-3 pb-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <CardTitle className="line-clamp-2 text-lg leading-snug">
              {exam.title}
            </CardTitle>
            <CardDescription className="line-clamp-2 text-sm leading-5">
              {exam.topic}
            </CardDescription>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Open exam menu"
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted"
            >
              <HugeiconsIcon
                icon={MoreVerticalIcon}
                strokeWidth={2}
                className="size-4"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={onViewResults}
                disabled={exam.status !== "completed"}
              >
                <HugeiconsIcon
                  icon={ChartBreakoutCircleIcon}
                  strokeWidth={2}
                  className="size-4"
                />
                View results
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:bg-destructive/10"
                onClick={onDelete}
              >
                <HugeiconsIcon
                  icon={Delete02Icon}
                  strokeWidth={2}
                  className="size-4"
                />
                Delete exam
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge className={cn("gap-1 border", status.className)}>
            <span
              className={cn("size-1.5 rounded-full", status.dotClassName)}
            />
            {status.label}
          </Badge>
          <Badge variant="outline" className="gap-1">
            <HugeiconsIcon
              icon={Tick02Icon}
              strokeWidth={2}
              className="size-3"
            />
            {examTypeCopy[exam.type]}
          </Badge>
          <Badge variant="outline" className="gap-1">
            <HugeiconsIcon
              icon={SparklesIcon}
              strokeWidth={2}
              className="size-3"
            />
            {contextCopy[exam.contextSource]}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        <div className="grid grid-cols-2 gap-2 text-sm lg:grid-cols-4">
          <MetaCell label="Questions" value={`${exam.questionCount}`} />
          <MetaCell label="Duration" value={getDurationLabel(exam)} />
          <MetaCell label="Created" value={formatDate(exam.createdAt)} />
          <MetaCell label="Updated" value={formatDate(exam.updatedAt)} />
        </div>

        {exam.status === "generating" && (
          <div className="space-y-2 rounded-lg border border-amber-300/70 bg-amber-50/60 p-3 dark:border-amber-800/40 dark:bg-amber-500/10">
            <div className="flex items-center justify-between text-xs font-medium text-amber-900 dark:text-amber-100">
              <span className="inline-flex items-center gap-1.5">
                <HugeiconsIcon
                  icon={RefreshIcon}
                  strokeWidth={2}
                  className="size-3.5 animate-spin"
                />
                Generating questions
              </span>
              <span>
                {generation?.status === "failed"
                  ? "Failed"
                  : `${generation?.current ?? 0}/${generation?.total ?? "?"}`}
              </span>
            </div>
            <Progress value={generation?.status === "failed" ? 0 : progress} />
            {generation?.error && (
              <p className="text-xs text-rose-700 dark:text-rose-200">
                {generation.error}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={onTake}
            disabled={exam.status !== "active" && exam.status !== "generating"}
          >
            <HugeiconsIcon icon={PlayIcon} strokeWidth={2} className="size-4" />
            {exam.status === "generating" ? "Open workspace" : "Take exam"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onViewResults}
            disabled={exam.status !== "completed"}
          >
            <HugeiconsIcon
              icon={ChartBreakoutCircleIcon}
              strokeWidth={2}
              className="size-4"
            />
            View results
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDelete}
            className="text-destructive"
          >
            <HugeiconsIcon
              icon={Delete02Icon}
              strokeWidth={2}
              className="size-4"
            />
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/30 px-2.5 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 truncate text-sm font-medium">{value}</p>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex min-h-[340px] flex-col items-center justify-center text-center">
        <div className="rounded-full border border-dashed border-border p-3">
          <HugeiconsIcon
            icon={FolderOpenIcon}
            strokeWidth={2}
            className="size-6 text-muted-foreground"
          />
        </div>
        <h2 className="mt-4 text-xl font-semibold">No exams yet</h2>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Create your first exam to test understanding, track progress, and
          compare results over time.
        </p>
        <Button className="mt-5" onClick={onCreate}>
          <HugeiconsIcon
            icon={SparklesIcon}
            strokeWidth={2}
            className="size-4"
          />
          Create first exam
        </Button>
      </CardContent>
    </Card>
  );
}

function ExamSkeletonGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, idx) => (
        <Card key={idx} className="overflow-hidden border-border/60">
          <div className="h-56 animate-pulse bg-gradient-to-r from-muted/40 via-muted to-muted/40" />
        </Card>
      ))}
    </div>
  );
}

export default ExamsPage;
