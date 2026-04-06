import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  ArrowRight01Icon,
  Delete02Icon,
  RefreshIcon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";
import { api } from "#/lib/api";
import type { Flashcard, FlashcardDeck, FlashcardDeckStatus } from "@repo/shared";

export const Route = createFileRoute("/_authenticated/flashcards/")({
  component: FlashcardsIndexPage,
});

type DeckListItem = FlashcardDeck & {
  dueCount: number;
  documents: { id: string; name: string; status: string }[];
  flashcards?: Flashcard[];
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

function FlashcardsIndexPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const decksQuery = useQuery({
    queryKey: ["flashcard-decks"],
    queryFn: async () => {
      const res = await api.flashcards.get();
      if (res.data?.success) {
        return res.data.data as DeckListItem[];
      }
      throw new Error(
        (res.data as { error?: string } | undefined)?.error || "Failed to load flashcard decks",
      );
    },
    refetchInterval: (query) => {
      const decks = (query.state.data as DeckListItem[] | undefined) ?? [];
      return decks.some((deck) => deck.status === "generating") ? 3000 : false;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (deckId: string) => {
      const res = await api.flashcards({ deckId }).delete();
      if (!(res.data && "success" in res.data && res.data.success)) {
        throw new Error(
          (res.data as { error?: string } | undefined)?.error || "Failed to delete deck",
        );
      }
      return deckId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flashcard-decks"] });
    },
  });

  const decks = decksQuery.data ?? [];
  const stats = {
    totalDecks: decks.length,
    totalCards: decks.reduce((sum, deck) => sum + deck.cardCount, 0),
    dueCards: decks.reduce((sum, deck) => sum + deck.dueCount, 0),
  };

  return (
    <div className="space-y-6">
      <title>Flashcards - Prepify</title>

      <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-br from-slate-50 via-background to-amber-50/40 p-6 shadow-sm dark:from-slate-950 dark:via-background dark:to-amber-950/10">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-amber-300 to-sky-300 opacity-80" />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Badge className="rounded-full border border-primary/20 bg-primary/10 text-primary">
              Study system
            </Badge>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight">Flashcard decks</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Generate AI flashcards from your uploaded documents and review them with spaced
              repetition.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => decksQuery.refetch()}>
              <HugeiconsIcon
                icon={RefreshIcon}
                strokeWidth={2}
                className={`size-4 ${decksQuery.isFetching ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
            <Button onClick={() => navigate({ to: "/flashcards/new" })}>
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-4" />
              New deck
            </Button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Decks" value={String(stats.totalDecks)} />
        <StatCard label="Cards" value={String(stats.totalCards)} />
        <StatCard label="Due now" value={String(stats.dueCards)} />
      </div>

      {decksQuery.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div
              key={idx}
              className="h-56 animate-pulse rounded-3xl border border-border/70 bg-muted/40"
            />
          ))}
        </div>
      ) : decks.length === 0 ? (
        <Card className="rounded-3xl border border-dashed border-border/70 bg-card/60 py-12 text-center shadow-sm">
          <CardContent className="space-y-4">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <HugeiconsIcon icon={SparklesIcon} strokeWidth={1.8} className="size-7" />
            </div>
            <div>
              <p className="text-lg font-semibold">No flashcard decks yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Create your first deck from uploaded documents to start studying.
              </p>
            </div>
            <div className="flex justify-center">
              <Button onClick={() => navigate({ to: "/flashcards/new" })}>
                <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-4" />
                Create first deck
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {decks.map((deck) => (
            <Card key={deck.id} className="rounded-3xl border border-border/70 shadow-sm">
              <CardHeader className="border-b border-border/60">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <Badge className={statusCopy[deck.status].className}>
                      {statusCopy[deck.status].label}
                    </Badge>
                    <CardTitle className="text-xl font-semibold tracking-tight">
                      {deck.title}
                    </CardTitle>
                    <CardDescription className="text-sm leading-6">{deck.topic}</CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => deleteMutation.mutate(deck.id)}
                    disabled={deleteMutation.isPending}
                  >
                    <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-5 pt-6">
                <div className="grid grid-cols-3 gap-3">
                  <MetaCard label="Cards" value={String(deck.cardCount)} />
                  <MetaCard label="Due" value={String(deck.dueCount)} />
                  <MetaCard label="Docs" value={String(deck.documents.length)} />
                </div>

                {deck.status === "failed" && deck.errorMessage ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50/80 p-4 text-sm leading-6 text-rose-700 dark:border-rose-900/50 dark:bg-rose-500/10 dark:text-rose-100">
                    {deck.errorMessage}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <Button asChild>
                    <Link to="/flashcards/$deckId" params={{ deckId: deck.id }}>
                      Open deck
                    </Link>
                  </Button>
                  {deck.status === "ready" ? (
                    <Button asChild variant="outline">
                      <Link to="/flashcards/$deckId/study" params={{ deckId: deck.id }}>
                        Study now
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="rounded-3xl border border-border/70 shadow-sm">
      <CardContent className="space-y-2 p-5">
        <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">{label}</p>
        <p className="text-3xl font-semibold tracking-tight">{value}</p>
      </CardContent>
    </Card>
  );
}

function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-muted/30 p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-semibold">{value}</p>
    </div>
  );
}

export default FlashcardsIndexPage;
