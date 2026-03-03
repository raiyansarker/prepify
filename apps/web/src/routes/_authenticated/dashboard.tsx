import { createFileRoute } from "@tanstack/react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FolderOpenIcon,
  NoteEditIcon,
  ChatBotIcon,
  FlashIcon,
} from "@hugeicons/core-free-icons";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
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
            value="0"
            description="Uploaded files"
          />
          <StatCard
            icon={NoteEditIcon}
            title="Exams"
            value="0"
            description="Exams taken"
          />
          <StatCard
            icon={ChatBotIcon}
            title="Conversations"
            value="0"
            description="Chat sessions"
          />
          <StatCard
            icon={FlashIcon}
            title="Flashcards"
            value="0"
            description="Cards reviewed"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Recent Exams</CardTitle>
              <CardDescription>Your latest exam results</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                No exams taken yet. Create your first exam to get started.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Upcoming Reviews</CardTitle>
              <CardDescription>Flashcards due for review</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                No flashcard reviews scheduled. Create a deck to begin studying.
              </p>
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
