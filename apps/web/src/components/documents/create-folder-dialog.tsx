import { useState, useCallback } from "react";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { api } from "#/lib/api";

type CreateFolderDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentId: string | null;
  onFolderCreated: () => void;
};

export function CreateFolderDialog({
  open,
  onOpenChange,
  parentId,
  onFolderCreated,
}: CreateFolderDialogProps) {
  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = useCallback(async () => {
    if (!name.trim()) {
      setError("Folder name is required");
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const { error: apiError } = await api.folders.post({
        name: name.trim(),
        parentId: parentId || undefined,
      });

      if (apiError) {
        setError("Failed to create folder");
        return;
      }

      setName("");
      onFolderCreated();
      onOpenChange(false);
    } catch {
      setError("Failed to create folder");
    } finally {
      setIsCreating(false);
    }
  }, [name, parentId, onFolderCreated, onOpenChange]);

  const handleClose = useCallback(() => {
    if (!isCreating) {
      setName("");
      setError(null);
      onOpenChange(false);
    }
  }, [isCreating, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New Folder</DialogTitle>
          <DialogDescription>
            Create a new folder to organize your documents.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="folder-name">Folder name</Label>
          <Input
            id="folder-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
            placeholder="My Study Materials"
            autoFocus
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isCreating}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isCreating || !name.trim()}>
            {isCreating ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
