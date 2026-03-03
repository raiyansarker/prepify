import { useState, useRef, useCallback } from "react";
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
import {
  MAX_FILE_SIZE_MB,
  ALLOWED_DOCUMENT_TYPES,
  ALLOWED_IMAGE_TYPES,
} from "@repo/shared";

type UploadFile = {
  id: string;
  file: File;
  progress: number;
  status: "pending" | "uploading" | "success" | "error";
  error?: string;
  s3Key?: string;
  s3Url?: string;
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
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((newFiles: File[]) => {
    const uploadFiles: UploadFile[] = newFiles
      .filter((f) => {
        const isValidType = ACCEPTED_TYPES.includes(f.type);
        const isValidSize = f.size <= MAX_FILE_SIZE_MB * 1024 * 1024;
        return isValidType && isValidSize;
      })
      .map((file) => ({
        id: crypto.randomUUID(),
        file,
        progress: 0,
        status: "pending" as const,
      }));

    setFiles((prev) => [...prev, ...uploadFiles]);
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
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

  const uploadFiles = useCallback(async () => {
    setIsUploading(true);

    const pendingFiles = files.filter((f) => f.status === "pending");

    for (const uploadFile of pendingFiles) {
      // Update status to uploading
      setFiles((prev) =>
        prev.map((f) =>
          f.id === uploadFile.id ? { ...f, status: "uploading" as const } : f,
        ),
      );

      try {
        // Upload to S3 via Pushduck endpoint
        const formData = new FormData();
        formData.append("file", uploadFile.file);

        const uploadResponse = await fetch(
          `${import.meta.env.VITE_API_URL || "http://localhost:3001"}/upload/documentUpload`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${window.__clerk_token || ""}`,
            },
            body: formData,
          },
        );

        if (!uploadResponse.ok) {
          throw new Error("Upload failed");
        }

        const uploadResult = (await uploadResponse.json()) as {
          url: string;
          key: string;
        };

        // Create document record in database
        const { error } = await api.documents.post({
          name: uploadFile.file.name,
          mimeType: uploadFile.file.type,
          fileSize: uploadFile.file.size,
          s3Key: uploadResult.key,
          s3Url: uploadResult.url,
          folderId: folderId || undefined,
        });

        if (error) {
          throw new Error("Failed to create document record");
        }

        // Update status to success
        setFiles((prev) =>
          prev.map((f) =>
            f.id === uploadFile.id
              ? {
                  ...f,
                  status: "success" as const,
                  progress: 100,
                  s3Key: uploadResult.key,
                  s3Url: uploadResult.url,
                }
              : f,
          ),
        );
      } catch (err) {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === uploadFile.id
              ? {
                  ...f,
                  status: "error" as const,
                  error: err instanceof Error ? err.message : "Upload failed",
                }
              : f,
          ),
        );
      }
    }

    setIsUploading(false);
    onUploadComplete();
  }, [files, folderId, onUploadComplete]);

  const handleClose = useCallback(() => {
    if (!isUploading) {
      setFiles([]);
      onOpenChange(false);
    }
  }, [isUploading, onOpenChange]);

  const hasFiles = files.length > 0;
  const allDone = files.every(
    (f) => f.status === "success" || f.status === "error",
  );
  const hasPending = files.some((f) => f.status === "pending");

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

        {/* File list */}
        {hasFiles && (
          <div className="max-h-48 space-y-2 overflow-y-auto">
            {files.map((uploadFile) => (
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
                    {uploadFile.file.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(uploadFile.file.size / 1024 / 1024).toFixed(1)} MB
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
                {uploadFile.status === "pending" && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(uploadFile.id);
                    }}
                  >
                    <HugeiconsIcon
                      icon={Cancel01Icon}
                      strokeWidth={2}
                      className="size-3.5"
                    />
                  </Button>
                )}
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
          {hasPending && (
            <Button onClick={uploadFiles} disabled={isUploading}>
              {isUploading
                ? "Uploading..."
                : `Upload ${files.filter((f) => f.status === "pending").length} file(s)`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
