import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/chat")({
  component: ChatPage,
});

function ChatPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">AI Chat</h1>
        <p className="text-muted-foreground">
          Chat with AI using your study materials as context.
        </p>
      </div>

      <div className="flex min-h-[400px] flex-col items-center justify-center rounded-lg border border-dashed border-border p-8">
        <p className="text-lg font-medium text-muted-foreground">
          Start a conversation
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask questions about your study materials or any topic.
        </p>
      </div>
    </div>
  );
}
