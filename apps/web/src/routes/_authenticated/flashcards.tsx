import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/flashcards")({
  component: FlashcardsLayout,
});

function FlashcardsLayout() {
  return <Outlet />;
}

export default FlashcardsLayout;
