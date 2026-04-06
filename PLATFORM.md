# Prepify Platform Overview

## What This Codebase Does

Prepify is an AI-powered study platform. It lets an authenticated user upload study material, organize it, generate exams and flashcards from that material, take timed exams, get AI-evaluated results, and study with spaced-repetition flashcards. It also includes an AI chat interface for study assistance.

At a high level, the platform turns uploaded learning content into interactive study workflows:

- `Documents`: users upload and process files that become the source material for other features.
- `Exams`: users generate exams from their content, take them in a timed workspace, submit answers, and receive asynchronous AI evaluation.
- `Flashcards`: users generate decks from uploaded documents and review them with spaced repetition.
- `Chat`: users interact with an AI assistant in a study-oriented chat interface.

## Product Capabilities

### Document ingestion and organization
- Users can upload documents and store them in folders.
- Documents go through an async processing pipeline.
- Processed content is chunked and embedded so it can be used for retrieval-based AI features.

### AI-generated exams
- Users create exams from uploaded docs, global knowledge, or both.
- Exam generation runs asynchronously through a worker queue.
- Users can start timed exam sessions, answer MCQ and descriptive questions, and submit attempts.
- Submitted exams are graded asynchronously by AI.
- Results include scoring, question-level breakdown, and overall feedback.

### Flashcard study system
- Users create flashcard decks from uploaded documents.
- Deck generation runs asynchronously through a worker queue.
- Generated cards can be reviewed in a study flow with spaced repetition metadata stored per card.
- Users can study due cards or go through a deck again from the start.

### AI chat
- Users have authenticated chat conversations with the platform.
- Chat appears to be intended as a study/copilot experience alongside the document-based workflows.

## Architecture

### Monorepo layout
- `apps/api`: Bun + Elysia backend API and async workers.
- `apps/web`: React + Vite + TanStack Router frontend.
- `packages/shared`: shared domain types and constants used by both apps.

### Backend
- Uses `Elysia` for HTTP and websocket routes.
- Uses `Drizzle ORM` with PostgreSQL schema definitions in `apps/api/src/db/schema.ts`.
- Uses `BullMQ` workers for async jobs such as document processing, exam generation, exam grading, and flashcard generation.
- Uses AI providers through the Vercel AI SDK and related service wrappers.
- Uses retrieval over processed document chunks to ground generation on user-uploaded material.

### Frontend
- Uses `TanStack Router` for file-based routing.
- Uses `TanStack Query` for API data fetching, mutation, and polling.
- Uses Clerk-based auth integration.
- Provides authenticated dashboard-style pages for documents, exams, chat, and flashcards.

## AI Models in Use

The codebase uses different models for different kinds of AI work rather than a single model for everything.

### `moonshotai/kimi-k2-instruct-0905` via Groq
- This is the main structured generation and evaluation model.
- It is used for:
  - exam question generation,
  - descriptive exam grading,
  - overall exam feedback generation,
  - flashcard generation.
- This is the model behind most of the platform’s core study-artifact creation flows.

### `meta-llama/llama-4-scout-17b-16e-instruct` via Groq
- This model powers the chat assistant.
- It is used in the chat routes for streaming conversational responses.
- It can answer using retrieved user document context when relevant, so it acts as the interactive study assistant rather than the structured generator.

### `gemini-2.5-flash` via Google Generative AI
- This model is used for multimodal text extraction from images.
- It is used for:
  - document-processing OCR-like extraction from uploaded image files,
  - extracting text from image attachments submitted with descriptive exam answers.
- In practice, this model handles “read the image and turn it into text” tasks.

### `BAAI/bge-large-en-v1.5` via Hugging Face Inference
- This is the embedding model.
- It is used to generate vector embeddings for:
  - processed document chunks,
  - retrieval queries during similarity search.
- Those embeddings power retrieval-augmented features such as document-grounded chat, exam generation from uploaded material, and flashcard generation from uploaded material.

## AI Stack by Responsibility

- `Gemini 2.5 Flash`: image-to-text extraction.
- `BAAI/bge-large-en-v1.5`: embeddings and retrieval.
- `Llama 4 Scout`: conversational study chat.
- `Kimi K2`: structured generation, grading, and flashcard/exam content creation.

## Core System Flow

1. A user uploads documents.
2. Documents are processed into extracted text and embeddings.
3. The user creates an exam or flashcard deck from those documents.
4. A background worker generates the exam questions or flashcards.
5. The frontend polls or listens for status changes.
6. The user studies through exams, flashcards, or chat.
7. For exams, submission triggers asynchronous AI grading and a results flow.

## Current State of the Codebase

- The platform is already beyond a starter template and has real product features implemented.
- Documents, exams, chat, and flashcards all exist as first-class modules.
- Async job infrastructure and retrieval-based AI workflows are already wired into the system.
- The root `README.md` is still mostly the default Turborepo starter text, so this file serves as the actual platform description for the repository.
