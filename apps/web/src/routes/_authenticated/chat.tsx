import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useUser } from "@clerk/clerk-react";
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
import { AnimatePresence, motion } from "motion/react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Menu01Icon,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
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
  const { user } = useUser();
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
  const [isContextDialogOpen, setIsContextDialogOpen] = useState(false);
  const [contextSearchQuery, setContextSearchQuery] = useState("");

  // UI state
  const [editingConversationId, setEditingConversationId] = useState<
    string | null
  >(null);
  const [editTitle, setEditTitle] = useState("");
  const [deleteConversationId, setDeleteConversationId] = useState<
    string | null
  >(null);
  const [conversationPanelOpen, setConversationPanelOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const contextSearchInputRef = useRef<HTMLInputElement>(null);
  const conversationSearchInputRef = useRef<HTMLInputElement>(null);
  const seenMessageIdsRef = useRef<Set<string>>(new Set());

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
          headers: async (): Promise<Record<string, string>> => {
            const token = await window.__clerk_getToken?.();
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

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? null,
    [conversations, activeConversationId],
  );

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

  const filteredDocuments = useMemo(() => {
    const query = contextSearchQuery.trim().toLowerCase();
    if (!query) return documents;
    return documents.filter((doc) => doc.name.toLowerCase().includes(query));
  }, [documents, contextSearchQuery]);

  const selectedDocuments = useMemo(
    () =>
      selectedDocumentIds
        .map((id) => documents.find((doc) => doc.id === id))
        .filter((doc): doc is Document => !!doc),
    [selectedDocumentIds, documents],
  );

  const visibleSelectedDocuments = selectedDocuments.slice(0, 3);
  const hiddenSelectedDocumentCount = Math.max(
    0,
    selectedDocuments.length - visibleSelectedDocuments.length,
  );

  const isContextSearchActive = contextSearchQuery.trim().length > 0;

  const newlySeenMessageIds = useMemo(() => {
    const seen = seenMessageIdsRef.current;
    const next = new Set<string>();
    for (const message of chat.messages) {
      if (!seen.has(message.id)) {
        next.add(message.id);
      }
    }
    return next;
  }, [chat.messages]);

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

  useEffect(() => {
    if (!isContextDialogOpen) return;
    const id = window.setTimeout(() => {
      contextSearchInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [isContextDialogOpen]);

  useEffect(() => {
    if (!conversationPanelOpen) return;
    const id = window.setTimeout(() => {
      conversationSearchInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [conversationPanelOpen]);

  useEffect(() => {
    seenMessageIdsRef.current = new Set();
  }, [activeConversationId]);

  useEffect(() => {
    const seen = seenMessageIdsRef.current;
    for (const message of chat.messages) {
      seen.add(message.id);
    }
  }, [chat.messages]);

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
        const conversation = await createConversationMutation.mutateAsync();
        conversationId = conversation.id;
        // Update ref immediately so the transport uses the new ID
        activeConversationIdRef.current = conversationId;
      } catch {
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

  const renderConversationSidebar = (isMobile: boolean) => (
    <>
      <div className="flex h-12 items-center justify-between px-3">
        <span className="text-sm font-semibold tracking-tight">Chats</span>
        {isMobile ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              setConversationPanelOpen(false);
              if (!editingConversationId) setSearchQuery("");
            }}
            aria-label="Close conversations"
          >
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => createConversationMutation.mutate()}
            title="New chat"
          >
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          </Button>
        )}
      </div>

      <div className="space-y-2 px-3 py-3">
        {isMobile && (
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start"
            onClick={() => {
              createConversationMutation.mutate();
              setConversationPanelOpen(false);
              setSearchQuery("");
            }}
          >
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            New chat
          </Button>
        )}

        <div className="relative">
          <HugeiconsIcon
            icon={Search01Icon}
            strokeWidth={2}
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={isMobile ? conversationSearchInputRef : undefined}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search chats..."
            className="h-8 rounded-lg pl-8 text-xs"
          />
        </div>
      </div>

      <div className="chat-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {isLoadingConversations ? (
          <div className="flex items-center justify-center py-8">
            <HugeiconsIcon
              icon={Loading03Icon}
              strokeWidth={2}
              className="size-4 animate-spin text-muted-foreground"
            />
          </div>
        ) : filteredConversations.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-5 text-center">
            <p className="text-xs text-muted-foreground">
              {searchQuery ? "No matching chats" : "No conversations yet"}
            </p>
          </div>
        ) : (
          groupedConversations.map((group) => (
            <div key={group.label}>
              <p className="mb-1 px-1 text-[0.65rem] font-medium uppercase tracking-[0.12em] text-muted-foreground/75">
                {group.label}
              </p>
              <div className="space-y-1">
                {group.items.map((convo) => (
                  <ConversationItem
                    key={convo.id}
                    convo={convo}
                    isActive={activeConversationId === convo.id}
                    isEditing={editingConversationId === convo.id}
                    editTitle={editTitle}
                    setEditTitle={setEditTitle}
                    onSelect={() => {
                      setActiveConversationId(convo.id);
                      if (isMobile) {
                        setConversationPanelOpen(false);
                        setSearchQuery("");
                      }
                    }}
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
          ))
        )}
      </div>
    </>
  );

  return (
    <>
      <title>Chat - Prepify</title>
      <div className="relative flex h-full min-h-0 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.08),transparent_46%),hsl(var(--background))]">
        <aside className="hidden w-80 shrink-0 border-r border-border/70 bg-background/85 backdrop-blur md:flex md:flex-col">
          {renderConversationSidebar(false)}
        </aside>

        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background/80 px-2 sm:px-4">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setConversationPanelOpen(true)}
              className="rounded-lg md:hidden"
              title="Open conversations"
            >
              <HugeiconsIcon icon={Menu01Icon} strokeWidth={2} />
            </Button>

            <p className="min-w-0 flex-1 truncate text-sm font-medium tracking-tight">
              {activeConversation?.title ?? "New chat"}
            </p>

            {selectedDocumentIds.length > 0 ? (
              <Badge variant="secondary" className="h-5 text-[0.65rem]">
                {selectedDocumentIds.length} context
              </Badge>
            ) : (
              <p className="hidden text-[0.68rem] text-muted-foreground sm:block">
                No context files
              </p>
            )}
          </div>

          <AnimatePresence>
            {conversationPanelOpen && (
              <motion.div
                className="absolute inset-0 z-30 md:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <button
                  type="button"
                  className="absolute inset-0 bg-black/25"
                  onClick={() => {
                    setConversationPanelOpen(false);
                    if (!editingConversationId) setSearchQuery("");
                  }}
                  aria-label="Close conversations panel"
                />
                <motion.aside
                  className="absolute left-0 top-0 flex h-full w-[min(22rem,92vw)] flex-col border-r border-border/70 bg-background shadow-xl"
                  initial={{ x: "-100%" }}
                  animate={{ x: 0 }}
                  exit={{ x: "-100%" }}
                  transition={{
                    type: "spring",
                    stiffness: 320,
                    damping: 34,
                    mass: 0.9,
                  }}
                >
                  {renderConversationSidebar(true)}
                </motion.aside>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex min-h-0 flex-1 flex-col">
            <div
              ref={messagesContainerRef}
              className="chat-scroll relative min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5 lg:px-8"
            >
            {!activeConversationId && chat.messages.length === 0 ? (
              <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-primary/12">
                  <HugeiconsIcon
                    icon={SparklesIcon}
                    strokeWidth={1.8}
                    className="size-5 text-primary"
                  />
                </div>
                <h2 className="mt-4 text-xl font-semibold tracking-tight">
                  Ask anything
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Ask about your study materials or general topics. Add context
                  files for more precise answers.
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
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
                      className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto w-full max-w-3xl space-y-4 xl:max-w-4xl">
                {showMessagesLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <HugeiconsIcon
                      icon={Loading03Icon}
                      strokeWidth={2}
                      className="size-5 animate-spin text-muted-foreground"
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <AnimatePresence initial={false}>
                      {chat.messages.map((message, index) => (
                      <ChatMessage
                        key={message.id}
                        message={message}
                        userAvatarUrl={user?.imageUrl}
                        shouldAnimate={
                          isStreaming && newlySeenMessageIds.has(message.id)
                        }
                        isStreaming={
                          chat.status === "streaming" &&
                          message.role === "assistant" &&
                            index === chat.messages.length - 1
                          }
                        />
                      ))}
                    </AnimatePresence>

                    <AnimatePresence>
                      {chat.status === "submitted" && (
                        <motion.div
                          className="flex items-center gap-2 py-2"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 4 }}
                          transition={{ duration: 0.2 }}
                        >
                          <div className="flex size-8 items-center justify-center rounded-full bg-primary/12">
                            <HugeiconsIcon
                              icon={SparklesIcon}
                              strokeWidth={2}
                              className="size-3.5 text-primary"
                            />
                          </div>
                          <div className="flex items-center gap-1">
                            {[0, 1, 2].map((i) => (
                              <motion.span
                                key={i}
                                className="size-1.5 rounded-full bg-muted-foreground/55"
                                animate={{
                                  y: [0, -3, 0],
                                  opacity: [0.35, 1, 0.35],
                                }}
                                transition={{
                                  duration: 0.9,
                                  repeat: Infinity,
                                  ease: "easeInOut",
                                  delay: i * 0.12,
                                }}
                              />
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}

            {showScrollButton && (
              <div className="sticky bottom-3 flex justify-center">
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={scrollToBottom}
                  className="rounded-full bg-background/95"
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

          <div className="bg-background/90 px-3 pb-3 pt-3 sm:px-4 sm:pb-4 lg:px-6">
              <div className="mx-auto w-full max-w-3xl xl:max-w-4xl">
                <div className="chat-composer-shell relative rounded-2xl border border-border/70 bg-background/95 shadow-[0_8px_24px_-18px_rgba(0,0,0,0.5)] transition-all duration-200 focus-within:border-primary/40 focus-within:shadow-[0_14px_30px_-18px_hsl(var(--primary)/0.55)] focus-within:ring-2 focus-within:ring-primary/20">
                {selectedDocuments.length > 0 && (
                  <div className="mb-1 flex flex-wrap items-center gap-1 border-b border-border px-3 pt-3 pb-2">
                    {visibleSelectedDocuments.map((doc) => (
                      <div
                        key={doc.id}
                        className="inline-flex h-6 max-w-[14rem] items-center gap-1 rounded-full bg-muted/45 px-2 text-[0.7rem]"
                      >
                        <span className="truncate">{doc.name}</span>
                        <button
                          type="button"
                          className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                          onClick={() => toggleDocumentScope(doc.id)}
                          aria-label={`Remove ${doc.name} from context`}
                        >
                          <HugeiconsIcon
                            icon={Cancel01Icon}
                            strokeWidth={2}
                            className="size-3"
                          />
                        </button>
                      </div>
                    ))}
                    {hiddenSelectedDocumentCount > 0 && (
                      <Badge variant="outline" className="h-6 text-[0.7rem]">
                        +{hiddenSelectedDocumentCount}
                      </Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setSelectedDocumentIds([])}
                      className="ml-auto h-6 rounded-md text-[0.68rem] text-muted-foreground"
                    >
                      Clear
                    </Button>
                  </div>
                )}

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
                  rows={3}
                  className="block w-full resize-none bg-transparent px-5 pt-4 pb-16 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/85"
                  style={
                    {
                      fieldSizing: "content",
                      maxHeight: "18rem",
                    } as React.CSSProperties
                  }
                />

                <div className="absolute bottom-2 left-2 flex items-center gap-1">
                  <Button
                    variant={
                      selectedDocumentIds.length > 0 ? "secondary" : "outline"
                    }
                    size="xs"
                    onClick={() => setIsContextDialogOpen(true)}
                    aria-label="Add document context"
                  >
                    <HugeiconsIcon
                      icon={FileAttachmentIcon}
                      strokeWidth={2}
                      className="size-3.5"
                    />
                    Context
                    {selectedDocumentIds.length > 0 && (
                      <Badge
                        variant="outline"
                        className="h-4 px-1 text-[0.62rem]"
                      >
                        {selectedDocumentIds.length}
                      </Badge>
                    )}
                  </Button>
                </div>

                <div className="absolute bottom-2 right-2 flex items-center gap-1">
                  {isStreaming ? (
                    <Button
                      variant="outline"
                      size="icon-sm"
                      onClick={() => chat.stop()}
                      title="Stop generating"
                    >
                      <HugeiconsIcon
                        icon={StopIcon}
                        strokeWidth={2}
                        className="size-3.5"
                      />
                    </Button>
                  ) : (
                    <Button
                      size="icon"
                      onClick={handleSendMessage}
                      disabled={!inputValue.trim()}
                      title="Send message"
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
                <p className="mt-1 hidden text-center text-[0.65rem] text-muted-foreground/75 sm:block">
                  AI may produce inaccurate information. Verify important facts.
                </p>
              </div>
            </div>
          </div>
        </div>

        <Dialog
          open={isContextDialogOpen}
          onOpenChange={(open) => {
            setIsContextDialogOpen(open);
            if (!open) setContextSearchQuery("");
          }}
        >
          <DialogContent className="max-h-[min(88vh,46rem)] overflow-hidden p-0 sm:max-w-2xl">
            <DialogHeader className="border-b border-border/70 px-5 pt-5 pb-4">
              <DialogTitle className="tracking-tight">Add context</DialogTitle>
              <DialogDescription className="text-xs">
                Select processed files to scope AI responses for this
                conversation.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 px-5 py-4">
              <Input
                ref={contextSearchInputRef}
                value={contextSearchQuery}
                onChange={(e) => setContextSearchQuery(e.target.value)}
                placeholder="Search processed files..."
                className="h-9 rounded-xl border-border/70 bg-background"
              />

              {documents.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/80 bg-muted/30 px-4 py-7 text-center">
                  <p className="text-sm font-medium">No processed files yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Upload documents in the Documents page and wait until
                    processing completes.
                  </p>
                </div>
              ) : filteredDocuments.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/80 bg-muted/30 px-4 py-7 text-center">
                  <p className="text-sm font-medium">No matching files</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Try a different search term.
                  </p>
                </div>
              ) : (
                <div className="chat-scroll max-h-[22rem] space-y-1 overflow-y-auto pr-1">
                  {filteredDocuments.map((doc) => {
                    const isSelected = selectedDocumentIds.includes(doc.id);
                    return (
                      <button
                        key={doc.id}
                        type="button"
                        onClick={() => toggleDocumentScope(doc.id)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-all",
                          isSelected
                            ? "border-primary/40 bg-primary/[0.08] shadow-[0_8px_22px_-18px_hsl(var(--primary))]"
                            : "border-border/70 bg-background hover:border-border hover:bg-muted/40",
                        )}
                      >
                        <div
                          className={cn(
                            "flex size-8 items-center justify-center rounded-lg",
                            isSelected ? "bg-primary/15" : "bg-muted/70",
                          )}
                        >
                          <HugeiconsIcon
                            icon={FileAttachmentIcon}
                            strokeWidth={2}
                            className={cn(
                              "size-3.5",
                              isSelected
                                ? "text-primary"
                                : "text-muted-foreground",
                            )}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {doc.name}
                          </p>
                          <p className="text-[0.68rem] uppercase tracking-[0.12em] text-muted-foreground/75">
                            {doc.type}
                          </p>
                        </div>
                        {isSelected && (
                          <Badge
                            variant="secondary"
                            className="h-5 rounded-full text-[0.65rem]"
                          >
                            Selected
                          </Badge>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-border/70 bg-muted/25 px-5 py-3">
              <p className="text-xs text-muted-foreground">
                {selectedDocumentIds.length > 0
                  ? `${selectedDocumentIds.length} file${selectedDocumentIds.length === 1 ? "" : "s"} selected`
                  : isContextSearchActive
                    ? `${filteredDocuments.length} matching file${filteredDocuments.length === 1 ? "" : "s"}`
                    : `${documents.length} processed file${documents.length === 1 ? "" : "s"} available`}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedDocumentIds([])}
                  disabled={selectedDocumentIds.length === 0}
                >
                  Clear all
                </Button>
                <Button
                  size="sm"
                  onClick={() => setIsContextDialogOpen(false)}
                  className="rounded-lg"
                >
                  Done
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

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
      <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 px-1.5 py-1">
        <Input
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSaveEdit();
            else if (e.key === "Escape") onCancelEdit();
          }}
          className="h-6 flex-1 border-border/70 bg-background text-xs"
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
        "group flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-sm transition-colors",
        isActive
          ? "border-border bg-accent/60 text-foreground"
          : "border-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/40 hover:text-foreground",
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
  userAvatarUrl,
  shouldAnimate = false,
  isStreaming = false,
}: {
  message: UIMessage;
  userAvatarUrl?: string;
  shouldAnimate?: boolean;
  isStreaming?: boolean;
}) {
  const isUser = message.role === "user";
  const content = getTextContent(message);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const showAvatar = isUser && !!userAvatarUrl && !avatarFailed;

  return (
    <motion.div
      className="flex gap-3 py-2.5"
      layout="position"
      initial={shouldAnimate ? { opacity: 0, y: 10, scale: 0.995 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8 }}
      transition={
        shouldAnimate
          ? {
              duration: 0.24,
              ease: [0.22, 1, 0.36, 1],
            }
          : { duration: 0 }
      }
    >
      {/* Icon */}
      <div
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full",
          isUser ? "bg-muted" : "bg-primary/10",
        )}
      >
        {showAvatar ? (
          <img
            src={userAvatarUrl}
            alt="Your profile avatar"
            className="size-full object-cover"
            onError={() => setAvatarFailed(true)}
          />
        ) : (
          <>
            {isUser ? (
              <HugeiconsIcon
                icon={UserIcon}
                strokeWidth={2}
                className="size-3.5 text-foreground/75"
              />
            ) : (
              <HugeiconsIcon
                icon={SparklesIcon}
                strokeWidth={2}
                className="size-3.5 text-primary"
              />
            )}
          </>
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">
          {isUser ? "You" : "Prepify AI"}
        </p>
        <div className="text-sm leading-relaxed">
          <MessageContent content={content} />
          {isStreaming && (
            <motion.span
              className="ml-0.5 inline-block h-4 w-0.5 bg-primary align-text-bottom"
              animate={{ opacity: [0.25, 1, 0.25] }}
              transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
        </div>
      </div>
    </motion.div>
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
