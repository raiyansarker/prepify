import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { useChat } from "@ai-sdk/react";
import { TextStreamChatTransport, type UIMessage } from "ai";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Delete02Icon,
  PencilEdit02Icon,
  SentIcon,
  Cancel01Icon,
  Tick02Icon,
  FileAttachmentIcon,
  Loading03Icon,
  ArrowDown01Icon,
  SparklesIcon,
  UserIcon,
  MoreHorizontalIcon,
  Search01Icon,
  SidebarLeftIcon,
  StopIcon,
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
import { api, API_URL } from "#/lib/api";

// ============================================
// Route definition with search params
// ============================================

export const Route = createFileRoute("/_authenticated/chat")({
  component: ChatPage,
  validateSearch: (search: Record<string, unknown>) => ({
    conversationId: (search.conversationId as string) || undefined,
  }),
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
// Helpers
// ============================================

/** Convert a server Message to a UIMessage for useChat */
function toUIMessage(msg: Message): UIMessage {
  return {
    id: msg.id,
    role: msg.role,
    parts: [{ type: "text" as const, text: msg.content }],
  };
}

/** Extract plain text content from a UIMessage */
function getTextContent(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/** Normalize date fields on a conversation (guards against non-string values) */
function normalizeConversation(c: Conversation): Conversation {
  return {
    ...c,
    createdAt:
      typeof c.createdAt === "string"
        ? c.createdAt
        : new Date(c.createdAt).toISOString(),
    updatedAt:
      typeof c.updatedAt === "string"
        ? c.updatedAt
        : new Date(c.updatedAt).toISOString(),
  };
}

/** Normalize date fields on a message */
function normalizeMessage(m: Message): Message {
  return {
    ...m,
    createdAt:
      typeof m.createdAt === "string"
        ? m.createdAt
        : new Date(m.createdAt).toISOString(),
  };
}

// ============================================
// Main Chat Page
// ============================================

function ChatPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { conversationId: activeConversationId } = Route.useSearch();

  // Helper to update the URL
  const setActiveConversationId = useCallback(
    (id: string | null) => {
      navigate({
        to: "/chat",
        search: { conversationId: id ?? undefined },
        replace: true,
      });
    },
    [navigate],
  );

  // Input state (useChat v6 has no built-in input management)
  const [inputValue, setInputValue] = useState("");

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
  const [searchQuery, setSearchQuery] = useState("");
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Keep dynamic values in refs so the transport closures always see the latest
  const activeConversationIdRef = useRef(activeConversationId);
  activeConversationIdRef.current = activeConversationId;

  const selectedDocumentIdsRef = useRef(selectedDocumentIds);
  selectedDocumentIdsRef.current = selectedDocumentIds;

  // ============================================
  // useChat with TextStreamChatTransport
  // ============================================

  const chat = useChat({
    transport: useMemo(
      () =>
        new TextStreamChatTransport({
          api: `${API_URL}/chat/conversations/_/messages`,
          headers: (): Record<string, string> => {
            const token = window.__clerk_token;
            if (token) return { Authorization: `Bearer ${token}` };
            return {};
          },
          prepareSendMessagesRequest: ({ messages, headers, credentials }) => {
            const docIds = selectedDocumentIdsRef.current;
            return {
              body: {
                messages: messages.map((m) => ({
                  id: m.id,
                  role: m.role,
                  content: m.parts
                    .filter(
                      (p): p is { type: "text"; text: string } =>
                        p.type === "text",
                    )
                    .map((p) => p.text)
                    .join(""),
                })),
                ...(docIds.length > 0 ? { documentIds: docIds } : {}),
              },
              headers,
              credentials,
              api: `${API_URL}/chat/conversations/${activeConversationIdRef.current}/messages`,
            };
          },
        }),
      [],
    ),
    onFinish: () => {
      // Sync server state after streaming completes
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      if (activeConversationIdRef.current) {
        queryClient.invalidateQueries({
          queryKey: ["messages", activeConversationIdRef.current],
        });
      }
    },
    onError: (error) => {
      console.error("Chat error:", error);
    },
  });

  const isStreaming =
    chat.status === "streaming" || chat.status === "submitted";

  // ============================================
  // Data fetching
  // ============================================

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
    placeholderData: keepPreviousData,
  });

  // Only show loading state on the very first load (no cached data yet)
  const showMessagesLoading = isLoadingMessages;

  // Sync server messages into useChat when they change or conversation switches.
  // We use a ref to track the last synced data and avoid re-calling setMessages
  // when the array reference changes but the data hasn't (which causes infinite loops).
  const lastSyncedRef = useRef<string>("");
  useEffect(() => {
    if (isStreaming) return;
    const key =
      activeConversationId + ":" + serverMessages.map((m) => m.id).join(",");
    if (key === lastSyncedRef.current) return;
    lastSyncedRef.current = key;
    chat.setMessages(serverMessages.map(toUIMessage));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chat.setMessages is stable; including `chat` would loop
  }, [serverMessages, activeConversationId, isStreaming]);

  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, searchQuery]);

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

  // Scroll to bottom on new messages / streaming
  const messageCount = chat.messages.length;
  const lastMessageText =
    chat.messages.length > 0
      ? getTextContent(chat.messages[chat.messages.length - 1])
      : "";
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messageCount, lastMessageText, chat.status]);

  // Track scroll position for scroll-to-bottom button
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      setShowScrollButton(distanceFromBottom > 200);
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

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
      chat.setMessages([]);
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
        chat.setMessages([]);
      }
      setDeleteConversationId(null);
    },
    onError: () => {
      setDeleteConversationId(null);
    },
  });

  // ============================================
  // Send message
  // ============================================

  const handleSendMessage = async () => {
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
          // Update ref immediately so the transport uses the new ID
          activeConversationIdRef.current = conversationId;
          setActiveConversationId(conversationId);
        }
      } catch (err) {
        console.error("Failed to create conversation:", err);
        return;
      }
    }

    if (!conversationId) return;

    const messageText = inputValue.trim();

    // Optimistic auto-title for first message
    if (serverMessages.length === 0 && chat.messages.length === 0) {
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

    setInputValue("");

    // Send via useChat — it handles optimistic user message + streaming
    chat.sendMessage({ text: messageText });
  };

  // ============================================
  // Document scope
  // ============================================

  const toggleDocumentScope = (docId: string) => {
    setSelectedDocumentIds((prev) =>
      prev.includes(docId)
        ? prev.filter((id) => id !== docId)
        : [...prev, docId],
    );
  };

  // ============================================
  // Keep textarea focused after sends / re-renders
  // ============================================

  useEffect(() => {
    inputRef.current?.focus();
  }, [chat.status, activeConversationId]);

  // ============================================
  // Keyboard shortcuts
  // ============================================

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Group conversations by time period
  const groupedConversations = useMemo(() => {
    const groups: { label: string; items: Conversation[] }[] = [];
    const today: Conversation[] = [];
    const yesterday: Conversation[] = [];
    const thisWeek: Conversation[] = [];
    const older: Conversation[] = [];

    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const yesterdayStart = new Date(todayStart.getTime() - 86400000);
    const weekStart = new Date(todayStart.getTime() - 7 * 86400000);

    for (const convo of filteredConversations) {
      const date = new Date(convo.updatedAt);
      if (date >= todayStart) today.push(convo);
      else if (date >= yesterdayStart) yesterday.push(convo);
      else if (date >= weekStart) thisWeek.push(convo);
      else older.push(convo);
    }

    if (today.length > 0) groups.push({ label: "Today", items: today });
    if (yesterday.length > 0)
      groups.push({ label: "Yesterday", items: yesterday });
    if (thisWeek.length > 0)
      groups.push({ label: "This week", items: thisWeek });
    if (older.length > 0) groups.push({ label: "Older", items: older });

    return groups;
  }, [filteredConversations]);

  // ============================================
  // Render
  // ============================================

  return (
    <>
      <title>Chat - Prepify</title>
      <div className="-m-6 flex h-[calc(100vh-3.5rem)] lg:h-screen">
        {/* ==================== SIDEBAR ==================== */}
        <div
          className={cn(
            "flex flex-col border-r border-border bg-muted/30 transition-all duration-200",
            sidebarOpen ? "w-72" : "w-0 overflow-hidden border-r-0",
          )}
        >
          {/* Sidebar header */}
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-3">
            <span className="text-sm font-semibold">Chats</span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => createConversationMutation.mutate()}
              title="New chat"
            >
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            </Button>
          </div>

          {/* Search */}
          <div className="px-3 pt-3 pb-1">
            <div className="relative">
              <HugeiconsIcon
                icon={Search01Icon}
                strokeWidth={2}
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search chats..."
                className="h-7 pl-8 text-xs"
              />
            </div>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {isLoadingConversations ? (
              <div className="flex items-center justify-center py-12">
                <HugeiconsIcon
                  icon={Loading03Icon}
                  strokeWidth={2}
                  className="size-4 animate-spin text-muted-foreground"
                />
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="px-3 py-12 text-center">
                <p className="text-xs text-muted-foreground">
                  {searchQuery ? "No matching chats" : "No conversations yet"}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {groupedConversations.map((group) => (
                  <div key={group.label}>
                    <p className="mb-1 px-2 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground/70">
                      {group.label}
                    </p>
                    <div className="space-y-px">
                      {group.items.map((convo) => (
                        <ConversationItem
                          key={convo.id}
                          convo={convo}
                          isActive={activeConversationId === convo.id}
                          isEditing={editingConversationId === convo.id}
                          editTitle={editTitle}
                          setEditTitle={setEditTitle}
                          onSelect={() => setActiveConversationId(convo.id)}
                          onStartEdit={() => {
                            setEditingConversationId(convo.id);
                            setEditTitle(convo.title);
                          }}
                          onSaveEdit={() =>
                            renameConversationMutation.mutate({
                              id: convo.id,
                              title: editTitle,
                            })
                          }
                          onCancelEdit={() => setEditingConversationId(null)}
                          onDelete={() => setDeleteConversationId(convo.id)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ==================== MAIN CHAT ==================== */}
        <div className="flex flex-1 flex-col">
          {/* Header */}
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
            >
              <HugeiconsIcon icon={SidebarLeftIcon} strokeWidth={2} />
            </Button>

            <div className="h-5 w-px bg-border" />

            <div className="flex-1 min-w-0">
              <h1 className="truncate text-sm font-medium">
                {activeConversationId
                  ? conversations.find((c) => c.id === activeConversationId)
                      ?.title || "Chat"
                  : "New chat"}
              </h1>
            </div>

            {/* Document scope */}
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
                ? `${selectedDocumentIds.length} doc${selectedDocumentIds.length !== 1 ? "s" : ""}`
                : "Add context"}
            </Button>
          </div>

          {/* Document picker */}
          {showDocumentPicker && (
            <div className="border-b border-border bg-muted/20 px-4 py-3">
              <div className="mx-auto max-w-2xl">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    Scope AI responses to specific documents
                  </p>
                  {selectedDocumentIds.length > 0 && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setSelectedDocumentIds([])}
                    >
                      Clear
                    </Button>
                  )}
                </div>
                {documents.length === 0 ? (
                  <p className="text-xs text-muted-foreground/60">
                    No processed documents available.
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
                        className="cursor-pointer select-none text-xs"
                        onClick={() => toggleDocumentScope(doc.id)}
                      >
                        {doc.name}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ==================== MESSAGES ==================== */}
          <div
            ref={messagesContainerRef}
            className="relative flex-1 overflow-y-auto"
          >
            {!activeConversationId && chat.messages.length === 0 ? (
              /* Empty state */
              <div className="flex h-full flex-col items-center justify-center px-4">
                <div className="flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5">
                  <HugeiconsIcon
                    icon={SparklesIcon}
                    strokeWidth={1.5}
                    className="size-8 text-primary"
                  />
                </div>
                <h2 className="mt-5 text-xl font-semibold tracking-tight">
                  How can I help you?
                </h2>
                <p className="mt-2 max-w-md text-center text-sm leading-relaxed text-muted-foreground">
                  Ask questions about your study materials, get explanations, or
                  explore any topic. Your uploaded documents provide context for
                  more accurate answers.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {[
                    "Summarize my notes",
                    "Explain a concept",
                    "Create study questions",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => {
                        setInputValue(suggestion);
                        inputRef.current?.focus();
                      }}
                      className="rounded-full border border-border bg-background px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* Message list */
              <div className="mx-auto max-w-2xl px-4 py-6">
                {showMessagesLoading ? (
                  <div className="flex items-center justify-center py-20">
                    <HugeiconsIcon
                      icon={Loading03Icon}
                      strokeWidth={2}
                      className="size-5 animate-spin text-muted-foreground"
                    />
                  </div>
                ) : (
                  <div className="space-y-6">
                    {chat.messages.map((message, index) => (
                      <ChatMessage
                        key={message.id}
                        message={message}
                        isStreaming={
                          chat.status === "streaming" &&
                          message.role === "assistant" &&
                          index === chat.messages.length - 1
                        }
                      />
                    ))}

                    {/* Typing indicator - before first token arrives */}
                    {chat.status === "submitted" && (
                      <div className="flex gap-4">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                          <HugeiconsIcon
                            icon={SparklesIcon}
                            strokeWidth={2}
                            className="size-3.5 text-primary"
                          />
                        </div>
                        <div className="flex items-center gap-1 pt-1">
                          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:0ms]" />
                          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:150ms]" />
                          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:300ms]" />
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}

            {/* Scroll to bottom button */}
            {showScrollButton && (
              <div className="sticky bottom-4 flex justify-center">
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={scrollToBottom}
                  className="rounded-full shadow-md"
                >
                  <HugeiconsIcon
                    icon={ArrowDown01Icon}
                    strokeWidth={2}
                    className="size-4"
                  />
                </Button>
              </div>
            )}
          </div>

          {/* ==================== INPUT ==================== */}
          <div className="border-t border-border bg-background px-4 pb-4 pt-3">
            <div className="mx-auto max-w-2xl">
              <div className="relative rounded-xl border border-input bg-background shadow-sm transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30 dark:bg-input/15">
                <textarea
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    activeConversationId
                      ? "Message Prepify..."
                      : "Start a new conversation..."
                  }
                  rows={1}
                  className="block w-full resize-none bg-transparent px-4 pt-3 pb-10 text-sm outline-none placeholder:text-muted-foreground"
                  style={
                    {
                      fieldSizing: "content",
                      maxHeight: "10rem",
                    } as React.CSSProperties
                  }
                />
                <div className="absolute bottom-2 right-2 flex items-center gap-1">
                  {isStreaming ? (
                    <Button
                      variant="outline"
                      size="icon-sm"
                      onClick={() => chat.stop()}
                      title="Stop generating"
                      className="rounded-lg"
                    >
                      <HugeiconsIcon
                        icon={StopIcon}
                        strokeWidth={2}
                        className="size-3.5"
                      />
                    </Button>
                  ) : (
                    <Button
                      size="icon-sm"
                      onClick={handleSendMessage}
                      disabled={!inputValue.trim()}
                      title="Send message"
                      className="rounded-lg"
                    >
                      <HugeiconsIcon
                        icon={SentIcon}
                        strokeWidth={2}
                        className="size-3.5"
                      />
                    </Button>
                  )}
                </div>
              </div>
              <p className="mt-2 text-center text-[0.65rem] text-muted-foreground/60">
                AI may produce inaccurate information. Verify important facts.
              </p>
            </div>
          </div>
        </div>

        {/* Delete confirmation */}
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
                messages.
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
    </>
  );
}

// ============================================
// Conversation Sidebar Item
// ============================================

function ConversationItem({
  convo,
  isActive,
  isEditing,
  editTitle,
  setEditTitle,
  onSelect,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
}: {
  convo: Conversation;
  isActive: boolean;
  isEditing: boolean;
  editTitle: string;
  setEditTitle: (title: string) => void;
  onSelect: () => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}) {
  if (isEditing) {
    return (
      <div className="flex items-center gap-1 rounded-lg bg-accent px-2 py-1.5">
        <Input
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSaveEdit();
            else if (e.key === "Escape") onCancelEdit();
          }}
          className="h-6 flex-1 text-xs"
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation();
            onSaveEdit();
          }}
        >
          <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation();
            onCancelEdit();
          }}
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors cursor-pointer",
        isActive
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
      onClick={onSelect}
    >
      <span className="flex-1 truncate text-[0.8rem]">{convo.title}</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => e.stopPropagation()}
            />
          }
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom">
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onStartEdit();
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
  message: UIMessage;
  isStreaming?: boolean;
}) {
  const isUser = message.role === "user";
  const content = getTextContent(message);

  return (
    <div className="flex gap-4">
      {/* Icon */}
      <div
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-lg mt-0.5",
          isUser ? "bg-foreground/8" : "bg-primary/10",
        )}
      >
        {isUser ? (
          <HugeiconsIcon
            icon={UserIcon}
            strokeWidth={2}
            className="size-3.5 text-foreground/70"
          />
        ) : (
          <HugeiconsIcon
            icon={SparklesIcon}
            strokeWidth={2}
            className="size-3.5 text-primary"
          />
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="mb-1 text-xs font-medium text-muted-foreground">
          {isUser ? "You" : "Prepify AI"}
        </p>
        <div className="text-sm leading-relaxed">
          <MessageContent content={content} />
          {isStreaming && (
            <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-primary align-text-bottom" />
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Message Content Renderer
// ============================================

function MessageContent({ content }: { content: string }) {
  const blocks = useMemo(() => parseBlocks(content), [content]);

  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        if (block.type === "code") {
          return (
            <div key={i} className="relative group/code">
              {block.lang && (
                <div className="flex items-center justify-between rounded-t-lg border border-b-0 border-foreground/10 bg-foreground/5 px-3 py-1">
                  <span className="text-[0.65rem] font-medium text-muted-foreground">
                    {block.lang}
                  </span>
                </div>
              )}
              <pre
                className={cn(
                  "overflow-x-auto border border-foreground/10 bg-foreground/[0.03] p-3 text-xs font-mono leading-relaxed",
                  block.lang ? "rounded-b-lg" : "rounded-lg",
                )}
              >
                <code>{block.content}</code>
              </pre>
            </div>
          );
        }

        // Regular text block - render lines
        return (
          <div key={i} className="space-y-1.5">
            {block.lines.map((line, j) => renderLine(line, j))}
          </div>
        );
      })}
    </div>
  );
}

// ============================================
// Markdown parsing helpers
// ============================================

type CodeBlock = { type: "code"; lang?: string; content: string };
type TextBlock = { type: "text"; lines: string[] };
type Block = CodeBlock | TextBlock;

function parseBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  const lines = content.split("\n");
  let currentText: string[] = [];
  let inCode = false;
  let codeLang = "";
  let codeLines: string[] = [];

  for (const line of lines) {
    if (!inCode && line.startsWith("```")) {
      // Flush text
      if (currentText.length > 0) {
        blocks.push({ type: "text", lines: currentText });
        currentText = [];
      }
      inCode = true;
      codeLang = line.slice(3).trim();
      codeLines = [];
    } else if (inCode && line.startsWith("```")) {
      blocks.push({
        type: "code",
        lang: codeLang || undefined,
        content: codeLines.join("\n"),
      });
      inCode = false;
      codeLang = "";
      codeLines = [];
    } else if (inCode) {
      codeLines.push(line);
    } else {
      currentText.push(line);
    }
  }

  // Flush remaining
  if (inCode) {
    // Unclosed code block, render as code anyway
    blocks.push({
      type: "code",
      lang: codeLang || undefined,
      content: codeLines.join("\n"),
    });
  }
  if (currentText.length > 0) {
    blocks.push({ type: "text", lines: currentText });
  }

  return blocks;
}

