import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  real,
  index,
  uniqueIndex,
  serial,
  varchar,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { vector } from "drizzle-orm/pg-core";
import type {
  McqOption,
  AiGradingResult,
  ExamResultFeedback,
} from "@repo/shared";

// ============================================
// Enums
// ============================================

export const documentStatusEnum = pgEnum("document_status", [
  "pending",
  "processing",
  "ready",
  "failed",
]);

export const documentTypeEnum = pgEnum("document_type", [
  "pdf",
  "image",
  "text",
]);

export const examTypeEnum = pgEnum("exam_type", ["mcq", "written", "mixed"]);

export const examStatusEnum = pgEnum("exam_status", [
  "draft",
  "active",
  "completed",
]);

export const examContextSourceEnum = pgEnum("exam_context_source", [
  "uploaded",
  "global",
  "both",
]);

export const examDurationModeEnum = pgEnum("exam_duration_mode", [
  "user_set",
  "ai_decided",
]);

export const questionTypeEnum = pgEnum("question_type", ["mcq", "written"]);

export const examSessionStatusEnum = pgEnum("exam_session_status", [
  "in_progress",
  "submitted",
  "timed_out",
]);

export const flashcardDifficultyEnum = pgEnum("flashcard_difficulty", [
  "easy",
  "medium",
  "hard",
]);

export const chatRoleEnum = pgEnum("chat_role", [
  "user",
  "assistant",
  "system",
]);

// ============================================
// Users (synced from Clerk)
// ============================================

export const users = pgTable(
  "users",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    clerkId: text("clerk_id").notNull().unique(),
    email: text("email").notNull(),
    name: text("name"),
    avatar: text("avatar"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("users_clerk_id_idx").on(table.clerkId)],
);

// ============================================
// Folders (file manager grouping)
// ============================================

export const folders = pgTable(
  "folders",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    parentId: text("parent_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("folders_user_id_idx").on(table.userId),
    index("folders_parent_id_idx").on(table.parentId),
  ],
);

// ============================================
// Documents (uploaded files)
// ============================================

export const documents = pgTable(
  "documents",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    folderId: text("folder_id").references(() => folders.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    type: documentTypeEnum("type").notNull(),
    mimeType: text("mime_type"),
    fileSize: integer("file_size"),
    s3Key: text("s3_key").notNull(),
    s3Url: text("s3_url").notNull(),
    status: documentStatusEnum("status").notNull().default("pending"),
    pageCount: integer("page_count"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("documents_user_id_idx").on(table.userId),
    index("documents_folder_id_idx").on(table.folderId),
    index("documents_status_idx").on(table.status),
  ],
);

// ============================================
// Document Chunks (parsed text with embeddings)
// ============================================

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }),
    chunkIndex: integer("chunk_index").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("document_chunks_document_id_idx").on(table.documentId),
    index("document_chunks_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
  ],
);

// ============================================
// Exams
// ============================================

export const exams = pgTable(
  "exams",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    topic: text("topic").notNull(),
    type: examTypeEnum("type").notNull(),
    questionCount: integer("question_count").notNull().default(10),
    durationMinutes: integer("duration_minutes"),
    durationMode: examDurationModeEnum("duration_mode")
      .notNull()
      .default("user_set"),
    status: examStatusEnum("status").notNull().default("draft"),
    contextSource: examContextSourceEnum("context_source")
      .notNull()
      .default("both"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("exams_user_id_idx").on(table.userId),
    index("exams_status_idx").on(table.status),
  ],
);

// ============================================
// Exam Documents (M2M: exams <-> documents)
// ============================================

export const examDocuments = pgTable(
  "exam_documents",
  {
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("exam_documents_exam_id_idx").on(table.examId),
    index("exam_documents_document_id_idx").on(table.documentId),
  ],
);

// ============================================
// Questions
// ============================================

