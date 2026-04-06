# Flashcards V1 Implementation Plan

## Summary
Build a complete flashcards feature around uploaded documents only: create a deck, asynchronously generate AI flashcards from selected docs, browse decks/cards, run a study session, and update spaced-repetition review state on each card.

This should follow the existing exam/documents architecture: Elysia routes, BullMQ worker, Drizzle schema, React Query frontend, and the current dashboard/auth/layout patterns.

## Key Changes

### Data model and backend behavior
- Extend `flashcard_decks` to support async generation lifecycle.
  - Add `status: "generating" | "ready" | "failed"` with default `"generating"` for new AI decks.
  - Add nullable `errorMessage` for failed generation.
  - Keep `cardCount` as the persisted summary count and update it after generation.
- Reuse existing `flashcard_deck_documents` join table for deck source documents.
- Keep `flashcards` as the review state source of truth.
  - Use existing `difficulty`, `nextReviewAt`, `interval`, `easeFactor`, `repetitions`.
  - Treat each review as an update to one flashcard row rather than a separate review-history table in v1.

### Backend API
Add a dedicated flashcards route module and register it in the API app:
- `POST /flashcards`
  - Create a new deck from `title`, `topic`, optional `description`, and required `documentIds`.
  - Verify document ownership.
  - Insert deck in `generating` status, attach documents, enqueue generation job.
- `GET /flashcards`
  - List user decks with status, `cardCount`, timestamps, and basic review summary.
- `GET /flashcards/:deckId`
  - Return deck details, attached docs, and flashcards.
- `DELETE /flashcards/:deckId`
  - Delete a deck and cascade cards/doc links.
- `POST /flashcards/:deckId/review`
  - Accept `{ flashcardId, rating }`.
  - `rating` should be explicit and decision-complete: `"again" | "hard" | "good" | "easy"`.
  - Map rating to the existing SM-2 fields and update `nextReviewAt`, `interval`, `easeFactor`, `repetitions`, and optionally `difficulty`.
- `GET /flashcards/review/due`
  - Return all due cards grouped by deck or at least enough data to power “study due now”.

### Generation worker
Add a flashcard generation worker and wire it into the worker index.
- Create `apps/api/src/workers/flashcard-generation.ts`.
- Worker input stays aligned with existing shared type: `deckId`, `userId`, `topic`, `documentIds`.
- Generation flow:
  - Load deck + source docs + extracted text/chunks.
  - Build source material from uploaded documents only.
  - Ask the AI to generate a bounded set of high-quality cards.
  - Persist flashcards into the deck.
  - Update deck `cardCount`, `status`, `updatedAt`.
  - On failure, set deck `status = "failed"` and `errorMessage`.
- V1 generation target:
  - Use a fixed default count for predictability, for example 20 cards per deck.
  - Generate concise front/back pairs focused on recall, not long notes.
  - Avoid duplicate/near-duplicate cards in the same deck.
- No websocket work is required for v1.
  - Frontend should poll deck status similarly to exam generation polling.

### Shared types and interfaces
Extend `packages/shared/src/types.ts` with public flashcard domain types:
- `FlashcardDeckStatus`
- `FlashcardReviewRating`
- `FlashcardDeck`
- `Flashcard`
- Optional request/response helper shapes if the app already benefits from them

These should be the canonical frontend/backend contract for flashcard pages.

### Frontend routes and UX
Replace the placeholder flashcards page with a full deck workflow.

Recommended route structure:
- `/flashcards`
  - Deck list page
  - “New deck” action
  - Deck cards: generating, ready, failed
  - Quick stats: total decks, total cards, due cards
- `/flashcards/new`
  - Create deck form using selected uploaded documents
  - Fields: title, topic, optional description, document multiselect
  - On create, redirect to deck detail and show generating state
- `/flashcards/$deckId`
  - Deck detail page
  - If generating: poll until ready, show generation state
  - If failed: show retry guidance and error message
  - If ready: show deck summary, card count, due count, and flashcard list
- `/flashcards/$deckId/study`
  - Study session UI
  - Show one card at a time, front first, then reveal back
  - Rating actions: again / hard / good / easy
  - On submit, call review endpoint and advance to next due card

UI expectations:
- Preserve the repo’s current visual language used in exams/documents.
- Deck list and detail pages should feel complete, not placeholder.
- Study screen should optimize for focused repetition, not dense dashboard chrome.

## Implementation Details That Must Be Locked
- Source scope: uploaded documents only in v1.
- Deck creation is AI-generated only in v1; no manual card authoring.
- Async state is persisted on the deck row, not held only in memory.
- Review algorithm uses the existing flashcard table fields and updates in place.
- “Due” means `nextReviewAt <= now`.
- Failed deck generation is visible from the deck list and deck detail page.
- No separate websocket channel for flashcards in v1; polling is the mechanism.

## Test Plan
- API
  - Creating a deck with valid owned docs inserts deck, joins docs, and enqueues worker.
  - Creating a deck with foreign/missing docs fails authorization/validation.
  - Listing decks returns only the authenticated user’s decks.
  - Deck detail returns cards and source docs only for the owner.
  - Review endpoint correctly updates SM-2 fields for each rating.
- Worker
  - Successful generation creates cards, updates `cardCount`, and marks deck `ready`.
  - Failure marks deck `failed` and stores `errorMessage`.
  - Empty/low-quality source material fails predictably with a user-facing message.
- Frontend
  - New deck form submits and redirects correctly.
  - Generating deck page polls and transitions to ready state.
  - Failed deck state renders clearly.
  - Study flow reveals back, records rating, advances to next card, and finishes cleanly when no due cards remain.

## Assumptions and Defaults
- V1 scope is the full flow: generation + deck browsing + study + spaced repetition.
- Generation source is uploaded documents only.
- Default generated deck size is fixed rather than user-configurable in v1.
- `FLASHCARD_PLAN.md` is not written in this turn because the session is currently in Plan Mode; on the implementation turn, write this plan verbatim to that file before coding.
