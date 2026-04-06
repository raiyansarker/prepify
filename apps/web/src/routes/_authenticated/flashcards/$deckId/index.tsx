import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  RefreshIcon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";
import { api } from "#/lib/api";
import type { Flashcard, FlashcardDeck, FlashcardDeckStatus } from "@repo/shared";

export const Route = createFileRoute("/_authenticated/flashcards/$deckId/")({
  component: FlashcardDeckPage,
});

type DeckDetail = FlashcardDeck & {
  dueCount: number;
  documents: { id: string; name: string; status: string }[];
  flashcards: Flashcard[];
};

const statusCopy: Record<FlashcardDeckStatus, { label: string; className: string }> = {
  generating: {
    label: "Generating",
    className:
      "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/40 dark:bg-amber-500/10 dark:text-amber-100",
  },
  ready: {
    label: "Ready",
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-500/10 dark:text-emerald-100",
  },
  failed: {
    label: "Failed",
    className:
      "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/40 dark:bg-rose-500/10 dark:text-rose-100",
  },
};

function FlashcardDeckPage() {
  const { deckId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const deckQuery = useQuery({
    queryKey: ["flashcard-deck", deckId],
    queryFn: async () => {
      const res = await api.flashcards({ deckId }).get();
      if (res.data?.success) {
        return res.data.data as DeckDetail;
      }
      throw new Error((res.data as { error?: string } | undefined)?.error || "Failed to load deck");
    },
    refetchInterval: (query) =>
      (query.state.data as DeckDetail | undefined)?.status === "generating" ? 3000 : false,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await api.flashcards({ deckId }).delete();
      if (!(res.data && "success" in res.data && res.data.success)) {
        throw new Error(
          (res.data as { error?: string } | undefined)?.error || "Failed to delete deck",
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flashcard-decks"] });
      navigate({ to: "/flashcards" });
    },
  });

  const deck = deckQuery.data;

  if (deckQuery.isLoading || !deck) {
    return (
      <div className="space-y-6">
        <title>Flashcard deck - Prepify</title>
        <div className="h-40 animate-pulse rounded-3xl border border-border/70 bg-muted/40" />
        <div className="h-72 animate-pulse rounded-3xl border border-border/70 bg-muted/40" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <title>{deck.title} - Prepify</title>

      <section className="rounded-3xl border border-border/70 bg-gradient-to-br from-slate-50 via-background to-emerald-50/30 p-6 shadow-sm dark:from-slate-950 dark:via-background dark:to-emerald-950/10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Badge className={statusCopy[deck.status].className}>
              {statusCopy[deck.status].label}
            </Badge>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight">{deck.title}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{deck.topic}</p>
            {deck.description ? (
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                {deck.description}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate({ to: "/flashcards" })}>
              <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} className="size-4" />
              Back
            </Button>
            <Button variant="outline" onClick={() => deckQuery.refetch()}>
              <HugeiconsIcon
                icon={RefreshIcon}
                strokeWidth={2}
                className={`size-4 ${deckQuery.isFetching ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
            <Button
              variant="outline"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              Delete deck
            </Button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <MetaCard label="Cards" value={String(deck.cardCount)} />
        <MetaCard label="Due now" value={String(deck.dueCount)} />
        <MetaCard label="Documents" value={String(deck.documents.length)} />
      </div>

      {deck.status === "generating" ? (
        <Card className="rounded-3xl border border-border/70 shadow-sm">
          <CardContent className="space-y-4 p-8">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <HugeiconsIcon icon={SparklesIcon} strokeWidth={1.8} className="size-7" />
            </div>
            <div>
              <p className="text-xl font-semibold">Generating flashcards</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Prepify is reading your selected documents and building a deck. This page refreshes
                automatically until the cards are ready.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {deck.status === "failed" ? (
        <Card className="rounded-3xl border border-rose-200 bg-rose-50/60 shadow-sm dark:border-rose-900/40 dark:bg-rose-500/10">
          <CardContent className="space-y-3 p-8">
            <p className="text-xl font-semibold">Generation failed</p>
            <p className="text-sm leading-6 text-muted-foreground">
              {deck.errorMessage || "Flashcard generation did not complete successfully."}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <Card className="rounded-3xl border border-border/70 shadow-sm">
          <CardHeader className="border-b border-border/60">
            <CardTitle>Source documents</CardTitle>
            <CardDescription>The documents used to build this deck.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-6">
            {deck.documents.map((document) => (
              <div
                key={document.id}
                className="rounded-2xl border border-border/60 bg-muted/30 p-4"
              >
                <p className="font-medium">{document.name}</p>
                <p className="mt-1 text-sm text-muted-foreground capitalize">{document.status}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-3xl border border-border/70 shadow-sm">
          <CardHeader className="border-b border-border/60">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Cards</CardTitle>
                <CardDescription>
                  Browse the generated deck or start a study session.
                </CardDescription>
              </div>
              {deck.status === "ready" ? (
                <Button asChild>
                  <Link to="/flashcards/$deckId/study" params={{ deckId }}>
                    Study deck
                  </Link>
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {deck.flashcards.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/70 p-6 text-sm text-muted-foreground">
                No flashcards available yet.
              </div>
            ) : (
              deck.flashcards.map((card) => (
                <article
                  key={card.id}
                  className="rounded-2xl border border-border/70 bg-background/80 p-4"
                >
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Front</p>
                  <p className="mt-2 text-sm leading-6">{card.front}</p>
                  <p className="mt-4 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Back
                  </p>
                  <p className="mt-2 text-sm leading-6">{card.back}</p>
                </article>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="rounded-3xl border border-border/70 shadow-sm">
      <CardContent className="space-y-2 p-5">
        <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">{label}</p>
        <p className="text-3xl font-semibold tracking-tight">{value}</p>
      </CardContent>
    </Card>
  );
}

export default FlashcardDeckPage;
