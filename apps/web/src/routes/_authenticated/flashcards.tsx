import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/flashcards")({
  component: FlashcardsPage,
});

function FlashcardsPage() {
  return (
    <>
      <title>Flashcards - Prepify</title>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Flashcards</h1>
          <p className="text-muted-foreground">
            Study with AI-generated flashcards using spaced repetition.
          </p>
        </div>

        <div className="flex min-h-[400px] flex-col items-center justify-center rounded-lg border border-dashed border-border p-8">
          <p className="text-lg font-medium text-muted-foreground">
            No flashcard decks yet
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a deck to start studying with flashcards.
          </p>
        </div>
      </div>
    </>
  );
}
