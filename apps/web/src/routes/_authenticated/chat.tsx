import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ChatBotIcon,
  Add01Icon,
  Delete02Icon,
  PencilEdit02Icon,
  SentIcon,
  MoreVerticalIcon,
  Cancel01Icon,
  Tick02Icon,
  FileAttachmentIcon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
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
import { Badge } from "#/components/ui/badge";
import { cn } from "#/lib/utils";
import { api } from "#/lib/api";

export const Route = createFileRoute("/_authenticated/chat")({
  component: ChatPage,
});

// ============================================
// Types
// ============================================

type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};

type Document = {
  id: string;
  name: string;
  type: "pdf" | "image" | "text";
  status: "pending" | "processing" | "ready" | "failed";
};

// ============================================
// Main Chat Page
// ============================================

function ChatPage() {
  const queryClient = useQueryClient();

  // Active conversation selection
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);

  // Input state
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");

  // Optimistic messages appended during streaming (user msg + assistant msg)
  const [pendingMessages, setPendingMessages] = useState<Message[]>([]);

  // Document scope state
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [showDocumentPicker, setShowDocumentPicker] = useState(false);

  // UI state
  const [editingConversationId, setEditingConversationId] = useState<
    string | null
  >(null);
  const [editTitle, setEditTitle] = useState("");
  const [deleteConversationId, setDeleteConversationId] = useState<
    string | null
  >(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fullContentRef = useRef("");

  // ============================================
  // Data fetching via TanStack Query
  // ============================================

  const normalizeConversation = (c: Conversation): Conversation => ({
    ...c,
    createdAt:
      typeof c.createdAt === "string"
        ? c.createdAt
        : new Date(c.createdAt).toISOString(),
    updatedAt:
      typeof c.updatedAt === "string"
        ? c.updatedAt
        : new Date(c.updatedAt).toISOString(),
  });

  const normalizeMessage = (m: Message): Message => ({
    ...m,
    createdAt:
      typeof m.createdAt === "string"
        ? m.createdAt
        : new Date(m.createdAt).toISOString(),
  });

  const { data: conversations = [], isLoading: isLoadingConversations } =
    useQuery({
      queryKey: ["conversations"],
      queryFn: async () => {
        const res = await api.chat.conversations.get();
        if (res.data && "success" in res.data && res.data.success) {
          return (res.data.data as Conversation[]).map(normalizeConversation);
        }
        return [];
      },
    });

  const { data: serverMessages = [], isLoading: isLoadingMessages } = useQuery({
    queryKey: ["messages", activeConversationId],
    queryFn: async () => {
      if (!activeConversationId) return [];
      const res = await api.chat
        .conversations({ id: activeConversationId })
        .get();
      if (res.data && "success" in res.data && res.data.success) {
        const data = res.data.data as { messages: Message[] };
        return data.messages.map(normalizeMessage);
      }
      return [];
    },
    enabled: !!activeConversationId,
  });

  // Combine server messages with optimistic pending messages, deduplicating
  // by role+content so that once the server returns the same messages we
  // don't show them twice.
  const messages = [
    ...serverMessages,
    ...pendingMessages.filter(
      (pm) =>
        !serverMessages.some(
          (sm) => sm.role === pm.role && sm.content === pm.content,
        ),
    ),
  ];

  const { data: documents = [] } = useQuery({
    queryKey: ["chat-documents"],
    queryFn: async () => {
      const res = await api.documents.get({ query: {} });
      if (res.data && "success" in res.data && res.data.success) {
        return (res.data.data as Document[]).filter(
          (d) => d.status === "ready",
        );
      }
      return [];
    },
  });

  // Clear pending messages when active conversation changes (query will refetch)
  useEffect(() => {
    setPendingMessages([]);
  }, [activeConversationId]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamingContent]);

  // ============================================
  // Conversation mutations
  // ============================================

  const createConversationMutation = useMutation({
    mutationFn: async () => {
      const res = await api.chat.conversations.post({});
      if (res.data && "success" in res.data && res.data.success) {
        return normalizeConversation(res.data.data as Conversation);
      }
      throw new Error("Failed to create conversation");
    },
    onSuccess: (conversation) => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      setActiveConversationId(conversation.id);
      setPendingMessages([]);
      inputRef.current?.focus();
    },
  });

  const renameConversationMutation = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const res = await api.chat.conversations({ id }).patch({ title });
      if (!(res.data && "success" in res.data && res.data.success)) {
        throw new Error("Failed to rename conversation");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      setEditingConversationId(null);
    },
    onError: () => {
      setEditingConversationId(null);
    },
  });

  const deleteConversationMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.chat.conversations({ id }).delete();
      if (!(res.data && "success" in res.data && res.data.success)) {
        throw new Error("Failed to delete conversation");
      }
      return id;
    },
    onSuccess: (deletedId) => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      if (activeConversationId === deletedId) {
        setActiveConversationId(null);
        setPendingMessages([]);
      }
      setDeleteConversationId(null);
    },
    onError: () => {
      setDeleteConversationId(null);
    },
  });

  // ============================================
  // Send message with streaming
  // ============================================

  const sendMessage = useCallback(async () => {
    if (!inputValue.trim() || isStreaming) return;

    let conversationId = activeConversationId;

    // Create conversation if none is active
    if (!conversationId) {
      try {
        const res = await api.chat.conversations.post({});
        if (res.data && "success" in res.data && res.data.success) {
          const conversation = normalizeConversation(
            res.data.data as Conversation,
          );
          queryClient.invalidateQueries({ queryKey: ["conversations"] });
          conversationId = conversation.id;
          setActiveConversationId(conversationId);
        }
      } catch {
        return;
      }
    }

    if (!conversationId) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: inputValue.trim(),
      createdAt: new Date().toISOString(),
    };

    setPendingMessages([userMessage]);
    const messageText = inputValue.trim();
    setInputValue("");
    setIsStreaming(true);
    setStreamingContent("");

    // Optimistic auto-title update for first message
    if (serverMessages.length === 0 && pendingMessages.length === 0) {
      const autoTitle =
        messageText.length > 60
          ? messageText.slice(0, 57) + "..."
          : messageText;
      queryClient.setQueryData<Conversation[]>(["conversations"], (old) =>
        (old ?? []).map((c) =>
          c.id === conversationId ? { ...c, title: autoTitle } : c,
        ),
      );
    }

    try {
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const token = window.__clerk_token;
      const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:3001";

      const response = await fetch(
        `${apiUrl}/chat/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            message: messageText,
            ...(selectedDocumentIds.length > 0
              ? { documentIds: selectedDocumentIds }
              : {}),
          }),
          signal: abortController.signal,
        },
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let fullContent = "";
      fullContentRef.current = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        fullContent += chunk;
        fullContentRef.current = fullContent;
        setStreamingContent(fullContent);
      }

      // Add the complete assistant message to pending
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: fullContent,
        createdAt: new Date().toISOString(),
      };

      setPendingMessages([userMessage, assistantMessage]);
      setStreamingContent("");

      // Small delay to allow the server's onFinish handler to persist the
      // assistant message before we refetch.
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Refresh server data then clear pending messages so they aren't
      // duplicated by the refetched server messages.
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      await queryClient.invalidateQueries({
        queryKey: ["messages", conversationId],
      });
      setPendingMessages([]);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        // User cancelled - add partial content as message
        const currentStreaming = fullContentRef.current;
        if (currentStreaming) {
          const partialMessage: Message = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: currentStreaming + "\n\n_(response cancelled)_",
            createdAt: new Date().toISOString(),
          };
          setPendingMessages((prev) => [...prev, partialMessage]);
        }
      } else {
        const errorMessage: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "Sorry, I encountered an error processing your request. Please try again.",
          createdAt: new Date().toISOString(),
        };
        setPendingMessages((prev) => [...prev, errorMessage]);
      }
      setStreamingContent("");
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [
    inputValue,
    isStreaming,
    activeConversationId,
    serverMessages.length,
    pendingMessages.length,
    selectedDocumentIds,
    queryClient,
  ]);

  const cancelStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  // ============================================
  // Document scope
  // ============================================

  const toggleDocumentScope = useCallback((docId: string) => {
    setSelectedDocumentIds((prev) =>
      prev.includes(docId)
        ? prev.filter((id) => id !== docId)
        : [...prev, docId],
    );
  }, []);

  // ============================================
  // Keyboard shortcuts
  // ============================================

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage],
  );

  // ============================================
  // Render
  // ============================================

  return (
    <div className="-m-6 flex h-[calc(100vh-3.5rem)] lg:h-screen">
      {/* Conversation sidebar */}
      <div
        className={cn(
          "flex w-72 flex-col border-r border-border bg-muted/30 transition-all duration-200",
          !sidebarOpen && "w-0 overflow-hidden border-r-0",
        )}
      >
        {/* Sidebar header */}
        <div className="flex h-14 items-center justify-between border-b border-border px-3">
          <h2 className="text-sm font-semibold">Conversations</h2>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => createConversationMutation.mutate()}
          >
            <HugeiconsIcon
              icon={Add01Icon}
              strokeWidth={2}
              className="size-4"
            />
          </Button>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto p-2">
          {isLoadingConversations ? (
            <div className="flex items-center justify-center py-8">
              <HugeiconsIcon
                icon={Loading03Icon}
                strokeWidth={2}
                className="size-5 animate-spin text-muted-foreground"
              />
            </div>
          ) : conversations.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No conversations yet
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Start typing to begin
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {conversations.map((convo) => (
                <div
                  key={convo.id}
                  className={cn(
                    "group flex items-center gap-1 rounded-lg px-2.5 py-2 text-sm transition-colors cursor-pointer",
                    activeConversationId === convo.id
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                  onClick={() => setActiveConversationId(convo.id)}
                >
                  {editingConversationId === convo.id ? (
                    <div className="flex flex-1 items-center gap-1">
                      <Input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            renameConversationMutation.mutate({
                              id: convo.id,
                              title: editTitle,
                            });
                          } else if (e.key === "Escape") {
                            setEditingConversationId(null);
                          }
                        }}
                        className="h-6 text-xs"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          renameConversationMutation.mutate({
                            id: convo.id,
                            title: editTitle,
                          });
                        }}
                      >
                        <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingConversationId(null);
                        }}
                      >
                        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <HugeiconsIcon
                        icon={ChatBotIcon}
                        strokeWidth={2}
                        className="size-4 shrink-0"
                      />
                      <span className="flex-1 truncate">{convo.title}</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="opacity-0 group-hover:opacity-100"
                              onClick={(e) => e.stopPropagation()}
                            />
                          }
                        >
                          <HugeiconsIcon
                            icon={MoreVerticalIcon}
                            strokeWidth={2}
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" side="bottom">
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingConversationId(convo.id);
                              setEditTitle(convo.title);
                            }}
                          >
                            <HugeiconsIcon
                              icon={PencilEdit02Icon}
                              strokeWidth={2}
                            />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConversationId(convo.id);
                            }}
                          >
                            <HugeiconsIcon
                              icon={Delete02Icon}
                              strokeWidth={2}
                            />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex flex-1 flex-col">
        {/* Chat header */}
        <div className="flex h-14 items-center gap-3 border-b border-border px-4">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <HugeiconsIcon
              icon={ChatBotIcon}
              strokeWidth={2}
              className="size-4"
            />
          </Button>
          <div className="flex-1">
            <h1 className="text-sm font-semibold">
              {activeConversationId
                ? conversations.find((c) => c.id === activeConversationId)
                    ?.title || "Chat"
                : "AI Chat"}
            </h1>
            {selectedDocumentIds.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {selectedDocumentIds.length} document
                {selectedDocumentIds.length !== 1 ? "s" : ""} selected as
                context
              </p>
            )}
          </div>

          {/* Document scope toggle */}
          <Button
            variant={selectedDocumentIds.length > 0 ? "secondary" : "outline"}
            size="sm"
            onClick={() => setShowDocumentPicker(!showDocumentPicker)}
          >
            <HugeiconsIcon
              icon={FileAttachmentIcon}
              strokeWidth={2}
              className="size-3.5"
            />
            {selectedDocumentIds.length > 0
              ? `${selectedDocumentIds.length} docs`
              : "Scope"}
          </Button>
        </div>

        {/* Document picker panel */}
        {showDocumentPicker && (
          <div className="border-b border-border bg-muted/30 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">
                Select documents to scope the AI's context (or leave empty for
                all documents)
              </p>
              {selectedDocumentIds.length > 0 && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setSelectedDocumentIds([])}
                >
                  Clear all
                </Button>
              )}
            </div>
            {documents.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No processed documents available. Upload and process documents
                first.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {documents.map((doc) => (
                  <Badge
                    key={doc.id}
                    variant={
                      selectedDocumentIds.includes(doc.id)
                        ? "default"
                        : "outline"
                    }
                    className="cursor-pointer select-none"
                    onClick={() => toggleDocumentScope(doc.id)}
                  >
                    {doc.name}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto">
          {!activeConversationId && messages.length === 0 ? (
            // Empty state
            <div className="flex h-full flex-col items-center justify-center px-4">
              <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
                <HugeiconsIcon
                  icon={ChatBotIcon}
                  strokeWidth={1.5}
                  className="size-8 text-primary"
                />
              </div>
              <h2 className="mt-4 text-xl font-semibold">
                Start a conversation
              </h2>
              <p className="mt-2 max-w-md text-center text-sm text-muted-foreground">
                Ask questions about your study materials or any topic. The AI
                will use your uploaded documents as context for more accurate
                answers.
              </p>
            </div>
          ) : (
            // Message list
            <div className="mx-auto max-w-3xl space-y-1 px-4 py-4">
              {isLoadingMessages ? (
                <div className="flex items-center justify-center py-16">
                  <HugeiconsIcon
                    icon={Loading03Icon}
                    strokeWidth={2}
                    className="size-5 animate-spin text-muted-foreground"
                  />
                </div>
              ) : (
                <>
                  {messages.map((message) => (
                    <ChatMessage key={message.id} message={message} />
                  ))}

                  {/* Streaming message */}
                  {isStreaming && streamingContent && (
                    <ChatMessage
                      message={{
                        id: "streaming",
                        role: "assistant",
                        content: streamingContent,
                        createdAt: new Date().toISOString(),
                      }}
                      isStreaming
                    />
                  )}

                  {/* Streaming loading indicator (before first token) */}
                  {isStreaming && !streamingContent && (
                    <div className="flex gap-3 py-3">
                      <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <HugeiconsIcon
                          icon={ChatBotIcon}
                          strokeWidth={2}
                          className="size-4 text-primary"
                        />
                      </div>
                      <div className="flex items-center gap-1 pt-1">
                        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/50" />
                        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/50 [animation-delay:150ms]" />
                        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/50 [animation-delay:300ms]" />
                      </div>
                    </div>
                  )}
                </>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="border-t border-border bg-background p-4">
          <div className="mx-auto max-w-3xl">
            <div className="flex items-end gap-2">
              <div className="relative flex-1">
                <textarea
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    activeConversationId
                      ? "Type your message..."
                      : "Start a new conversation..."
                  }
                  disabled={isStreaming}
                  rows={1}
                  className="flex min-h-10 max-h-36 w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
                  style={{ fieldSizing: "content" } as React.CSSProperties}
                />
              </div>
              {isStreaming ? (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={cancelStreaming}
                  title="Stop generating"
                >
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    strokeWidth={2}
                    className="size-4"
                  />
                </Button>
              ) : (
                <Button
                  size="icon"
                  onClick={sendMessage}
                  disabled={!inputValue.trim()}
                  title="Send message"
                >
                  <HugeiconsIcon
                    icon={SentIcon}
                    strokeWidth={2}
                    className="size-4"
                  />
                </Button>
              )}
            </div>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              AI responses may be inaccurate. Verify important information.
            </p>
          </div>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={!!deleteConversationId}
        onOpenChange={(open) => {
          if (!open) setDeleteConversationId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this conversation and all its
              messages. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteConversationId &&
                deleteConversationMutation.mutate(deleteConversationId)
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============================================
// Chat Message Component
// ============================================

function ChatMessage({
  message,
  isStreaming = false,
}: {
  message: Message;
  isStreaming?: boolean;
}) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex gap-3 py-3", isUser && "flex-row-reverse")}>
      {/* Avatar */}
      <div
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-lg",
          isUser ? "bg-foreground/10" : "bg-primary/10",
        )}
      >
        {isUser ? (
          <span className="text-xs font-medium">You</span>
        ) : (
          <HugeiconsIcon
            icon={ChatBotIcon}
            strokeWidth={2}
            className="size-4 text-primary"
          />
        )}
      </div>

      {/* Message bubble */}
      <div
        className={cn(
          "max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
        )}
      >
        <MessageContent content={message.content} />
        {isStreaming && (
          <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-current" />
        )}
      </div>
    </div>
  );
}

// ============================================
// Message Content Renderer (basic markdown)
// ============================================

function MessageContent({ content }: { content: string }) {
  // Simple markdown-like rendering for common patterns
  const lines = content.split("\n");

  return (
    <div className="space-y-2">
      {lines.map((line, i) => {
        // Empty line = paragraph break
        if (!line.trim()) {
          return <div key={i} className="h-1" />;
        }

        // Headers
        if (line.startsWith("### ")) {
          return (
            <h4 key={i} className="font-semibold text-sm mt-3 mb-1">
              {line.slice(4)}
            </h4>
          );
        }
        if (line.startsWith("## ")) {
          return (
            <h3 key={i} className="font-semibold text-base mt-3 mb-1">
              {line.slice(3)}
            </h3>
          );
        }
        if (line.startsWith("# ")) {
          return (
            <h2 key={i} className="font-bold text-lg mt-3 mb-1">
              {line.slice(2)}
            </h2>
          );
        }

        // Bullet points
        if (line.startsWith("- ") || line.startsWith("* ")) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-current opacity-50" />
              <span>{renderInlineFormatting(line.slice(2))}</span>
            </div>
          );
        }

        // Numbered lists
        const numberedMatch = line.match(/^(\d+)\.\s(.+)/);
        if (numberedMatch) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="shrink-0 text-muted-foreground">
                {numberedMatch[1]}.
              </span>
              <span>{renderInlineFormatting(numberedMatch[2])}</span>
            </div>
          );
        }

        // Regular paragraph
        return <p key={i}>{renderInlineFormatting(line)}</p>;
      })}
    </div>
  );
}

function renderInlineFormatting(text: string): React.ReactNode {
  // Bold: **text**
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);

  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          className="rounded bg-foreground/10 px-1 py-0.5 text-xs font-mono"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}