export const questions = pgTable(
  "questions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    type: questionTypeEnum("type").notNull(),
    content: text("content").notNull(),
    options: jsonb("options").$type<McqOption[]>(),
    correctAnswer: text("correct_answer").notNull(),
    explanation: text("explanation"),
    points: integer("points").notNull().default(1),
    orderIndex: integer("order_index").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("questions_exam_id_idx").on(table.examId),
    index("questions_order_idx").on(table.examId, table.orderIndex),
  ],
);

// ============================================
// Exam Sessions (active attempts)
// ============================================

export const examSessions = pgTable(
  "exam_sessions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    status: examSessionStatusEnum("status").notNull().default("in_progress"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("exam_sessions_exam_id_idx").on(table.examId),
    index("exam_sessions_user_id_idx").on(table.userId),
    index("exam_sessions_status_idx").on(table.status),
  ],
);

// ============================================
// Answers
// ============================================

export const answers = pgTable(
  "answers",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sessionId: text("session_id")
      .notNull()
      .references(() => examSessions.id, { onDelete: "cascade" }),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    userAnswer: text("user_answer"),
    isCorrect: boolean("is_correct"),
    score: real("score"),
    aiGrading: jsonb("ai_grading").$type<AiGradingResult>(),
    answeredAt: timestamp("answered_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("answers_session_id_idx").on(table.sessionId),
    index("answers_question_id_idx").on(table.questionId),
  ],
);

// ============================================
// Results
// ============================================

export const results = pgTable(
  "results",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sessionId: text("session_id")
      .notNull()
      .references(() => examSessions.id, { onDelete: "cascade" })
      .unique(),
    totalScore: real("total_score").notNull(),
    maxScore: real("max_score").notNull(),
    percentage: real("percentage").notNull(),
    feedback: jsonb("feedback").$type<ExamResultFeedback>(),
    completedAt: timestamp("completed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("results_session_id_idx").on(table.sessionId)],
);

// ============================================
// Flashcard Decks
// ============================================

export const flashcardDecks = pgTable(
  "flashcard_decks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    topic: text("topic").notNull(),
    description: text("description"),
    cardCount: integer("card_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("flashcard_decks_user_id_idx").on(table.userId)],
);

// ============================================
// Flashcard Deck Documents (M2M)
// ============================================

export const flashcardDeckDocuments = pgTable(
  "flashcard_deck_documents",
  {
    deckId: text("deck_id")
      .notNull()
      .references(() => flashcardDecks.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("flashcard_deck_documents_deck_id_idx").on(table.deckId),
    index("flashcard_deck_documents_document_id_idx").on(table.documentId),
  ],
);

// ============================================
// Flashcards (with SM-2 spaced repetition)
// ============================================

export const flashcards = pgTable(
  "flashcards",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    deckId: text("deck_id")
      .notNull()
      .references(() => flashcardDecks.id, { onDelete: "cascade" }),
    front: text("front").notNull(),
    back: text("back").notNull(),
    difficulty: flashcardDifficultyEnum("difficulty")
      .notNull()
      .default("medium"),
    nextReviewAt: timestamp("next_review_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    interval: real("interval").notNull().default(1),
    easeFactor: real("ease_factor").notNull().default(2.5),
    repetitions: integer("repetitions").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("flashcards_deck_id_idx").on(table.deckId),
    index("flashcards_next_review_idx").on(table.nextReviewAt),
  ],
);

// ============================================
// Chat Conversations
// ============================================

export const chatConversations = pgTable(
  "chat_conversations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New Conversation"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("chat_conversations_user_id_idx").on(table.userId)],
);

// ============================================
// Chat Messages
// ============================================

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => chatConversations.id, { onDelete: "cascade" }),
    role: chatRoleEnum("role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("chat_messages_conversation_id_idx").on(table.conversationId),
  ],
);

// ============================================
// Relations
// ============================================

