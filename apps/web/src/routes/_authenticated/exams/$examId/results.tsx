import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  CheckmarkCircle02Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Progress } from "#/components/ui/progress";
import { useExamWebSocket } from "#/hooks/use-exam-websocket";
import { api } from "#/lib/api";

type ResultData = {
  result: {
    totalScore: number;
    maxScore: number;
    percentage: number;
    feedback: {
      overallFeedback: string;
      topicStrengths: string[];
      topicWeaknesses: string[];
      recommendations: string[];
    };
  };
  answers: {
    id: string;
    userAnswer: string | null;
    isCorrect: boolean | null;
    score: number | null;
    question: {
      id: string;
      type: "mcq" | "descriptive";
      content: string;
      correctAnswer: string;
      explanation: string | null;
      points: number;
    };
  }[];
};

export const Route = createFileRoute("/_authenticated/exams/$examId/results")({
  validateSearch: (search: Record<string, unknown>) => ({
    sessionId: (search.sessionId as string) || undefined,
  }),
  component: ExamResultsPage,
});

function ExamResultsPage() {
  const { examId } = Route.useParams();
  const { sessionId } = Route.useSearch();
  const navigate = useNavigate();
  const { grading, subscribeSession, unsubscribeSession } = useExamWebSocket();

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["exam-results", sessionId],
    enabled: !!sessionId,
    queryFn: async () => {
      if (!sessionId) return null;
      const res = await api.exams.sessions({ sessionId }).results.get();
      if (res.data?.success) {
        return (res.data as { success: true; data: ResultData }).data;
      }
      throw new Error(
        (res.data as { error?: string } | undefined)?.error ||
          "Result not available yet",
      );
    },
    retry: false,
    refetchInterval: () => {
      if (!sessionId) return false;
      const g = grading.get(sessionId);
      if (!g) return 2000;
      return g.status === "in_progress" || g.status === "started"
        ? 2000
        : false;
    },
  });

  useEffect(() => {
    if (!sessionId) return;
    subscribeSession(sessionId);
    return () => unsubscribeSession(sessionId);
  }, [sessionId, subscribeSession, unsubscribeSession]);

  const gradingState = sessionId ? grading.get(sessionId) : undefined;

  if (!sessionId) {
    return (
      <div className="space-y-4">
        <title>Exam results - Prepify</title>
        <h1 className="text-2xl font-semibold">Session ID is required</h1>
        <p className="text-sm text-muted-foreground">
          Open results from an exam submission to include session context.
        </p>
        <Button
          onClick={() => navigate({ to: "/exams/$examId", params: { examId } })}
        >
          <HugeiconsIcon
            icon={ArrowLeft01Icon}
            strokeWidth={2}
            className="size-4"
          />
          Back to exam
        </Button>
      </div>
    );
  }

  const isGradingInProgress =
    gradingState?.status === "started" ||
    gradingState?.status === "in_progress";

  return (
    <div className="space-y-6">
      <title>Exam results - Prepify</title>

      <section className="rounded-2xl border border-border/70 bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Exam results
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Session: {sessionId}
            </p>
          </div>
          <div className="flex items-center gap-2">
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
              Back to exam
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <HugeiconsIcon
                icon={RefreshIcon}
                strokeWidth={2}
                className={`size-4 ${isFetching ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        </div>
      </section>

      {(isLoading || isGradingInProgress) && (
        <Card>
          <CardHeader>
            <CardTitle>Grading in progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              We are evaluating your answers. This page refreshes automatically.
            </p>
            <Progress
              value={
                gradingState && gradingState.total > 0
                  ? Math.round(
                      (gradingState.current / gradingState.total) * 100,
                    )
                  : 10
              }
            />
            {gradingState && (
              <p className="text-xs text-muted-foreground">
                {gradingState.current}/{gradingState.total || "?"} items graded
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {!isLoading && error && !isGradingInProgress && (
        <Card>
          <CardHeader>
            <CardTitle>Results not ready</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {error instanceof Error
                ? error.message
                : "Unable to load results"}
            </p>
            <Button size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard
              label="Score"
              value={`${data.result.totalScore.toFixed(1)} / ${data.result.maxScore.toFixed(1)}`}
            />
            <MetricCard
              label="Percentage"
              value={`${Math.round(data.result.percentage)}%`}
            />
            <MetricCard
              label="Answered"
              value={`${data.answers.filter((a) => a.userAnswer?.trim()).length}/${data.answers.length}`}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Overall feedback</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm leading-6">
                {data.result.feedback.overallFeedback}
              </p>
              <div className="grid gap-3 md:grid-cols-3">
                <FeedbackList
                  title="Strengths"
                  items={data.result.feedback.topicStrengths}
                />
                <FeedbackList
                  title="Weaknesses"
                  items={data.result.feedback.topicWeaknesses}
                />
                <FeedbackList
                  title="Recommendations"
                  items={data.result.feedback.recommendations}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Question breakdown</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.answers.map((item, idx) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-border/70 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">Q{idx + 1}</p>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{item.question.type}</Badge>
                      <Badge variant="outline">
                        {item.score ?? 0} / {item.question.points}
                      </Badge>
                      {item.isCorrect === true && (
                        <Badge className="gap-1 border border-emerald-300 bg-emerald-50 text-emerald-700">
                          <HugeiconsIcon
                            icon={CheckmarkCircle02Icon}
                            strokeWidth={2}
                            className="size-3"
                          />
                          Correct
                        </Badge>
                      )}
                    </div>
                  </div>
                  <p className="mt-2 text-sm leading-6">
                    {item.question.content}
                  </p>
                  <div className="mt-2 space-y-1 text-sm">
                    <p>
                      <span className="font-medium">Your answer:</span>{" "}
                      {item.userAnswer?.trim() || "Not answered"}
                    </p>
                    <p>
                      <span className="font-medium">Expected:</span>{" "}
                      {item.question.correctAnswer}
                    </p>
                    {item.question.explanation && (
                      <p>
                        <span className="font-medium">Explanation:</span>{" "}
                        {item.question.explanation}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="text-xl font-semibold tracking-tight">{value}</p>
      </CardContent>
    </Card>
  );
}

function FeedbackList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/20 p-3">
      <p className="text-sm font-semibold">{title}</p>
      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
        {items.length === 0 ? (
          <li>-</li>
        ) : (
          items.map((item) => <li key={item}>- {item}</li>)
        )}
      </ul>
    </div>
  );
}

export default ExamResultsPage;
