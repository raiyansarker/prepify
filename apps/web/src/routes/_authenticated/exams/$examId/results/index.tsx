import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  CheckmarkCircle02Icon,
  RefreshIcon,
  SparklesIcon,
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
    questionId: string;
    userAnswer: string | null;
    extractedText: string | null;
    isCorrect: boolean | null;
    score: number | null;
    aiGrading: {
      score: number;
      maxScore: number;
      feedback: string;
      strengths: string[];
      weaknesses: string[];
    } | null;
    question: {
      id: string;
      type: "mcq" | "descriptive";
      content: string;
      options?: { id: string; text: string }[] | null;
      correctAnswer: string;
      explanation: string | null;
      points: number;
    };
  }[];
};

export const Route = createFileRoute(
  "/_authenticated/exams/$examId/results/",
)({
  validateSearch: (search: Record<string, unknown>) => ({
    sessionId: (search.sessionId as string) || undefined,
  }),
  component: ExamResultsPage,
});

function getMcqOptionLabel(
  options: { id: string; text: string }[] | null | undefined,
  optionId: string | null | undefined,
): string {
  if (!optionId) return "Not answered";
  const option = options?.find((candidate) => candidate.id === optionId);
  return option ? `${option.id} - ${option.text}` : optionId;
}

function ExamResultsPage() {
  const { examId } = Route.useParams();
  const { sessionId } = Route.useSearch();
  const navigate = useNavigate();

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

  const resultsQuery = useQuery({
    queryKey: ["exam-results", resolvedSessionId],
    enabled: !!resolvedSessionId,
    retry: false,
    queryFn: async () => {
      if (!resolvedSessionId) return null;
      const res = await api.exams
        .sessions({ sessionId: resolvedSessionId })
        .results.get();

      if (res.data?.success) {
        return (res.data as { success: true; data: ResultData }).data;
      }

      return null;
    },
  });

  useEffect(() => {
    if (!resolvedSessionId || resultsQuery.isLoading || resultsQuery.data) return;
    navigate({
      to: "/exams/$examId/results/pending",
      params: { examId },
      search: { sessionId: resolvedSessionId },
      replace: true,
    });
  }, [
    examId,
    navigate,
    resolvedSessionId,
    resultsQuery.data,
    resultsQuery.isLoading,
  ]);

  if (!resolvedSessionId && !latestSessionQuery.isLoading) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-3xl items-center justify-center px-4 py-10">
        <title>Exam results - Prepify</title>
        <Card className="w-full rounded-3xl border border-border/70 bg-card/90 shadow-sm">
          <CardHeader className="gap-3 border-b border-border/60 bg-gradient-to-r from-slate-50 via-background to-amber-50/40 dark:from-slate-950 dark:via-background dark:to-amber-950/10">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <HugeiconsIcon
                icon={SparklesIcon}
                strokeWidth={1.8}
                className="size-7"
              />
            </div>
            <CardTitle className="text-2xl font-semibold tracking-tight">
              No completed attempt yet
            </CardTitle>
            <CardDescription className="max-w-xl text-sm leading-6">
              Results appear after you finish an exam attempt and the AI
              evaluation completes.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3 pt-6">
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
            <Button
              variant="outline"
              onClick={() =>
                navigate({ to: "/exams/$examId/start", params: { examId } })
              }
            >
              Open exam workspace
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (resultsQuery.isLoading || !resultsQuery.data) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-3xl items-center justify-center px-4 py-10">
        <title>Exam results - Prepify</title>
        <div className="w-full rounded-3xl border border-border/70 bg-gradient-to-br from-slate-50 via-background to-sky-50/30 p-8 shadow-sm dark:from-slate-950 dark:via-background dark:to-sky-950/10">
          <div className="h-5 w-32 animate-pulse rounded-full bg-muted" />
          <div className="mt-6 h-10 w-56 animate-pulse rounded-full bg-muted" />
          <div className="mt-3 h-4 w-80 max-w-full animate-pulse rounded-full bg-muted" />
        </div>
      </div>
    );
  }

  const answeredCount = resultsQuery.data.answers.filter((item) =>
    item.userAnswer?.trim(),
  ).length;

  return (
    <div className="space-y-6">
      <title>Exam results - Prepify</title>

      <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-br from-slate-50 via-background to-emerald-50/40 p-5 shadow-sm sm:p-6 dark:from-slate-950 dark:via-background dark:to-emerald-950/10">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-300 via-primary/80 to-amber-300 opacity-80" />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <Badge className="w-fit rounded-full border border-emerald-300/70 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
              Evaluation complete
            </Badge>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                Your exam results are ready
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Session {resolvedSessionId}. Review the score breakdown, AI
                feedback, and question-by-question evaluation below.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => resultsQuery.refetch()}
            >
              <HugeiconsIcon
                icon={RefreshIcon}
                strokeWidth={2}
                className={`size-4 ${resultsQuery.isFetching ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          label="Final score"
          value={`${resultsQuery.data.result.totalScore.toFixed(1)} / ${resultsQuery.data.result.maxScore.toFixed(1)}`}
          tone="primary"
        />
        <MetricCard
          label="Percentage"
          value={`${Math.round(resultsQuery.data.result.percentage)}%`}
          tone="success"
        />
        <MetricCard
          label="Answered"
          value={`${answeredCount} / ${resultsQuery.data.answers.length}`}
          tone="muted"
        />
      </div>

      <Card className="rounded-3xl border border-border/70 shadow-sm">
        <CardHeader className="border-b border-border/60">
          <CardTitle className="text-xl font-semibold">
            Overall feedback
          </CardTitle>
          <CardDescription>
            A concise AI summary of your performance and next steps.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          <p className="text-sm leading-7 text-foreground/90">
            {resultsQuery.data.result.feedback.overallFeedback}
          </p>
          <div className="grid gap-4 lg:grid-cols-3">
            <FeedbackList
              title="Strengths"
              items={resultsQuery.data.result.feedback.topicStrengths}
              tone="emerald"
            />
            <FeedbackList
              title="Needs work"
              items={resultsQuery.data.result.feedback.topicWeaknesses}
              tone="amber"
            />
            <FeedbackList
              title="Recommendations"
              items={resultsQuery.data.result.feedback.recommendations}
              tone="sky"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border border-border/70 shadow-sm">
        <CardHeader className="border-b border-border/60">
          <CardTitle className="text-xl font-semibold">
            Question breakdown
          </CardTitle>
          <CardDescription>
            Compare your answer with the expected answer and review the scoring.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          {resultsQuery.data.answers.map((item, idx) => (
            <article
              key={item.id}
              className="rounded-2xl border border-border/70 bg-background/80 p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                    Question {idx + 1}
                  </p>
                  <p className="mt-2 text-sm leading-7">{item.question.content}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="rounded-full">
                    {item.question.type}
                  </Badge>
                  <Badge variant="outline" className="rounded-full">
                    {item.score ?? 0} / {item.question.points}
                  </Badge>
                  {item.isCorrect === true ? (
                    <Badge className="rounded-full border border-emerald-300/70 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                      <HugeiconsIcon
                        icon={CheckmarkCircle02Icon}
                        strokeWidth={2}
                        className="size-3.5"
                      />
                      Correct
                    </Badge>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <AnswerPanel
                  label="Your answer"
                  value={
                    item.question.type === "mcq"
                      ? getMcqOptionLabel(
                          item.question.options,
                          item.userAnswer?.trim() || null,
                        )
                      : item.userAnswer?.trim() || "Not answered"
                  }
                />
                <AnswerPanel
                  label="Expected answer"
                  value={
                    item.question.type === "mcq"
                      ? getMcqOptionLabel(
                          item.question.options,
                          item.question.correctAnswer,
                        )
                      : item.question.correctAnswer
                  }
                />
              </div>

              {item.question.type === "descriptive" && item.aiGrading ? (
                <div className="mt-4 grid gap-3 lg:grid-cols-3">
                  <AnswerPanel label="AI feedback" value={item.aiGrading.feedback} />
                  <AnswerPanel
                    label="Strengths"
                    value={
                      item.aiGrading.strengths.length > 0
                        ? item.aiGrading.strengths.join(", ")
                        : "No specific strengths noted"
                    }
                  />
                  <AnswerPanel
                    label="Weaknesses"
                    value={
                      item.aiGrading.weaknesses.length > 0
                        ? item.aiGrading.weaknesses.join(", ")
                        : "No specific weaknesses noted"
                    }
                  />
                </div>
              ) : null}

              {item.question.explanation ? (
                <div className="mt-4 rounded-2xl border border-border/60 bg-muted/40 p-4">
                  <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                    Explanation
                  </p>
                  <p className="mt-2 text-sm leading-7 text-foreground/85">
                    {item.question.explanation}
                  </p>
                </div>
              ) : null}
            </article>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "primary" | "success" | "muted";
}) {
  const toneClassName =
    tone === "primary"
      ? "from-primary/12 to-primary/4"
      : tone === "success"
        ? "from-emerald-500/12 to-emerald-500/4"
        : "from-slate-500/10 to-transparent";

  return (
    <Card
      className={`rounded-3xl border border-border/70 bg-gradient-to-br ${toneClassName} shadow-sm`}
    >
      <CardContent className="space-y-2 p-5">
        <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
          {label}
        </p>
        <p className="text-3xl font-semibold tracking-tight">{value}</p>
      </CardContent>
    </Card>
  );
}

function FeedbackList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "emerald" | "amber" | "sky";
}) {
  const toneClassName =
    tone === "emerald"
      ? "border-emerald-300/60 bg-emerald-50/60 dark:border-emerald-500/20 dark:bg-emerald-500/10"
      : tone === "amber"
        ? "border-amber-300/60 bg-amber-50/60 dark:border-amber-500/20 dark:bg-amber-500/10"
        : "border-sky-300/60 bg-sky-50/60 dark:border-sky-500/20 dark:bg-sky-500/10";

  return (
    <div className={`rounded-2xl border p-4 ${toneClassName}`}>
      <p className="text-sm font-semibold">{title}</p>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No highlights yet.</p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm leading-6 text-foreground/85">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AnswerPanel({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-muted/30 p-4">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-sm leading-7 text-foreground/85 whitespace-pre-wrap">
        {value}
      </p>
    </div>
  );
}

export default ExamResultsPage;
