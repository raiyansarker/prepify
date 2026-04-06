import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  Clock01Icon,
  RefreshIcon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "#/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "#/components/ui/card";
import { useExamWebSocket } from "#/hooks/use-exam-websocket";
import { api } from "#/lib/api";

export const Route = createFileRoute(
  "/_authenticated/exams/$examId/results/pending",
)({
  validateSearch: (search: Record<string, unknown>) => ({
    sessionId: (search.sessionId as string) || undefined,
  }),
  component: ExamResultsPendingPage,
});

function ExamResultsPendingPage() {
  const { examId } = Route.useParams();
  const { sessionId } = Route.useSearch();
  const navigate = useNavigate();

  const { grading, status, subscribeSession, unsubscribeSession } =
    useExamWebSocket();

  const latestSessionQuery = useQuery({
    queryKey: ["exam-latest-session", examId],
    enabled: !sessionId,
    retry: false,
    queryFn: async () => {
      const res = await api.exams({ id: examId }).sessions.latest.get();
      if (res.data?.success) {
        return (res.data as { success: true; data: { id: string } }).data;
      }
      return null;
    },
  });

  const resolvedSessionId = sessionId ?? latestSessionQuery.data?.id;

  useEffect(() => {
    if (!resolvedSessionId) return;
    subscribeSession(resolvedSessionId);
    return () => unsubscribeSession(resolvedSessionId);
  }, [resolvedSessionId, subscribeSession, unsubscribeSession]);

  const resultsReadyQuery = useQuery({
    queryKey: ["exam-results-check", resolvedSessionId],
    enabled: !!resolvedSessionId,
    retry: false,
    refetchInterval: ({ state }) => (state.data === true ? false : 2500),
    queryFn: async () => {
      if (!resolvedSessionId) return false;
      const res = await api.exams
        .sessions({ sessionId: resolvedSessionId })
        .results.get();
      return !!res.data && "success" in res.data && res.data.success;
    },
  });

  const gradingState = resolvedSessionId ? grading.get(resolvedSessionId) : undefined;
  const isComplete =
    gradingState?.status === "complete" || resultsReadyQuery.data === true;
  const isFailed = gradingState?.status === "failed";

  useEffect(() => {
    if (!resolvedSessionId || !isComplete) return;
    navigate({
      to: "/exams/$examId/results",
      params: { examId },
      search: { sessionId: resolvedSessionId },
      replace: true,
    });
  }, [examId, isComplete, navigate, resolvedSessionId]);

  useEffect(() => {
    if (!resolvedSessionId || !isFailed) return;
    navigate({
      to: "/exams/$examId/results/error",
      params: { examId },
      search: {
        sessionId: resolvedSessionId,
        message:
          gradingState?.error ||
          "We hit a problem while evaluating your answers.",
      },
      replace: true,
    });
  }, [examId, gradingState?.error, isFailed, navigate, resolvedSessionId]);

  const statusCopy =
    gradingState?.status === "in_progress"
      ? `Reviewed ${gradingState.current} of ${gradingState.total || "?"} answers`
      : gradingState?.status === "started"
        ? "Evaluation started"
        : resultsReadyQuery.isFetching
          ? "Checking for completed results"
          : "Waiting for the evaluator to begin";

  if (!resolvedSessionId && !latestSessionQuery.isLoading) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-3xl items-center justify-center px-4 py-10">
        <title>Pending results - Prepify</title>
        <Card className="w-full rounded-3xl border border-border/70 bg-card shadow-sm">
          <CardHeader className="border-b border-border/60">
            <CardTitle className="text-2xl font-semibold tracking-tight">
              No submission found
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <p className="text-sm leading-6 text-muted-foreground">
              There isn&apos;t a submitted exam session to evaluate yet.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                onClick={() =>
                  navigate({ to: "/exams/$examId", params: { examId } })
                }
              >
                <HugeiconsIcon
                  icon={ArrowLeft01Icon}
                  strokeWidth={2}
                  className="size-4"
                />
                Back to exam
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  navigate({ to: "/exams/$examId/start", params: { examId } })
                }
              >
                Open exam workspace
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-4xl items-center justify-center px-4 py-10">
      <title>Evaluating exam - Prepify</title>

      <div className="w-full overflow-hidden rounded-[2rem] border border-border/70 bg-card shadow-sm">
        <div className="grid gap-0 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="border-b border-border/60 p-8 lg:border-b-0 lg:border-r">
            <h1 className="mt-6 text-4xl font-semibold tracking-tight">
              Your exam is being reviewed
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground">
              Submission received. We&apos;re grading each answer asynchronously
              and will move you to the final results screen as soon as the full
              evaluation lands.
            </p>

            <div className="mt-8 flex items-center gap-4">
              <div className="relative flex size-20 items-center justify-center">
                <div className="animate-pending-ring-1 absolute inset-0 rounded-full border border-primary/30" />
                <div className="animate-pending-ring-2 absolute inset-2 rounded-full border border-primary/30" />
                <div className="animate-pending-ring-3 absolute inset-4 rounded-full border border-primary/30" />
                <div className="animate-pending-dot size-4 rounded-full bg-primary" />
              </div>
              <div>
                <p className="text-sm font-medium">{statusCopy}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Session {resolvedSessionId || "loading"}
                </p>
              </div>
            </div>
          </section>

          <aside className="space-y-5 p-8">
            <div className="rounded-3xl border border-border/60 bg-muted/30 p-5">
              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <HugeiconsIcon
                    icon={Clock01Icon}
                    strokeWidth={1.8}
                    className="size-5"
                  />
                </div>
                <div>
                  <p className="text-sm font-semibold">Usually under a minute</p>
                  <p className="text-sm text-muted-foreground">
                    The page keeps listening and polling until the result exists.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-border/60 bg-muted/30 p-5">
              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-600 dark:text-sky-300">
                  <HugeiconsIcon
                    icon={SparklesIcon}
                    strokeWidth={1.8}
                    className="size-5"
                  />
                </div>
                <div>
                  <p className="text-sm font-semibold">Automatic redirect</p>
                  <p className="text-sm text-muted-foreground">
                    When grading finishes, you&apos;ll be sent straight to the
                    final result page.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-border/60 bg-muted/30 p-5">
              <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                Connection
              </p>
              <p className="mt-2 text-sm font-medium capitalize">{status}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Live updates use the exam websocket, with polling as backup.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={() => resultsReadyQuery.refetch()}
              >
                <HugeiconsIcon
                  icon={RefreshIcon}
                  strokeWidth={2}
                  className={`size-4 ${resultsReadyQuery.isFetching ? "animate-spin" : ""}`}
                />
                Check now
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  navigate({ to: "/exams/$examId", params: { examId } })
                }
              >
                <HugeiconsIcon
                  icon={ArrowLeft01Icon}
                  strokeWidth={2}
                  className="size-4"
                />
                Back to exam
              </Button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

export default ExamResultsPendingPage;
