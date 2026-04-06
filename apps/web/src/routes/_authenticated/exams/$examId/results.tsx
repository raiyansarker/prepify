import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/exams/$examId/results")({
  component: ExamResultsLayout,
});

function ExamResultsLayout() {
  return <Outlet />;
}

export default ExamResultsLayout;
