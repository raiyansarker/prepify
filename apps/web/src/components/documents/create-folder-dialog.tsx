import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
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

  const createFolderMutation = useMutation({
    mutationFn: async ({
      name,
      parentId,
    }: {
      name: string;
      parentId?: string;
    }) => {
      const { data, error } = await api.folders.post({
        name,
        parentId,
      });
      if (error) throw new Error("Failed to create folder");
      return data;
    },
    onSuccess: () => {
      setName("");
      onFolderCreated();
      onOpenChange(false);
    },
  });

  const handleCreate = useCallback(() => {
    if (!name.trim()) return;
    createFolderMutation.mutate({
      name: name.trim(),
      parentId: parentId || undefined,
    });
  }, [name, parentId, createFolderMutation]);

  const handleClose = useCallback(() => {
    if (!createFolderMutation.isPending) {
      setName("");
      createFolderMutation.reset();
      onOpenChange(false);
    }
  }, [createFolderMutation, onOpenChange]);

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
              if (createFolderMutation.isError) createFolderMutation.reset();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
            placeholder="My Study Materials"
            autoFocus
          />
          {createFolderMutation.isError && (
            <p className="text-xs text-destructive">
              {createFolderMutation.error.message}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={createFolderMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={createFolderMutation.isPending || !name.trim()}
          >
            {createFolderMutation.isPending ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