export const usersRelations = relations(users, ({ many }) => ({
  folders: many(folders),
  documents: many(documents),
  exams: many(exams),
  examSessions: many(examSessions),
  flashcardDecks: many(flashcardDecks),
  chatConversations: many(chatConversations),
}));

export const foldersRelations = relations(folders, ({ one, many }) => ({
  user: one(users, {
    fields: [folders.userId],
    references: [users.id],
  }),
  parent: one(folders, {
    fields: [folders.parentId],
    references: [folders.id],
    relationName: "parentChild",
  }),
  children: many(folders, { relationName: "parentChild" }),
  documents: many(documents),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  user: one(users, {
    fields: [documents.userId],
    references: [users.id],
  }),
  folder: one(folders, {
    fields: [documents.folderId],
    references: [folders.id],
  }),
  chunks: many(documentChunks),
  examDocuments: many(examDocuments),
  flashcardDeckDocuments: many(flashcardDeckDocuments),
}));

export const documentChunksRelations = relations(documentChunks, ({ one }) => ({
  document: one(documents, {
    fields: [documentChunks.documentId],
    references: [documents.id],
  }),
}));

export const examsRelations = relations(exams, ({ one, many }) => ({
  user: one(users, {
    fields: [exams.userId],
    references: [users.id],
  }),
  examDocuments: many(examDocuments),
  questions: many(questions),
  sessions: many(examSessions),
}));

export const examDocumentsRelations = relations(examDocuments, ({ one }) => ({
  exam: one(exams, {
    fields: [examDocuments.examId],
    references: [exams.id],
  }),
  document: one(documents, {
    fields: [examDocuments.documentId],
    references: [documents.id],
  }),
}));

export const questionsRelations = relations(questions, ({ one, many }) => ({
  exam: one(exams, {
    fields: [questions.examId],
    references: [exams.id],
  }),
  answers: many(answers),
}));

export const examSessionsRelations = relations(
  examSessions,
  ({ one, many }) => ({
    exam: one(exams, {
      fields: [examSessions.examId],
      references: [exams.id],
    }),
    user: one(users, {
      fields: [examSessions.userId],
      references: [users.id],
    }),
    answers: many(answers),
    result: one(results),
  }),
);

export const answersRelations = relations(answers, ({ one }) => ({
  session: one(examSessions, {
    fields: [answers.sessionId],
    references: [examSessions.id],
  }),
  question: one(questions, {
    fields: [answers.questionId],
    references: [questions.id],
  }),
}));

export const resultsRelations = relations(results, ({ one }) => ({
  session: one(examSessions, {
    fields: [results.sessionId],
    references: [examSessions.id],
  }),
}));

export const flashcardDecksRelations = relations(
  flashcardDecks,
  ({ one, many }) => ({
    user: one(users, {
      fields: [flashcardDecks.userId],
      references: [users.id],
    }),
    flashcardDeckDocuments: many(flashcardDeckDocuments),
    flashcards: many(flashcards),
  }),
);

export const flashcardDeckDocumentsRelations = relations(
  flashcardDeckDocuments,
  ({ one }) => ({
    deck: one(flashcardDecks, {
      fields: [flashcardDeckDocuments.deckId],
      references: [flashcardDecks.id],
    }),
    document: one(documents, {
      fields: [flashcardDeckDocuments.documentId],
      references: [documents.id],
    }),
  }),
);

export const flashcardsRelations = relations(flashcards, ({ one }) => ({
  deck: one(flashcardDecks, {
    fields: [flashcards.deckId],
    references: [flashcardDecks.id],
  }),
}));

export const chatConversationsRelations = relations(
  chatConversations,
  ({ one, many }) => ({
    user: one(users, {
      fields: [chatConversations.userId],
      references: [users.id],
    }),
    messages: many(chatMessages),
  }),
);

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  conversation: one(chatConversations, {
    fields: [chatMessages.conversationId],
    references: [chatConversations.id],
  }),
}));
