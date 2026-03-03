import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useCallback, useMemo, useEffect } from "react";
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
  Download04Icon,
  ViewIcon,
  Cancel01Icon,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { cn } from "#/lib/utils";
import { api } from "#/lib/api";
import { UploadDialog } from "#/components/documents/upload-dialog";
import { CreateFolderDialog } from "#/components/documents/create-folder-dialog";

export const Route = createFileRoute("/_authenticated/documents")({
  component: DocumentsPage,
  validateSearch: (search: Record<string, unknown>) => ({
    folderId: (search.folderId as string) || undefined,
  }),
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
  s3Key: string | null;
  s3Url: string | null;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
};

function DocumentsPage() {
  // URL-driven navigation state
  const { folderId: searchFolderId } = Route.useSearch();
  const navigate = useNavigate();
  const currentFolderId = searchFolderId ?? null;

  // Breadcrumb path - rebuilt from API when folderId changes
  const [folderPath, setFolderPath] = useState<
    { id: string | null; name: string }[]
  >([{ id: null, name: "Documents" }]);

  const queryClient = useQueryClient();

  // Fetch the folder ancestor path when navigating to a folder from URL
  const { data: ancestorPath } = useQuery({
    queryKey: ["folder-path", currentFolderId],
    queryFn: async () => {
      if (!currentFolderId) return [];
      const res = await api.folders.path({ id: currentFolderId }).get();
      if (res.data?.success) {
        return (
          res.data as { success: true; data: { id: string; name: string }[] }
        ).data;
      }
      return [];
    },
    enabled: !!currentFolderId,
    staleTime: 5 * 60 * 1000, // cache for 5 minutes
  });

  // Rebuild folderPath when ancestor data arrives or folderId changes
  useEffect(() => {
    if (!currentFolderId) {
      setFolderPath([{ id: null, name: "Documents" }]);
    } else if (ancestorPath && ancestorPath.length > 0) {
      setFolderPath([{ id: null, name: "Documents" }, ...ancestorPath]);
    }
  }, [currentFolderId, ancestorPath]);

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

  // Poll every 3 seconds when any document is still pending or processing
  const hasInProgressDocuments = useMemo(
    () =>
      documents.some(
        (doc) => doc.status === "pending" || doc.status === "processing",
      ),
    [documents],
  );

  // Polling query that only activates when documents are in-progress
  useQuery({
    queryKey: ["documents", currentFolderId, "poll"],
    queryFn: async () => {
      const res = await api.documents.get({
        query: currentFolderId
          ? { folderId: currentFolderId }
          : { folderId: "root" },
      });
      if (res.data?.success) {
        const freshData = (res.data as { success: true; data: Document[] })
          .data;
        // Update the main query cache with fresh data
        queryClient.setQueryData(["documents", currentFolderId], freshData);
        return freshData;
      }
      return [];
    },
    enabled: hasInProgressDocuments,
    refetchInterval: hasInProgressDocuments ? 3000 : false,
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
  const [previewDocument, setPreviewDocument] = useState<Document | null>(null);

  // Navigation
  const navigateToFolder = useCallback(
    (folderId: string, folderName: string) => {
      void navigate({
        to: "/documents",
        search: { folderId },
      });
      // Optimistically extend breadcrumb (will be reconciled by useEffect)
      setFolderPath((prev) => [...prev, { id: folderId, name: folderName }]);
    },
    [navigate],
  );

  const navigateToPathIndex = useCallback(
    (index: number) => {
      const target = folderPath[index];
      if (target) {
        void navigate({
          to: "/documents",
          search: { folderId: target.id ?? undefined },
        });
        setFolderPath((prev) => prev.slice(0, index + 1));
      }
    },
    [folderPath, navigate],
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
    onError: (err) => {
      console.error("Failed to delete item:", err);
      setDeleteTarget(null);
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
    onError: (err) => {
      console.error("Failed to rename item:", err);
      setRenameTarget(null);
      setRenameName("");
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

  const handleOpenPreview = useCallback((doc: Document) => {
    if (doc.s3Url) {
      setPreviewDocument(doc);
    }
  }, []);

  const handleDownload = useCallback((doc: Document) => {
    if (!doc.s3Url) return;
    const link = document.createElement("a");
    link.href = doc.s3Url;
    link.download = doc.name;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

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
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600 ring-1 ring-inset ring-emerald-500/20">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Ready
          </span>
        );
      case "processing":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-600 ring-1 ring-inset ring-amber-500/20">
            <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
            Processing
          </span>
        );
      case "pending":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground ring-1 ring-inset ring-border">
            <span className="size-1.5 rounded-full bg-muted-foreground/50" />
            Pending
          </span>
        );
      case "failed":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive ring-1 ring-inset ring-destructive/20">
            <span className="size-1.5 rounded-full bg-destructive" />
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

  const getDocumentIconColor = (type: Document["type"]) => {
    switch (type) {
      case "pdf":
        return "text-red-500";
      case "image":
        return "text-violet-500";
      default:
        return "text-blue-500";
    }
  };

  const getDocumentIconBg = (type: Document["type"]) => {
    switch (type) {
      case "pdf":
        return "bg-red-500/10";
      case "image":
        return "bg-violet-500/10";
      default:
        return "bg-blue-500/10";
    }
  };

  const isEmpty = folders.length === 0 && documents.length === 0;

  return (
    <>
      <title>Documents - Prepify</title>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Documents</h1>
            <p className="mt-1 text-sm text-muted-foreground">
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
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2">
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
                  <span className="mx-1 text-muted-foreground/50">/</span>
                )}
                <button
                  onClick={() => navigateToPathIndex(index)}
                  className={cn(
                    "rounded-md px-2 py-0.5 transition-colors hover:bg-background",
                    index === folderPath.length - 1
                      ? "font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.name}
                </button>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5">
            <button
              onClick={() => setViewMode("grid")}
              className={cn(
                "rounded-sm p-1.5 transition-colors",
                viewMode === "grid"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <HugeiconsIcon
                icon={GridViewIcon}
                strokeWidth={2}
                className="size-3.5"
              />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={cn(
                "rounded-sm p-1.5 transition-colors",
                viewMode === "list"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <HugeiconsIcon
                icon={Menu01Icon}
                strokeWidth={2}
                className="size-3.5"
              />
            </button>
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex min-h-[400px] items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="text-sm text-muted-foreground">Loading files...</p>
            </div>
          </div>
        ) : isEmpty ? (
          <div className="flex min-h-[400px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-border/60 bg-muted/20 p-12">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
              <HugeiconsIcon
                icon={FolderOpenIcon}
                strokeWidth={1.5}
                className="size-8 text-primary"
              />
            </div>
            <p className="mt-4 text-lg font-semibold text-foreground">
              {currentFolderId ? "This folder is empty" : "No documents yet"}
            </p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Upload PDFs, images, or text files to get started.
            </p>
            <div className="mt-6 flex gap-3">
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
          <div>
            {/* Folders Section */}
            {folders.length > 0 && (
              <div className="mb-6">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Folders
                </h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {folders.map((folder) => (
                    <div
                      key={folder.id}
                      className="group relative flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-card p-3.5 shadow-sm transition-all duration-200 hover:border-primary/30 hover:bg-primary/[0.03] hover:shadow-md"
                      onClick={() => navigateToFolder(folder.id, folder.name)}
                    >
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <HugeiconsIcon
                          icon={FolderOpenIcon}
                          strokeWidth={1.5}
                          className="size-5 text-primary"
                        />
                      </div>
                      <p className="min-w-0 flex-1 truncate text-sm font-medium">
                        {folder.name}
                      </p>
                      <div className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
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
                </div>
              </div>
            )}

            {/* Documents Section */}
            {documents.length > 0 && (
              <div>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Files
                </h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {documents.map((doc) => (
                    <div
                      key={doc.id}
                      className={cn(
                        "group relative flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm transition-all duration-200 hover:border-border/80 hover:shadow-md",
                        doc.s3Url && "cursor-pointer",
                      )}
                      onClick={() => handleOpenPreview(doc)}
                    >
                      <div className="flex items-start justify-between">
                        <div
                          className={cn(
                            "flex size-10 items-center justify-center rounded-lg",
                            getDocumentIconBg(doc.type),
                          )}
                        >
                          <HugeiconsIcon
                            icon={getDocumentIcon(doc.type)}
                            strokeWidth={1.5}
                            className={cn(
                              "size-5",
                              getDocumentIconColor(doc.type),
                            )}
                          />
                        </div>
                        <div className="opacity-0 transition-opacity group-hover:opacity-100">
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
                            onOpen={
                              doc.s3Url
                                ? () => handleOpenPreview(doc)
                                : undefined
                            }
                            onDownload={
                              doc.s3Url ? () => handleDownload(doc) : undefined
                            }
                          />
                        </div>
                      </div>
                      <p className="mt-3 truncate text-sm font-medium">
                        {doc.name}
                      </p>
                      <div className="mt-2 flex items-center justify-between">
                        {getStatusBadge(doc.status)}
                        <span className="text-[11px] text-muted-foreground">
                          {formatFileSize(doc.fileSize)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* List View */
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="grid grid-cols-[1fr_100px_100px_90px_40px] gap-2 border-b border-border bg-muted/40 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
                className="group grid cursor-pointer grid-cols-[1fr_100px_100px_90px_40px] items-center gap-2 border-b border-border/50 px-4 py-3 transition-colors last:border-0 hover:bg-primary/[0.03]"
                onClick={() => navigateToFolder(folder.id, folder.name)}
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <HugeiconsIcon
                      icon={FolderOpenIcon}
                      strokeWidth={2}
                      className="size-4 text-primary"
                    />
                  </div>
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
                className={cn(
                  "group grid grid-cols-[1fr_100px_100px_90px_40px] items-center gap-2 border-b border-border/50 px-4 py-3 transition-colors last:border-0 hover:bg-muted/40",
                  doc.s3Url && "cursor-pointer",
                )}
                onClick={() => handleOpenPreview(doc)}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-lg",
                      getDocumentIconBg(doc.type),
                    )}
                  >
                    <HugeiconsIcon
                      icon={getDocumentIcon(doc.type)}
                      strokeWidth={2}
                      className={cn("size-4", getDocumentIconColor(doc.type))}
                    />
                  </div>
                  <span className="truncate text-sm font-medium">
                    {doc.name}
                  </span>
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
                  onOpen={doc.s3Url ? () => handleOpenPreview(doc) : undefined}
                  onDownload={doc.s3Url ? () => handleDownload(doc) : undefined}
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

        {/* File Preview Dialog */}
        <Dialog
          open={!!previewDocument}
          onOpenChange={(open) => !open && setPreviewDocument(null)}
        >
          <DialogContent
            className="flex h-[85vh] max-h-[85vh] flex-col sm:max-w-4xl"
            showCloseButton={false}
          >
            {previewDocument && (
              <>
                <DialogHeader>
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-lg",
                          getDocumentIconBg(previewDocument.type),
                        )}
                      >
                        <HugeiconsIcon
                          icon={getDocumentIcon(previewDocument.type)}
                          strokeWidth={1.5}
                          className={cn(
                            "size-4.5",
                            getDocumentIconColor(previewDocument.type),
                          )}
                        />
                      </div>
                      <div className="min-w-0">
                        <DialogTitle className="truncate">
                          {previewDocument.name}
                        </DialogTitle>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {previewDocument.type.toUpperCase()} &middot;{" "}
                          {formatFileSize(previewDocument.fileSize)}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDownload(previewDocument)}
                      >
                        <HugeiconsIcon
                          icon={Download04Icon}
                          strokeWidth={2}
                          data-icon="inline-start"
                        />
                        Download
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setPreviewDocument(null)}
                      >
                        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
                      </Button>
                    </div>
                  </div>
                </DialogHeader>
                <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-muted/30">
                  <FilePreviewContent document={previewDocument} />
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}

// File preview content based on document type
function FilePreviewContent({ document: doc }: { document: Document }) {
  if (!doc.s3Url) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">File URL not available.</p>
      </div>
    );
  }

  switch (doc.type) {
    case "pdf":
      return <iframe src={doc.s3Url} className="size-full" title={doc.name} />;
    case "image":
      return (
        <div className="flex h-full items-center justify-center overflow-auto p-4">
          <img
            src={doc.s3Url}
            alt={doc.name}
            className="max-h-full max-w-full rounded-md object-contain"
          />
        </div>
      );
    case "text":
      return <TextFilePreview url={doc.s3Url} />;
    default:
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3">
          <HugeiconsIcon
            icon={File01Icon}
            strokeWidth={1.5}
            className="size-12 text-muted-foreground/40"
          />
          <p className="text-sm text-muted-foreground">
            Preview not available for this file type.
          </p>
        </div>
      );
  }
}

// Text file preview - fetches content and displays it
function TextFilePreview({ url }: { url: string }) {
  const { data: content, isLoading } = useQuery({
    queryKey: ["text-preview", url],
    queryFn: async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch file");
      return res.text();
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading content...</p>
        </div>
      </div>
    );
  }

  return (
    <pre className="h-full overflow-auto p-4 text-sm leading-relaxed whitespace-pre-wrap text-foreground">
      {content}
    </pre>
  );
}

// Context menu for folder/document items
function ItemContextMenu({
  onRename,
  onDelete,
  onOpen,
  onDownload,
}: {
  onRename: () => void;
  onDelete: () => void;
  onOpen?: () => void;
  onDownload?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        onClick={(e) => e.stopPropagation()}
        className="flex size-7 items-center justify-center rounded-lg hover:bg-muted"
      >
        <HugeiconsIcon
          icon={MoreVerticalIcon}
          strokeWidth={2}
          className="size-3.5"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4}>
        {onOpen && (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
          >
            <HugeiconsIcon icon={ViewIcon} strokeWidth={2} />
            Open
          </DropdownMenuItem>
        )}
        {onDownload && (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onDownload();
            }}
          >
            <HugeiconsIcon icon={Download04Icon} strokeWidth={2} />
            Download
          </DropdownMenuItem>
        )}
        {(onOpen || onDownload) && <DropdownMenuSeparator />}
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
