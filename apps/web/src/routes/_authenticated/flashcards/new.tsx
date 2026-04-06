import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
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
import { Input } from "#/components/ui/input";
import { Textarea } from "#/components/ui/textarea";
import { api } from "#/lib/api";

export const Route = createFileRoute("/_authenticated/flashcards/new")({
  component: NewFlashcardDeckPage,
});

type DocumentItem = {
  id: string;
  name: string;
  status: "pending" | "processing" | "ready" | "failed";
};

function NewFlashcardDeckPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [description, setDescription] = useState("");
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);

  const documentsQuery = useQuery({
    queryKey: ["documents"],
    queryFn: async () => {
      const res = await api.documents.get();
      if (res.data?.success) {
        return res.data.data as DocumentItem[];
      }
      throw new Error(
        (res.data as { error?: string } | undefined)?.error ||
          "Failed to load documents",
      );
    },
  });

  const readyDocuments = useMemo(
    () => (documentsQuery.data ?? []).filter((document) => document.status === "ready"),
    [documentsQuery.data],
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await api.flashcards.post({
        title,
        topic,
        description: description.trim() || undefined,
        documentIds: selectedDocumentIds,
      });

      if (res.data?.success) {
        return res.data.data as { id: string };
      }

      throw new Error(
        (res.data as { error?: string } | undefined)?.error ||
          "Failed to create deck",
      );
    },
    onSuccess: (deck) => {
      navigate({ to: "/flashcards/$deckId", params: { deckId: deck.id } });
    },
  });

  const canSubmit =
    title.trim().length > 0 &&
    topic.trim().length > 0 &&
    selectedDocumentIds.length > 0;

  return (
    <div className="space-y-6">
      <title>New flashcard deck - Prepify</title>

      <section className="rounded-3xl border border-border/70 bg-gradient-to-br from-slate-50 via-background to-sky-50/30 p-6 shadow-sm dark:from-slate-950 dark:via-background dark:to-sky-950/10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Badge className="rounded-full border border-primary/20 bg-primary/10 text-primary">
              New deck
            </Badge>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight">
              Create flashcard deck
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Select processed documents and Prepify will generate a study-ready
              deck for you.
            </p>
          </div>
          <Button variant="outline" onClick={() => navigate({ to: "/flashcards" })}>
            <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} className="size-4" />
            Back
          </Button>
        </div>
      </section>

      <Card className="rounded-3xl border border-border/70 shadow-sm">
        <CardHeader className="border-b border-border/60">
          <CardTitle>Deck details</CardTitle>
          <CardDescription>
            These fields define the generated card set and its source material.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          <div className="space-y-2">
            <label className="text-sm font-medium">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Topic</label>
            <Input value={topic} onChange={(e) => setTopic(e.target.value)} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional context for your own reference"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border border-border/70 shadow-sm">
        <CardHeader className="border-b border-border/60">
          <CardTitle>Source documents</CardTitle>
          <CardDescription>
            Only ready documents can be used for flashcard generation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pt-6">
          {documentsQuery.isLoading ? (
            <div className="h-32 animate-pulse rounded-2xl bg-muted/40" />
          ) : readyDocuments.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 p-6 text-sm text-muted-foreground">
              No processed documents are ready yet.
            </div>
          ) : (
            readyDocuments.map((document) => {
              const selected = selectedDocumentIds.includes(document.id);
              return (
                <button
                  key={document.id}
                  type="button"
                  onClick={() =>
                    setSelectedDocumentIds((prev) =>
                      selected
                        ? prev.filter((id) => id !== document.id)
                        : [...prev, document.id],
                    )
                  }
                  className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                    selected
                      ? "border-primary bg-primary/5"
                      : "border-border/70 hover:bg-muted/30"
                  }`}
                >
                  <p className="font-medium">{document.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Ready for AI generation
                  </p>
                </button>
              );
            })
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button
          onClick={() => createMutation.mutate()}
          disabled={!canSubmit || createMutation.isPending}
        >
          <HugeiconsIcon icon={SparklesIcon} strokeWidth={2} className="size-4" />
          {createMutation.isPending ? "Creating..." : "Generate deck"}
        </Button>
        {createMutation.error instanceof Error ? (
          <p className="self-center text-sm text-destructive">
            {createMutation.error.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default NewFlashcardDeckPage;
