import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/documents")({
  component: DocumentsPage,
});

function DocumentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Documents</h1>
        <p className="text-muted-foreground">
          Upload and manage your study materials.
        </p>
      </div>

      <div className="flex min-h-[400px] flex-col items-center justify-center rounded-lg border border-dashed border-border p-8">
        <p className="text-lg font-medium text-muted-foreground">
          No documents yet
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload PDFs, images, or text files to get started.
        </p>
      </div>
    </div>
  );
}