function renderLine(line: string, key: number): ReactNode {
  // Empty line
  if (!line.trim()) {
    return <div key={key} className="h-1.5" />;
  }

  // Headers
  if (line.startsWith("### ")) {
    return (
      <h4 key={key} className="mt-3 mb-1 text-sm font-semibold">
        {renderInline(line.slice(4))}
      </h4>
    );
  }
  if (line.startsWith("## ")) {
    return (
      <h3 key={key} className="mt-3 mb-1 text-[0.95rem] font-semibold">
        {renderInline(line.slice(3))}
      </h3>
    );
  }
  if (line.startsWith("# ")) {
    return (
      <h2 key={key} className="mt-3 mb-1 text-base font-bold">
        {renderInline(line.slice(2))}
      </h2>
    );
  }

  // Bullet points
  if (line.startsWith("- ") || line.startsWith("* ")) {
    return (
      <div key={key} className="flex gap-2 pl-1">
        <span className="mt-[0.55rem] size-1 shrink-0 rounded-full bg-current opacity-40" />
        <span className="flex-1">{renderInline(line.slice(2))}</span>
      </div>
    );
  }

  // Numbered lists
  const numberedMatch = line.match(/^(\d+)\.\s(.+)/);
  if (numberedMatch) {
    return (
      <div key={key} className="flex gap-2 pl-1">
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {numberedMatch[1]}.
        </span>
        <span className="flex-1">{renderInline(numberedMatch[2])}</span>
      </div>
    );
  }

  // Blockquote
  if (line.startsWith("> ")) {
    return (
      <div
        key={key}
        className="border-l-2 border-primary/30 pl-3 text-muted-foreground italic"
      >
        {renderInline(line.slice(2))}
      </div>
    );
  }

  // Horizontal rule
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
    return <hr key={key} className="my-2 border-border" />;
  }

  // Regular paragraph
  return <p key={key}>{renderInline(line)}</p>;
}

function renderInline(text: string): ReactNode {
  // Match bold, italic, inline code, and links
  const parts = text.split(
    /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g,
  );

  return parts.map((part, i) => {
    // Bold
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    // Italic
    if (part.startsWith("*") && part.endsWith("*") && !part.startsWith("**")) {
      return (
        <em key={i} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    }
    // Inline code
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          className="rounded bg-foreground/[0.06] px-1.5 py-0.5 text-[0.8em] font-mono text-foreground/90"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    // Links
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={i}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2 hover:text-primary/80"
        >
          {linkMatch[1]}
        </a>
      );
    }
    return part;
  });
}
