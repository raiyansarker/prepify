import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/exams")({
  component: ExamsPage,
});

function ExamsPage() {
  return (
    <>
      <title>Exams - Prepify</title>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Exams</h1>
          <p className="text-muted-foreground">
            Create and take AI-generated exams on any topic.
          </p>
        </div>

        <div className="flex min-h-[400px] flex-col items-center justify-center rounded-lg border border-dashed border-border p-8">
          <p className="text-lg font-medium text-muted-foreground">
            No exams yet
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first exam to test your knowledge.
          </p>
        </div>
      </div>
    </>
  );
}
