# Exam System Rewrite Plan

This plan is the shared implementation guide for rebuilding the exam flow end-to-end.

## Goals

- Make exam lifecycle deterministic: `create -> generate -> ready -> attempt -> submit -> grade -> results`.
- Eliminate fragile frontend hook/order and race-condition issues.
- Ensure sessions are resumable and submission is idempotent.
- Keep WebSocket as enhancement, not single source of truth.

## Scope

- Backend: exam/session API contracts, session lifecycle, WebSocket channel security.
- Frontend: exams list actions, workspace flow, attempt controller, results fallback behavior.
- Shared contract expectations: one in-progress session per user+exam, historical submitted sessions preserved.

## Execution Phases

### Phase 1 — Backend contract hardening

- [x] `POST /exams/:id/sessions` reuses existing in-progress session.
- [x] Add `GET /exams/:id/sessions/latest` to fetch latest session for an exam.
- [x] Make `POST /exams/sessions/:sessionId/submit` idempotent.
- [x] Enforce WebSocket exam/session channel ownership checks.

### Phase 2 — Workspace/attempt rewrite

- [ ] Rewrite `apps/web/src/routes/_authenticated/exams/$examId/index.tsx` with stable hook order.
- [ ] Model attempt lifecycle from session status first, not timer side effects.
- [ ] Resume existing in-progress session automatically.
- [ ] Compute timer from server `endsAt` (WS optional enhancement only).
- [ ] Keep answer save optimistic but predictable for MCQ + descriptive answers.

### Phase 3 — Results flow normalization

- [ ] Update results route to support missing `sessionId` by resolving latest session.
- [ ] Keep grading progress UX functional with polling + WS updates.
- [ ] Ensure list/workspace actions pass or resolve `sessionId` correctly.

### Phase 4 — Exams list behavior

- [ ] Update “View results” actions to open latest submitted session.
- [ ] Keep “Take exam” routing to workspace where resume/start is deterministic.

### Phase 5 — Verification

- [ ] Run API typecheck.
- [ ] Run Web typecheck/build checks available in repo.
- [ ] Manually verify flows:
  - Create exam -> generation -> start
  - Resume in-progress session after refresh
  - Submit once and duplicate submit safety
  - Results open from list/workspace even without explicit `sessionId`

## Notes for Agents

- Prefer API session status as authoritative for lifecycle transitions.
- Treat WS timer/grading events as supplementary state updates.
- Do not place hooks after any conditional return in React route components.
- Keep commits atomic by phase/file area.
