import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  ArrowLeft01Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "#/components/ui/button";

export const Route = createFileRoute(
  "/_authenticated/exams/$examId/results/error",
)({
  validateSearch: (search: Record<string, unknown>) => ({
    sessionId: (search.sessionId as string) || undefined,
    message: (search.message as string) || undefined,
  }),
  component: ExamResultsErrorPage,
});

function ExamResultsErrorPage() {
  const { examId } = Route.useParams();
  const { sessionId, message } = Route.useSearch();
  const navigate = useNavigate();

  return (
    <div className="relative isolate flex min-h-[calc(100vh-6rem)] items-center justify-center overflow-hidden px-4 py-10">
      <title>Evaluation error - Prepify</title>

      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,rgba(244,114,66,0.12),transparent_30%),radial-gradient(circle_at_bottom,rgba(248,113,113,0.12),transparent_28%)]" />

      <div className="w-full max-w-2xl overflow-hidden rounded-[2rem] border border-border/70 bg-card/95 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.45)] backdrop-blur">
        <div className="border-b border-border/60 bg-gradient-to-br from-rose-50 via-background to-amber-50/50 p-8 dark:from-rose-950/30 dark:via-background dark:to-amber-950/10">
          <div className="flex size-16 items-center justify-center rounded-3xl bg-destructive/10 text-destructive">
            <HugeiconsIcon
              icon={Alert02Icon}
              strokeWidth={1.8}
              className="size-8"
            />
          </div>
          <p className="mt-6 text-xs font-medium uppercase tracking-[0.32em] text-destructive/80">
            Evaluation error
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            We couldn&apos;t finish reviewing this exam
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground">
            {message ||
              "The AI evaluation job did not complete successfully. You can retry the pending screen or return to the exam and submit again if needed."}
          </p>
          {sessionId ? (
            <p className="mt-4 text-xs uppercase tracking-[0.24em] text-muted-foreground">
              Session {sessionId}
            </p>
          ) : null}
        </div>

        <div className="space-y-4 p-8">
          <div className="rounded-2xl border border-border/60 bg-muted/30 p-4 text-sm leading-6 text-muted-foreground">
            If this was a temporary processing issue, reopening the pending page
            lets the app keep listening for a recovered grading run.
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() =>
                navigate({
                  to: "/exams/$examId/results/pending",
                  params: { examId },
                  search: { sessionId },
                })
              }
            >
              <HugeiconsIcon
                icon={RefreshIcon}
                strokeWidth={2}
                className="size-4"
              />
              Retry evaluation status
            </Button>
            <Button
              variant="outline"
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
        </div>
      </div>
    </div>
  );
}

export default ExamResultsErrorPage;
