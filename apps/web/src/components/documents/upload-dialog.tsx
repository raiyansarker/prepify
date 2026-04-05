import { useState, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CloudUploadIcon,
  File01Icon,
  Cancel01Icon,
  Tick02Icon,
  Alert02Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Progress } from "#/components/ui/progress";
import { cn } from "#/lib/utils";
import { api } from "#/lib/api";
import { uploadClient } from "#/lib/upload";
import {
  MAX_FILE_SIZE_MB,
  ALLOWED_DOCUMENT_TYPES,
  ALLOWED_IMAGE_TYPES,
} from "@repo/shared";

type StagedFile = {
  id: string;
  file: File;
};

type UploadDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId: string | null;
  onUploadComplete: () => void;
};

const ACCEPTED_TYPES = [
  ...ALLOWED_DOCUMENT_TYPES,
  ...ALLOWED_IMAGE_TYPES,
] as readonly string[];

export function UploadDialog({
  open,
  onOpenChange,
  folderId,
  onUploadComplete,
}: UploadDialogProps) {
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const createDocumentMutation = useMutation({
    mutationFn: async (params: {
      name: string;
      mimeType: string;
      fileSize: number;
      s3Key: string;
      s3Url: string;
      folderId?: string;
    }) => {
      const { data, error } = await api.documents.post(params);
      if (error) throw new Error("Failed to create document record");
      return data;
    },
  });

  const {
    uploadFiles: pushduckUpload,
    files: uploadedFiles,
    isUploading,
    reset: resetUpload,
  } = uploadClient.documentUpload({
    onSuccess: async (results) => {
      // Create document records for each successfully uploaded file
      const errors: string[] = [];
      for (const result of results) {
        if (result.url && result.key) {
          try {
            await createDocumentMutation.mutateAsync({
              name: result.name,
              mimeType: result.type,
              fileSize: result.size,
              s3Key: result.key,
              s3Url: result.url,
              folderId: folderId || undefined,
            });
          } catch {
            errors.push(result.name);
          }
        }
      }
      if (errors.length > 0) {
        console.warn(
          `${errors.length} file(s) uploaded but failed to save: ${errors.join(", ")}`,
        );
      }
      onUploadComplete();
    },
    onError: (error) => {
      console.error("Upload failed:", error);
    },
  });

  const addFiles = useCallback((newFiles: File[]) => {
    const validFiles: StagedFile[] = newFiles
      .filter((f) => {
        const isValidType = ACCEPTED_TYPES.includes(f.type);
        const isValidSize = f.size <= MAX_FILE_SIZE_MB * 1024 * 1024;
        return isValidType && isValidSize;
      })
      .map((file) => ({
        id: crypto.randomUUID(),
        file,
      }));

    setStagedFiles((prev) => [...prev, ...validFiles]);
  }, []);

  const removeFile = useCallback((id: string) => {
    setStagedFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const droppedFiles = Array.from(e.dataTransfer.files);
      addFiles(droppedFiles);
    },
    [addFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        addFiles(Array.from(e.target.files));
      }
      // Reset input so same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [addFiles],
  );

  const handleUpload = useCallback(async () => {
    const filesToUpload = stagedFiles.map((sf) => sf.file);
    setStagedFiles([]);
    await pushduckUpload(filesToUpload);
  }, [stagedFiles, pushduckUpload]);

  const handleClose = useCallback(() => {
    if (!isUploading) {
      setStagedFiles([]);
      resetUpload();
      onOpenChange(false);
    }
  }, [isUploading, onOpenChange, resetUpload]);

  const hasStaged = stagedFiles.length > 0;
  const hasUploaded = uploadedFiles.length > 0;
  const hasFiles = hasStaged || hasUploaded;
  const allDone =
    hasUploaded &&
    !hasStaged &&
    uploadedFiles.every((f) => f.status === "success" || f.status === "error");

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload Files</DialogTitle>
          <DialogDescription>
            Upload PDFs, images, or text files. Max {MAX_FILE_SIZE_MB}MB per
            file.
          </DialogDescription>
        </DialogHeader>

        {/* Drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors",
            isDragging
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-muted/50",
          )}
        >
          <HugeiconsIcon
            icon={CloudUploadIcon}
            strokeWidth={1.5}
            className={cn(
              "mb-3 size-10",
              isDragging ? "text-primary" : "text-muted-foreground",
            )}
          />
          <p className="text-sm font-medium">
            {isDragging ? "Drop files here" : "Click or drag files to upload"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            PDF, images, or text files
          </p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_TYPES.join(",")}
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* Staged files (before upload) */}
        {hasStaged && !isUploading && (
          <div className="max-h-48 space-y-2 overflow-y-auto">
            {stagedFiles.map((stagedFile) => (
              <div
                key={stagedFile.id}
                className="flex items-center gap-3 rounded-lg border border-border p-2.5"
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                  <HugeiconsIcon
                    icon={File01Icon}
                    strokeWidth={2}
                    className="size-4 text-muted-foreground"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {stagedFile.file.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(stagedFile.file.size / 1024 / 1024).toFixed(1)} MB
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(stagedFile.id);
                  }}
                >
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    strokeWidth={2}
                    className="size-3.5"
                  />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Uploading / uploaded files (from pushduck) */}
        {hasUploaded && (
          <div className="max-h-48 space-y-2 overflow-y-auto">
            {uploadedFiles.map((uploadFile) => (
              <div
                key={uploadFile.id}
                className="flex items-center gap-3 rounded-lg border border-border p-2.5"
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                  {uploadFile.status === "success" ? (
                    <HugeiconsIcon
                      icon={Tick02Icon}
                      strokeWidth={2}
                      className="size-4 text-emerald-600"
                    />
                  ) : uploadFile.status === "error" ? (
                    <HugeiconsIcon
                      icon={Alert02Icon}
                      strokeWidth={2}
                      className="size-4 text-destructive"
                    />
                  ) : (
                    <HugeiconsIcon
                      icon={File01Icon}
                      strokeWidth={2}
                      className="size-4 text-muted-foreground"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {uploadFile.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(uploadFile.size / 1024 / 1024).toFixed(1)} MB
                    {uploadFile.error && (
                      <span className="text-destructive">
                        {" "}
                        - {uploadFile.error}
                      </span>
                    )}
                  </p>
                  {uploadFile.status === "uploading" && (
                    <Progress
                      value={uploadFile.progress}
                      className="mt-1 h-1"
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isUploading}
          >
            {allDone && hasFiles ? "Close" : "Cancel"}
          </Button>
          {hasStaged && (
            <Button onClick={handleUpload} disabled={isUploading}>
              {isUploading
                ? "Uploading..."
                : `Upload ${stagedFiles.length} file(s)`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
