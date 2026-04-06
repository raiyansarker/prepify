import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card";
import { Badge } from "#/components/ui/badge";
import { api } from "#/lib/api";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FolderOpenIcon,
  NoteEditIcon,
  ChatBotIcon,
  FlashIcon,
} from "@hugeicons/core-free-icons";
import type { ExamStatus, Flashcard, FlashcardDeck } from "@repo/shared";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

type Document = {
  id: string;
  status: "pending" | "processing" | "ready" | "failed";
};

type Exam = {
  id: string;
  title: string;
  topic: string;
  status: ExamStatus;
  createdAt: string;
};

type Conversation = {
  id: string;
};

type DeckListItem = FlashcardDeck & {
  dueCount: number;
  documents: { id: string; name: string; status: string }[];
  flashcards?: Flashcard[];
};

const examStatusCopy: Record<ExamStatus, string> = {
  draft: "Draft",
  generating: "Generating",
  active: "Ready",
  completed: "Completed",
  failed: "Failed",
};

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function DashboardPage() {
  const { data: documents = [] } = useQuery({
    queryKey: ["dashboard", "documents"],
    queryFn: async () => {
      const res = await api.documents.get();
      if (res.data?.success) {
        return (res.data as { success: true; data: Document[] }).data;
      }
      return [] as Document[];
    },
  });

  const { data: exams = [] } = useQuery({
    queryKey: ["dashboard", "exams"],
    queryFn: async () => {
      const res = await api.exams.get();
      if (res.data?.success) {
        return (res.data as { success: true; data: Exam[] }).data;
      }
      return [] as Exam[];
    },
    refetchInterval: (query) => {
      const data = (query.state.data as Exam[] | undefined) ?? [];
      return data.some((exam) => exam.status === "generating") ? 3000 : false;
    },
  });

  const { data: conversations = [] } = useQuery({
    queryKey: ["dashboard", "conversations"],
    queryFn: async () => {
      const res = await api.chat.conversations.get();
      if (res.data?.success) {
        return (res.data as { success: true; data: Conversation[] }).data;
      }
      return [] as Conversation[];
    },
  });

  const { data: decks = [] } = useQuery({
    queryKey: ["dashboard", "flashcard-decks"],
    queryFn: async () => {
      const res = await api.flashcards.get();
      if (res.data?.success) {
        return res.data.data as DeckListItem[];
      }
      return [] as DeckListItem[];
    },
    refetchInterval: (query) => {
      const data = (query.state.data as DeckListItem[] | undefined) ?? [];
      return data.some((deck) => deck.status === "generating") ? 3000 : false;
    },
  });

  const documentCount = documents.length;
  const examCount = exams.length;
  const conversationCount = conversations.length;
  const flashcardCount = decks.reduce((sum, deck) => sum + deck.cardCount, 0);

  const recentExams = [...exams]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, 3);

  const dueDecks = decks
    .filter((deck) => deck.dueCount > 0)
    .sort((a, b) => b.dueCount - a.dueCount)
    .slice(0, 3);

  return (
    <>
      <title>Dashboard - Prepify</title>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Welcome back! Here&apos;s an overview of your study progress.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={FolderOpenIcon}
            title="Documents"
            value={String(documentCount)}
            description="Uploaded files"
          />
          <StatCard
            icon={NoteEditIcon}
            title="Exams"
            value={String(examCount)}
            description="Created exams"
          />
          <StatCard
            icon={ChatBotIcon}
            title="Conversations"
            value={String(conversationCount)}
            description="Saved chats"
          />
          <StatCard
            icon={FlashIcon}
            title="Flashcards"
            value={String(flashcardCount)}
            description="Cards available to study"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Recent Exams</CardTitle>
              <CardDescription>Your latest exam results</CardDescription>
            </CardHeader>
            <CardContent>
              {recentExams.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No exams yet. <Link to="/exams" className="text-primary underline">Create your first exam</Link>.
                </p>
              ) : (
                <div className="space-y-3">
                  {recentExams.map((exam) => (
                    <div
                      key={exam.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border/60 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <Link
                          to="/exams/$examId"
                          params={{ examId: exam.id }}
                          className="line-clamp-1 text-sm font-medium hover:text-primary"
                        >
                          {exam.title}
                        </Link>
                        <p className="line-clamp-1 text-xs text-muted-foreground">
                          {exam.topic} • {formatDate(exam.createdAt)}
                        </p>
                      </div>
                      <Badge variant="secondary">{examStatusCopy[exam.status]}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Upcoming Reviews</CardTitle>
              <CardDescription>Flashcards due for review</CardDescription>
            </CardHeader>
            <CardContent>
              {dueDecks.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No cards are due right now. <Link to="/flashcards" className="text-primary underline">Open your decks</Link>.
                </p>
              ) : (
                <div className="space-y-3">
                  {dueDecks.map((deck) => (
                    <div
                      key={deck.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border/60 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <Link
                          to="/flashcards/$deckId"
                          params={{ deckId: deck.id }}
                          className="line-clamp-1 text-sm font-medium hover:text-primary"
                        >
                          {deck.title}
                        </Link>
                        <p className="line-clamp-1 text-xs text-muted-foreground">
                          {deck.topic}
                        </p>
                      </div>
                      <Badge variant="secondary">{deck.dueCount} due</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function StatCard({
  icon,
  title,
  value,
  description,
}: {
  icon: any;
  title: string;
  value: string;
  description: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <HugeiconsIcon
          icon={icon}
          strokeWidth={2}
          className="size-4 text-muted-foreground"
        />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
