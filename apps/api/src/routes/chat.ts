import { Elysia, t } from "elysia";
import { eq, and, desc } from "drizzle-orm";
import { streamText } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { db } from "#/db";
import { chatConversations, chatMessages, documents } from "#/db/schema";
import { requireAuth } from "#/middleware/auth";
import { findSimilarChunks, buildContextFromChunks } from "#/lib/similarity";
import { chatLogger } from "#/lib/logger";

type Auth = { userId: string };

// ============================================
// Groq provider for chat (direct, no Effect needed for streaming)
// ============================================

const groq = createGroq({
  apiKey: process.env.GROQ_API_KEY,
});

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

    const conversations = await db.query.chatConversations.findMany({
      where: eq(chatConversations.userId, auth.userId),
      orderBy: [desc(chatConversations.updatedAt)],
    });

    return {
      success: true as const,
      data: conversations,
    };
  })

  // Get a single conversation with its messages
  .get(
    "/conversations/:id",
    async (ctx) => {
      const auth = (ctx as unknown as { auth: Auth }).auth;

      const conversation = await db.query.chatConversations.findFirst({
        where: and(
          eq(chatConversations.id, ctx.params.id),
          eq(chatConversations.userId, auth.userId),
        ),
        with: {
          messages: {
            orderBy: [desc(chatMessages.createdAt)],
          },
        },
      });

      if (!conversation) {
        ctx.set.status = 404;
        return { success: false as const, error: "Conversation not found" };
      }

      // Return messages in chronological order (oldest first)
      return {
        success: true as const,
        data: {
          ...conversation,
          messages: conversation.messages.reverse(),
        },
      };
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

      const [conversation] = await db
        .insert(chatConversations)
        .values({
          userId: auth.userId,
          title: ctx.body.title || "New Conversation",
        })
        .returning();

      return {
        success: true as const,
        data: conversation,
      };
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

      const conversation = await db.query.chatConversations.findFirst({
        where: and(
          eq(chatConversations.id, ctx.params.id),
          eq(chatConversations.userId, auth.userId),
        ),
      });

      if (!conversation) {
        ctx.set.status = 404;
        return { success: false as const, error: "Conversation not found" };
      }

      const [updated] = await db
        .update(chatConversations)
        .set({
          title: ctx.body.title,
          updatedAt: new Date(),
        })
        .where(eq(chatConversations.id, ctx.params.id))
        .returning();

      return {
        success: true as const,
        data: updated,
      };
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

      const conversation = await db.query.chatConversations.findFirst({
        where: and(
          eq(chatConversations.id, ctx.params.id),
          eq(chatConversations.userId, auth.userId),
        ),
      });

      if (!conversation) {
        ctx.set.status = 404;
        return { success: false as const, error: "Conversation not found" };
      }

      await db
        .delete(chatConversations)
        .where(eq(chatConversations.id, ctx.params.id));

      return {
        success: true as const,
        data: { id: ctx.params.id },
      };
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

      // 1. Verify conversation belongs to user
      const conversation = await db.query.chatConversations.findFirst({
        where: and(
          eq(chatConversations.id, ctx.params.id),
          eq(chatConversations.userId, auth.userId),
        ),
      });

      if (!conversation) {
        ctx.set.status = 404;
        return { success: false as const, error: "Conversation not found" };
      }

      // 2. Validate document scope (if provided)
      if (ctx.body.documentIds && ctx.body.documentIds.length > 0) {
        const userDocs = await db.query.documents.findMany({
          where: and(eq(documents.userId, auth.userId)),
          columns: { id: true },
        });
        const userDocIds = new Set(userDocs.map((d) => d.id));
        const invalidIds = ctx.body.documentIds.filter(
          (id) => !userDocIds.has(id),
        );
        if (invalidIds.length > 0) {
          ctx.set.status = 400;
          return {
            success: false as const,
            error: "Some document IDs are invalid",
          };
        }
      }

      // 3. Extract the latest user message from the messages array
      const incomingMessages = ctx.body.messages;
      const lastUserMessage = [...incomingMessages]
        .reverse()
        .find((m) => m.role === "user");

      if (!lastUserMessage) {
        ctx.set.status = 400;
        return { success: false as const, error: "No user message found" };
      }

      const userContent = lastUserMessage.content;

      // 4. Save the user message to the database
      await db
        .insert(chatMessages)
        .values({
          conversationId: ctx.params.id,
          role: "user",
          content: userContent,
        })
        .returning();

      // 5. Update conversation timestamp and auto-title if first message
      const existingMessages = await db.query.chatMessages.findMany({
        where: eq(chatMessages.conversationId, ctx.params.id),
        columns: { id: true },
      });

      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      // Auto-title from first user message (truncate to 60 chars)
      if (existingMessages.length <= 1) {
        const autoTitle =
          userContent.length > 60
            ? userContent.slice(0, 57) + "..."
            : userContent;
        updateData.title = autoTitle;
      }

      await db
        .update(chatConversations)
        .set(updateData)
        .where(eq(chatConversations.id, ctx.params.id));

      // 6. Retrieve RAG context
      let context = "";
      try {
        const similarChunks = await findSimilarChunks(
          userContent,
          auth.userId,
          {
            documentIds: ctx.body.documentIds,
            limit: 8,
            minSimilarity: 0.3,
          },
        );
        context = buildContextFromChunks(similarChunks);
      } catch (error) {
        // RAG failure shouldn't block the chat - just proceed without context
        chatLogger.error(
          { err: error, conversationId: ctx.params.id },
          "RAG retrieval failed",
        );
      }

      // 7. Build messages for the LLM from the incoming messages array
      // useChat sends the full conversation history, so we use it directly
      const llmMessages = incomingMessages.map((msg) => ({
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content,
      }));

      // 8. Stream AI response using the Data Stream protocol (for useChat)
      const result = streamText({
        model: groq("meta-llama/llama-4-scout-17b-16e-instruct"),
        system: buildSystemPrompt(context),
        messages: llmMessages,
        maxOutputTokens: 2048,
        temperature: 0.7,
        onFinish: async ({ text }) => {
          // Save the assistant's response to the DB after streaming completes
          await db.insert(chatMessages).values({
            conversationId: ctx.params.id,
            role: "assistant",
            content: text,
          });

          // Update conversation timestamp
          await db
            .update(chatConversations)
            .set({ updatedAt: new Date() })
            .where(eq(chatConversations.id, ctx.params.id));
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
