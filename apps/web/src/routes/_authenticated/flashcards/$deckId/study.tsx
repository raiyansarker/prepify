import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  CheckmarkCircle02Icon,
  ViewIcon,
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
import type { Flashcard, FlashcardDeck } from "@repo/shared";

export const Route = createFileRoute(
  "/_authenticated/flashcards/$deckId/study",
)({
  component: FlashcardStudyPage,
});

type DeckDetail = FlashcardDeck & {
  dueCount: number;
  documents: { id: string; name: string; status: string }[];
  flashcards: Flashcard[];
};

const ratingOptions = [
  { id: "again", label: "Again" },
  { id: "hard", label: "Hard" },
  { id: "good", label: "Good" },
  { id: "easy", label: "Easy" },
] as const;

function FlashcardStudyPage() {
  const { deckId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [studyMode, setStudyMode] = useState<"due" | "all">("due");

  const deckQuery = useQuery({
    queryKey: ["flashcard-deck", deckId],
    queryFn: async () => {
      const res = await api.flashcards({ deckId }).get();
      if (res.data?.success) {
        return res.data.data as DeckDetail;
      }
      throw new Error(
        (res.data as { error?: string } | undefined)?.error ||
          "Failed to load deck",
      );
    },
  });

  const dueCards = useMemo(
    () =>
      (deckQuery.data?.flashcards ?? []).filter(
        (card) => new Date(card.nextReviewAt).getTime() <= Date.now(),
      ),
    [deckQuery.data?.flashcards],
  );

  const studyCards =
    studyMode === "all" ? deckQuery.data?.flashcards ?? [] : dueCards;
  const currentCard = studyCards[currentIndex] ?? null;

  const reviewMutation = useMutation({
    mutationFn: async (rating: (typeof ratingOptions)[number]["id"]) => {
      if (!currentCard) throw new Error("No card selected");
      const res = await api.flashcards({ deckId }).review.post({
        flashcardId: currentCard.id,
        rating,
      });
      if (!(res.data && "success" in res.data && res.data.success)) {
        throw new Error(
          (res.data as { error?: string } | undefined)?.error ||
            "Failed to record review",
        );
      }
      return res.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flashcard-deck", deckId] });
      queryClient.invalidateQueries({ queryKey: ["flashcard-decks"] });
      setRevealed(false);
      setCurrentIndex((prev) => prev + 1);
    },
  });

  if (deckQuery.isLoading || !deckQuery.data) {
    return (
      <div className="space-y-6">
        <title>Study flashcards - Prepify</title>
        <div className="h-40 animate-pulse rounded-3xl border border-border/70 bg-muted/40" />
        <div className="h-80 animate-pulse rounded-3xl border border-border/70 bg-muted/40" />
      </div>
    );
  }

  if (!currentCard) {
    if (studyMode === "all" && (deckQuery.data.flashcards?.length ?? 0) > 0) {
      return (
        <div className="space-y-6">
          <title>Study flashcards - Prepify</title>
          <Card className="rounded-3xl border border-border/70 shadow-sm">
            <CardContent className="space-y-4 p-10 text-center">
              <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  strokeWidth={1.8}
                  className="size-7"
                />
              </div>
              <div>
                <p className="text-2xl font-semibold">Deck review complete</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  You reached the end of the deck. You can run through it again
                  from the first card whenever you want.
                </p>
              </div>
              <div className="flex justify-center gap-3">
                <Button
                  onClick={() => {
                    setCurrentIndex(0);
                    setRevealed(false);
                  }}
                >
                  Go through deck again
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    navigate({ to: "/flashcards/$deckId", params: { deckId } })
                  }
                >
                  <HugeiconsIcon
                    icon={ArrowLeft01Icon}
                    strokeWidth={2}
                    className="size-4"
                  />
                  Back to deck
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <title>Study flashcards - Prepify</title>
        <Card className="rounded-3xl border border-border/70 shadow-sm">
          <CardContent className="space-y-4 p-10 text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
              <HugeiconsIcon
                icon={CheckmarkCircle02Icon}
                strokeWidth={1.8}
                className="size-7"
              />
            </div>
            <div>
              <p className="text-2xl font-semibold">No cards due right now</p>
              <p className="mt-2 text-sm text-muted-foreground">
                You&apos;re caught up on this deck for now.
              </p>
            </div>
            <div className="flex justify-center gap-3">
              {deckQuery.data.flashcards.length > 0 ? (
                <Button
                  onClick={() => {
                    setStudyMode("all");
                    setCurrentIndex(0);
                    setRevealed(false);
                  }}
                >
                  Go through deck again
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => navigate({ to: "/flashcards/$deckId", params: { deckId } })}>
                <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} className="size-4" />
                Back to deck
              </Button>
              <Button onClick={() => navigate({ to: "/flashcards" })}>
                All decks
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <title>Study {deckQuery.data.title} - Prepify</title>

      <section className="rounded-3xl border border-border/70 bg-gradient-to-br from-slate-50 via-background to-sky-50/30 p-6 shadow-sm dark:from-slate-950 dark:via-background dark:to-sky-950/10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Badge className="rounded-full border border-primary/20 bg-primary/10 text-primary">
              Study session
            </Badge>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight">
              {deckQuery.data.title}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Card {currentIndex + 1} of {studyCards.length}{" "}
              {studyMode === "all" ? "in full deck review" : "due now"}
            </p>
          </div>
          <Button variant="outline" onClick={() => navigate({ to: "/flashcards/$deckId", params: { deckId } })}>
            <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} className="size-4" />
            Back to deck
          </Button>
        </div>
      </section>

      <Card className="rounded-[2rem] border border-border/70 shadow-sm">
        <CardHeader className="border-b border-border/60">
          <CardTitle className="text-2xl font-semibold">Front</CardTitle>
          <CardDescription>
            Try to answer before revealing the back.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 p-8">
          <div className="rounded-3xl border border-border/70 bg-background/80 p-8">
            <p className="text-xl leading-8">{currentCard.front}</p>
          </div>

          {revealed ? (
            <div className="rounded-3xl border border-border/70 bg-muted/30 p-8">
              <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
                Back
              </p>
              <p className="mt-3 text-base leading-8">{currentCard.back}</p>
            </div>
          ) : (
            <Button onClick={() => setRevealed(true)}>
              <HugeiconsIcon icon={ViewIcon} strokeWidth={2} className="size-4" />
              Reveal answer
            </Button>
          )}

          {revealed ? (
            <div className="flex flex-wrap gap-3">
              {ratingOptions.map((option) => (
                <Button
                  key={option.id}
                  variant={option.id === "good" ? "default" : "outline"}
                  onClick={() => reviewMutation.mutate(option.id)}
                  disabled={reviewMutation.isPending}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export default FlashcardStudyPage;
