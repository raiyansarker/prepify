import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FolderOpenIcon,
  File01Icon,
  CloudUploadIcon,
  FolderAddIcon,
  Delete02Icon,
  PencilEdit02Icon,
  MoreVerticalIcon,
  ArrowLeft01Icon,
  GridViewIcon,
  Menu01Icon,
  FileAttachmentIcon,
  ImageUploadIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "#/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { Input } from "#/components/ui/input";
import { cn } from "#/lib/utils";
import { api } from "#/lib/api";
import { UploadDialog } from "#/components/documents/upload-dialog";
import { CreateFolderDialog } from "#/components/documents/create-folder-dialog";

export const Route = createFileRoute("/_authenticated/documents")({
  component: DocumentsPage,
});

type Folder = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
};

type Document = {
  id: string;
  name: string;
  type: "pdf" | "image" | "text";
  mimeType: string | null;
  fileSize: number | null;
  status: "pending" | "processing" | "ready" | "failed";
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
};

function DocumentsPage() {
  // Navigation state
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState<
    { id: string | null; name: string }[]
  >([{ id: null, name: "Documents" }]);

  const queryClient = useQueryClient();

  // Data queries
  const { data: folders = [], isLoading: foldersLoading } = useQuery({
    queryKey: ["folders", currentFolderId],
    queryFn: async () => {
      const res = await api.folders.get({
        query: currentFolderId ? { parentId: currentFolderId } : {},
      });
      if (res.data?.success) {
        return (res.data as { success: true; data: Folder[] }).data;
      }
      return [];
    },
  });

  const { data: documents = [], isLoading: documentsLoading } = useQuery({
    queryKey: ["documents", currentFolderId],
    queryFn: async () => {
      const res = await api.documents.get({
        query: currentFolderId
          ? { folderId: currentFolderId }
          : { folderId: "root" },
      });
      if (res.data?.success) {
        return (res.data as { success: true; data: Document[] }).data;
      }
      return [];
    },
  });

  const isLoading = foldersLoading || documentsLoading;

  // View state
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // Dialog state
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    type: "folder" | "document";
    id: string;
    name: string;
  } | null>(null);
  const [renameTarget, setRenameTarget] = useState<{
    type: "folder" | "document";
    id: string;
    name: string;
  } | null>(null);
  const [renameName, setRenameName] = useState("");

  // Navigation
  const navigateToFolder = useCallback(
    (folderId: string, folderName: string) => {
      setCurrentFolderId(folderId);
      setFolderPath((prev) => [...prev, { id: folderId, name: folderName }]);
    },
    [],
  );

  const navigateToPathIndex = useCallback(
    (index: number) => {
      const target = folderPath[index];
      if (target) {
        setCurrentFolderId(target.id);
        setFolderPath((prev) => prev.slice(0, index + 1));
      }
    },
    [folderPath],
  );

  const navigateBack = useCallback(() => {
    if (folderPath.length > 1) {
      navigateToPathIndex(folderPath.length - 2);
    }
  }, [folderPath, navigateToPathIndex]);

  const invalidateFileData = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["folders", currentFolderId] });
    queryClient.invalidateQueries({ queryKey: ["documents", currentFolderId] });
  }, [queryClient, currentFolderId]);

  // Mutations
  const deleteMutation = useMutation({
    mutationFn: async (target: { type: "folder" | "document"; id: string }) => {
      if (target.type === "folder") {
        await api.folders({ id: target.id }).delete();
      } else {
        await api.documents({ id: target.id }).delete();
      }
    },
    onSuccess: () => {
      setDeleteTarget(null);
      invalidateFileData();
    },
  });

  const renameMutation = useMutation({
    mutationFn: async (target: {
      type: "folder" | "document";
      id: string;
      name: string;
    }) => {
      if (target.type === "folder") {
        await api.folders({ id: target.id }).patch({ name: target.name });
      } else {
        await api.documents({ id: target.id }).patch({ name: target.name });
      }
    },
    onSuccess: () => {
      setRenameTarget(null);
      setRenameName("");
      invalidateFileData();
    },
  });

  const handleDelete = useCallback(() => {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget);
  }, [deleteTarget, deleteMutation]);

  const handleRename = useCallback(() => {
    if (!renameTarget || !renameName.trim()) return;
    renameMutation.mutate({
      type: renameTarget.type,
      id: renameTarget.id,
      name: renameName.trim(),
    });
  }, [renameTarget, renameName, renameMutation]);

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "-";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const getStatusBadge = (status: Document["status"]) => {
    switch (status) {
      case "ready":
        return (
          <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600">
            Ready
          </span>
        );
      case "processing":
        return (
          <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600">
            Processing
          </span>
        );
      case "pending":
        return (
          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            Pending
          </span>
        );
      case "failed":
        return (
          <span className="inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
            Failed
          </span>
        );
    }
  };

  const getDocumentIcon = (type: Document["type"]) => {
    switch (type) {
      case "pdf":
        return FileAttachmentIcon;
      case "image":
        return ImageUploadIcon;
      default:
        return File01Icon;
    }
  };

  const isEmpty = folders.length === 0 && documents.length === 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Documents</h1>
          <p className="text-muted-foreground">
            Upload and manage your study materials.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCreateFolderDialogOpen(true)}
          >
            <HugeiconsIcon
              icon={FolderAddIcon}
              strokeWidth={2}
              data-icon="inline-start"
            />
            New Folder
          </Button>
          <Button size="sm" onClick={() => setUploadDialogOpen(true)}>
            <HugeiconsIcon
              icon={CloudUploadIcon}
              strokeWidth={2}
              data-icon="inline-start"
            />
            Upload
          </Button>
        </div>
      </div>

      {/* Breadcrumb & View Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 text-sm">
          {folderPath.length > 1 && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={navigateBack}
              className="mr-1"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
            </Button>
          )}
          {folderPath.map((item, index) => (
            <span key={item.id ?? "root"} className="flex items-center">
              {index > 0 && (
                <span className="mx-1 text-muted-foreground">/</span>
              )}
              <button
                onClick={() => navigateToPathIndex(index)}
                className={cn(
                  "rounded px-1.5 py-0.5 hover:bg-muted",
                  index === folderPath.length - 1
                    ? "font-medium text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {item.name}
              </button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant={viewMode === "grid" ? "secondary" : "ghost"}
            size="icon-xs"
            onClick={() => setViewMode("grid")}
          >
            <HugeiconsIcon icon={GridViewIcon} strokeWidth={2} />
          </Button>
          <Button
            variant={viewMode === "list" ? "secondary" : "ghost"}
            size="icon-xs"
            onClick={() => setViewMode("list")}
          >
            <HugeiconsIcon icon={Menu01Icon} strokeWidth={2} />
          </Button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex min-h-[400px] items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      ) : isEmpty ? (
        <div className="flex min-h-[400px] flex-col items-center justify-center rounded-lg border border-dashed border-border p-8">
          <HugeiconsIcon
            icon={FolderOpenIcon}
            strokeWidth={1.5}
            className="mb-3 size-12 text-muted-foreground/50"
          />
          <p className="text-lg font-medium text-muted-foreground">
            {currentFolderId ? "This folder is empty" : "No documents yet"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload PDFs, images, or text files to get started.
          </p>
          <div className="mt-4 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCreateFolderDialogOpen(true)}
            >
              <HugeiconsIcon
                icon={FolderAddIcon}
                strokeWidth={2}
                data-icon="inline-start"
              />
              New Folder
            </Button>
            <Button size="sm" onClick={() => setUploadDialogOpen(true)}>
              <HugeiconsIcon
                icon={CloudUploadIcon}
                strokeWidth={2}
                data-icon="inline-start"
              />
              Upload Files
            </Button>
          </div>
        </div>
      ) : viewMode === "grid" ? (
        /* Grid View */
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {/* Folders */}
          {folders.map((folder) => (
            <div
              key={folder.id}
              className="group relative flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-border p-4 transition-colors hover:bg-muted/50"
              onDoubleClick={() => navigateToFolder(folder.id, folder.name)}
            >
              <HugeiconsIcon
                icon={FolderOpenIcon}
                strokeWidth={1.5}
                className="size-10 text-primary"
              />
              <p className="w-full truncate text-center text-sm font-medium">
                {folder.name}
              </p>
              <div className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100">
                <ItemContextMenu
                  onRename={() => {
                    setRenameTarget({
                      type: "folder",
                      id: folder.id,
                      name: folder.name,
                    });
                    setRenameName(folder.name);
                  }}
                  onDelete={() =>
                    setDeleteTarget({
                      type: "folder",
                      id: folder.id,
                      name: folder.name,
                    })
                  }
                />
              </div>
            </div>
          ))}
          {/* Documents */}
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="group relative flex flex-col items-center gap-2 rounded-lg border border-border p-4 transition-colors hover:bg-muted/50"
            >
              <HugeiconsIcon
                icon={getDocumentIcon(doc.type)}
                strokeWidth={1.5}
                className="size-10 text-muted-foreground"
              />
              <p className="w-full truncate text-center text-sm font-medium">
                {doc.name}
              </p>
              <div className="flex items-center gap-2">
                {getStatusBadge(doc.status)}
              </div>
              <div className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100">
                <ItemContextMenu
                  onRename={() => {
                    setRenameTarget({
                      type: "document",
                      id: doc.id,
                      name: doc.name,
                    });
                    setRenameName(doc.name);
                  }}
                  onDelete={() =>
                    setDeleteTarget({
                      type: "document",
                      id: doc.id,
                      name: doc.name,
                    })
                  }
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* List View */
        <div className="rounded-lg border border-border">
          <div className="grid grid-cols-[1fr_100px_100px_80px_40px] gap-2 border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground">
            <span>Name</span>
            <span>Type</span>
            <span>Size</span>
            <span>Status</span>
            <span />
          </div>
          {/* Folders */}
          {folders.map((folder) => (
            <div
              key={folder.id}
              className="group grid cursor-pointer grid-cols-[1fr_100px_100px_80px_40px] items-center gap-2 border-b border-border px-4 py-2.5 last:border-0 hover:bg-muted/50"
              onDoubleClick={() => navigateToFolder(folder.id, folder.name)}
            >
              <div className="flex items-center gap-2.5">
                <HugeiconsIcon
                  icon={FolderOpenIcon}
                  strokeWidth={2}
                  className="size-4 shrink-0 text-primary"
                />
                <span className="truncate text-sm font-medium">
                  {folder.name}
                </span>
              </div>
              <span className="text-sm text-muted-foreground">Folder</span>
              <span className="text-sm text-muted-foreground">-</span>
              <span />
              <ItemContextMenu
                onRename={() => {
                  setRenameTarget({
                    type: "folder",
                    id: folder.id,
                    name: folder.name,
                  });
                  setRenameName(folder.name);
                }}
                onDelete={() =>
                  setDeleteTarget({
                    type: "folder",
                    id: folder.id,
                    name: folder.name,
                  })
                }
              />
            </div>
          ))}
          {/* Documents */}
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="group grid grid-cols-[1fr_100px_100px_80px_40px] items-center gap-2 border-b border-border px-4 py-2.5 last:border-0 hover:bg-muted/50"
            >
              <div className="flex items-center gap-2.5">
                <HugeiconsIcon
                  icon={getDocumentIcon(doc.type)}
                  strokeWidth={2}
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <span className="truncate text-sm font-medium">{doc.name}</span>
              </div>
              <span className="text-sm capitalize text-muted-foreground">
                {doc.type}
              </span>
              <span className="text-sm text-muted-foreground">
                {formatFileSize(doc.fileSize)}
              </span>
              {getStatusBadge(doc.status)}
              <ItemContextMenu
                onRename={() => {
                  setRenameTarget({
                    type: "document",
                    id: doc.id,
                    name: doc.name,
                  });
                  setRenameName(doc.name);
                }}
                onDelete={() =>
                  setDeleteTarget({
                    type: "document",
                    id: doc.id,
                    name: doc.name,
                  })
                }
              />
            </div>
          ))}
        </div>
      )}

      {/* Upload Dialog */}
      <UploadDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        folderId={currentFolderId}
        onUploadComplete={invalidateFileData}
      />

      {/* Create Folder Dialog */}
      <CreateFolderDialog
        open={createFolderDialogOpen}
        onOpenChange={setCreateFolderDialogOpen}
        parentId={currentFolderId}
        onFolderCreated={invalidateFileData}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleteTarget?.type === "folder" ? "Folder" : "Document"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteTarget?.name}"?
              {deleteTarget?.type === "folder" &&
                " Documents inside will be moved to the parent folder."}{" "}
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} variant="destructive">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rename Dialog */}
      <AlertDialog
        open={!!renameTarget}
        onOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null);
            setRenameName("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Rename {renameTarget?.type === "folder" ? "Folder" : "Document"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Enter a new name for "{renameTarget?.name}".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
            }}
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRename}
              disabled={!renameName.trim()}
            >
              Rename
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Context menu for folder/document items
function ItemContextMenu({
  onRename,
  onDelete,
}: {
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        onClick={(e) => e.stopPropagation()}
        className="flex size-6 items-center justify-center rounded-md hover:bg-muted"
      >
        <HugeiconsIcon
          icon={MoreVerticalIcon}
          strokeWidth={2}
          className="size-3.5"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4}>
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onRename();
          }}
        >
          <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} />
          Rename
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
