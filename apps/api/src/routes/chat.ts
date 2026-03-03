import { Elysia, t } from "elysia";
import { Effect } from "effect";
import { eq, and, desc } from "drizzle-orm";
import { streamText } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { db } from "#/db";
import { chatConversations, chatMessages, documents } from "#/db/schema";
import { requireAuth } from "#/middleware/auth";
import { findSimilarChunks, buildContextFromChunks } from "#/lib/similarity";
import { chatLogger } from "#/lib/logger";
import { env } from "#/lib/env";
import { DatabaseError, NotFoundError, ValidationError } from "#/lib/errors";
import { effectHandler } from "#/services/runtime";

type Auth = { userId: string };

// ============================================
// Groq provider for chat (direct, no Effect needed for streaming)
// ============================================

const groq = createGroq({
  apiKey: env().ai.groqApiKey,
});

// ============================================
// DB helpers wrapped in Effect
// ============================================

const queryConversations = (userId: string) =>
  Effect.tryPromise({
    try: () =>
      db.query.chatConversations.findMany({
        where: eq(chatConversations.userId, userId),
        orderBy: [desc(chatConversations.updatedAt)],
      }),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to query conversations", cause }),
  });

const findConversation = (conversationId: string, userId: string) =>
  Effect.tryPromise({
    try: () =>
      db.query.chatConversations.findFirst({
        where: and(
          eq(chatConversations.id, conversationId),
          eq(chatConversations.userId, userId),
        ),
      }),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to find conversation", cause }),
  });

const findConversationWithMessages = (conversationId: string, userId: string) =>
  Effect.tryPromise({
    try: () =>
      db.query.chatConversations.findFirst({
        where: and(
          eq(chatConversations.id, conversationId),
          eq(chatConversations.userId, userId),
        ),
        with: {
          messages: {
            orderBy: [desc(chatMessages.createdAt)],
          },
        },
      }),
    catch: (cause) =>
      new DatabaseError({
        message: "Failed to find conversation with messages",
        cause,
      }),
  });

const insertConversation = (userId: string, title: string) =>
  Effect.tryPromise({
    try: () =>
      db.insert(chatConversations).values({ userId, title }).returning(),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to create conversation", cause }),
  });

const updateConversation = (
  conversationId: string,
  data: Record<string, unknown>,
) =>
  Effect.tryPromise({
    try: () =>
      db
        .update(chatConversations)
        .set(data)
        .where(eq(chatConversations.id, conversationId))
        .returning(),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to update conversation", cause }),
  });

const deleteConversation = (conversationId: string) =>
  Effect.tryPromise({
    try: () =>
      db
        .delete(chatConversations)
        .where(eq(chatConversations.id, conversationId)),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to delete conversation", cause }),
  });

const insertChatMessage = (
  conversationId: string,
  role: "user" | "assistant" | "system",
  content: string,
) =>
  Effect.tryPromise({
    try: () =>
      db
        .insert(chatMessages)
        .values({ conversationId, role, content })
        .returning(),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to insert chat message", cause }),
  });

const queryUserDocumentIds = (userId: string) =>
  Effect.tryPromise({
    try: () =>
      db.query.documents.findMany({
        where: eq(documents.userId, userId),
        columns: { id: true },
      }),
    catch: (cause) =>
      new DatabaseError({ message: "Failed to query user documents", cause }),
  });

const countConversationMessages = (conversationId: string) =>
  Effect.tryPromise({
    try: () =>
      db.query.chatMessages.findMany({
        where: eq(chatMessages.conversationId, conversationId),
        columns: { id: true },
      }),
    catch: (cause) =>
      new DatabaseError({
        message: "Failed to count conversation messages",
        cause,
      }),
  });

// ============================================
// RAG retrieval wrapped in Effect (non-fatal)
// ============================================

const retrieveRagContext = (
  userContent: string,
  userId: string,
  documentIds?: string[],
) =>
  Effect.tryPromise({
    try: () =>
      findSimilarChunks(userContent, userId, {
        documentIds,
        limit: 8,
        minSimilarity: 0.3,
      }),
    catch: (cause) => cause,
  }).pipe(
    Effect.map((chunks) => buildContextFromChunks(chunks)),
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        yield* Effect.logWarning(
          "RAG retrieval failed, proceeding without context",
        ).pipe(Effect.annotateLogs("error", String(error)));
        return "";
      }),
    ),
  );

// ============================================
// System prompt builder
// ============================================

function buildSystemPrompt(context: string): string {
  const base = `You are Prepify AI, a helpful and knowledgeable study assistant. Your role is to help students understand their study materials, answer questions, explain concepts, and support their learning.

Guidelines:
- Be clear, concise, and educational in your responses
- When referencing study materials, cite the source numbers provided in the context
- If you don't have relevant context from the user's documents, say so honestly but still try to help with general knowledge
- Use formatting (headers, bullet points, numbered lists) to make explanations easy to follow
- Encourage deeper thinking by asking follow-up questions when appropriate`;

  if (context) {
    return `${base}

The following are relevant excerpts from the student's study materials. Use them to provide accurate, contextual answers:

${context}`;
  }

  return base;
}

// ============================================
// Chat Routes
// ============================================

export const chatRoutes = new Elysia({ prefix: "/chat" })
  .use(requireAuth)

  // List conversations for current user
  .get("/conversations", async (ctx) => {
    const auth = (ctx as unknown as { auth: Auth }).auth;

    return effectHandler(
      ctx,
      Effect.gen(function* () {
        const conversations = yield* queryConversations(auth.userId);
        return { success: true as const, data: conversations };
      }),
    );
  })

  // Get a single conversation with its messages
  .get(
    "/conversations/:id",
    async (ctx) => {
      const auth = (ctx as unknown as { auth: Auth }).auth;

      return effectHandler(
        ctx,
        Effect.gen(function* () {
          const conversation = yield* findConversationWithMessages(
            ctx.params.id,
            auth.userId,
          );

          if (!conversation) {
            return yield* new NotFoundError({
              entity: "Conversation",
              id: ctx.params.id,
            });
          }

          // Return messages in chronological order (oldest first)
          return {
            success: true as const,
            data: {
              ...conversation,
              messages: conversation.messages.reverse(),
            },
          };
        }),
      );
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Create a new conversation
  .post(
    "/conversations",
    async (ctx) => {
      const auth = (ctx as unknown as { auth: Auth }).auth;

      return effectHandler(
        ctx,
        Effect.gen(function* () {
          const title = ctx.body.title || "New Conversation";
          const results = yield* insertConversation(auth.userId, title);
          const conversation = results[0]!;

          yield* Effect.logInfo("Conversation created").pipe(
            Effect.annotateLogs("conversationId", conversation.id),
          );

          return { success: true as const, data: conversation };
        }),
      );
    },
    {
      body: t.Object({
        title: t.Optional(t.String({ maxLength: 255 })),
      }),
    },
  )

  // Update conversation title
  .patch(
    "/conversations/:id",
    async (ctx) => {
      const auth = (ctx as unknown as { auth: Auth }).auth;

      return effectHandler(
        ctx,
        Effect.gen(function* () {
          const conversation = yield* findConversation(
            ctx.params.id,
            auth.userId,
          );

          if (!conversation) {
            return yield* new NotFoundError({
              entity: "Conversation",
              id: ctx.params.id,
            });
          }

          const results = yield* updateConversation(ctx.params.id, {
            title: ctx.body.title,
            updatedAt: new Date(),
          });
          const updated = results[0]!;

          yield* Effect.logInfo("Conversation renamed").pipe(
            Effect.annotateLogs("conversationId", ctx.params.id),
          );

          return { success: true as const, data: updated };
        }),
      );
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        title: t.String({ minLength: 1, maxLength: 255 }),
      }),
    },
  )

  // Delete a conversation (cascades to messages)
  .delete(
    "/conversations/:id",
    async (ctx) => {
      const auth = (ctx as unknown as { auth: Auth }).auth;

      return effectHandler(
        ctx,
        Effect.gen(function* () {
          const conversation = yield* findConversation(
            ctx.params.id,
            auth.userId,
          );

          if (!conversation) {
            return yield* new NotFoundError({
              entity: "Conversation",
              id: ctx.params.id,
            });
          }

          yield* deleteConversation(ctx.params.id);

          yield* Effect.logInfo("Conversation deleted").pipe(
            Effect.annotateLogs("conversationId", ctx.params.id),
          );

          return { success: true as const, data: { id: ctx.params.id } };
        }),
      );
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Send a message and get a streaming AI response
  // Accepts the `useChat` protocol: { messages: [...], documentIds?: [...] }
  .post(
    "/conversations/:id/messages",
    async (ctx) => {
      const auth = (ctx as unknown as { auth: Auth }).auth;

      // Pre-stream work runs through Effect to get proper error handling.
      // If any pre-stream step fails, effectHandler returns an error response.
      // On success, we get the data needed to start the stream.
      const preStreamResult = await effectHandler(
        ctx,
        Effect.gen(function* () {
          // 1. Verify conversation belongs to user
          const conversation = yield* findConversation(
            ctx.params.id,
            auth.userId,
          );

          if (!conversation) {
            return yield* new NotFoundError({
              entity: "Conversation",
              id: ctx.params.id,
            });
          }

          // 2. Validate document scope (if provided)
          if (ctx.body.documentIds && ctx.body.documentIds.length > 0) {
            const userDocs = yield* queryUserDocumentIds(auth.userId);
            const userDocIds = new Set(userDocs.map((d) => d.id));
            const invalidIds = ctx.body.documentIds.filter(
              (id) => !userDocIds.has(id),
            );
            if (invalidIds.length > 0) {
              return yield* new ValidationError({
                message: "Some document IDs are invalid",
                field: "documentIds",
              });
            }
          }

          // 3. Extract the latest user message
          const incomingMessages = ctx.body.messages;
          const lastUserMessage = [...incomingMessages]
            .reverse()
            .find((m) => m.role === "user");

          if (!lastUserMessage) {
            return yield* new ValidationError({
              message: "No user message found",
              field: "messages",
            });
          }

          const userContent = lastUserMessage.content;

          // 4. Save the user message to the database
          yield* insertChatMessage(ctx.params.id, "user", userContent);

          // 5. Update conversation timestamp and auto-title if first message
          const existingMessages = yield* countConversationMessages(
            ctx.params.id,
          );

          const updateData: Record<string, unknown> = {
            updatedAt: new Date(),
          };

          if (existingMessages.length <= 1) {
            const autoTitle =
              userContent.length > 60
                ? userContent.slice(0, 57) + "..."
                : userContent;
            updateData.title = autoTitle;
          }

          yield* updateConversation(ctx.params.id, updateData);

          // 6. Retrieve RAG context (non-fatal — falls back to empty string)
          const context = yield* retrieveRagContext(
            userContent,
            auth.userId,
            ctx.body.documentIds,
          );

          yield* Effect.logDebug("Chat pre-stream complete").pipe(
            Effect.annotateLogs("conversationId", ctx.params.id),
            Effect.annotateLogs(
              "hasContext",
              context.length > 0 ? "true" : "false",
            ),
          );

          // Return data needed for streaming
          return {
            _ok: true as const,
            context,
            llmMessages: incomingMessages.map((msg) => ({
              role: msg.role as "user" | "assistant" | "system",
              content: msg.content,
            })),
          };
        }),
      );

      // If pre-stream failed, effectHandler already set ctx.set.status and
      // returned an error body — just return it as the response.
      if (!preStreamResult || !("_ok" in preStreamResult)) {
        return preStreamResult;
      }

      // 7. Stream AI response using the Data Stream protocol (for useChat)
      const { context, llmMessages } = preStreamResult;

      const result = streamText({
        model: groq("meta-llama/llama-4-scout-17b-16e-instruct"),
        system: buildSystemPrompt(context),
        messages: llmMessages,
        maxOutputTokens: 2048,
        temperature: 0.7,
        onFinish: async ({ text }) => {
          // Save the assistant's response and update timestamp.
          // This runs after the stream closes — errors here won't affect the
          // client response, so we log them instead of throwing.
          try {
            await db.insert(chatMessages).values({
              conversationId: ctx.params.id,
              role: "assistant",
              content: text,
            });

            await db
              .update(chatConversations)
              .set({ updatedAt: new Date() })
              .where(eq(chatConversations.id, ctx.params.id));
          } catch (error) {
            chatLogger.error(
              { err: error, conversationId: ctx.params.id },
              "Failed to save assistant message after stream",
            );
          }
        },
      });

      // Return a plain text stream response (compatible with TextStreamChatTransport on the frontend)
      return result.toTextStreamResponse();
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        messages: t.Array(
          t.Object({
            role: t.String(),
            content: t.String(),
            id: t.Optional(t.String()),
          }),
        ),
        documentIds: t.Optional(t.Array(t.String())),
      }),
    },
  );
