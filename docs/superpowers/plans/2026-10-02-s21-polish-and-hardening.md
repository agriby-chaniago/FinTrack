# S21 Polish and Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the debt the owner approved on 2 October 2026: the Telegram digest no longer holds a database transaction while calling Telegram and never exceeds one message, the visible UI rough edges from S15–S20 are fixed, and the stale parts of the PRD and implementation plan are brought up to date.

**Architecture:** No schema change. The digest reads and builds its text in one short owner transaction, calls Telegram with no transaction open, and records the business date after Telegram accepts; the GitHub workflow gets a concurrency group so runs never overlap. UI fixes stay inside the existing components (`toast.tsx`, `skeletons.tsx`, `motion.tsx`, `app-shell.tsx`, Pengaturan and Laporan pages) with pure helpers in `src/lib` where a rule can be unit tested.

**Tech Stack:** Next.js 16.3, React 19.2, Motion 13.4, Chart.js 4.5, Drizzle, Vitest (unit and db), Playwright.

**Spec:** `PRD.md` P6 (digest), `Feedback dan responsive behavior` (toast), P8 (account tiles), P3 (step transitions), P5 (Laporan), P10 (sheet spring, finished tasks); owner approval in chat on 2 October 2026 (groups 2, 3, 4 of the remaining-work list).

## Global Constraints

- PRD P6: at most one digest per business date; titles and a link only, never an amount; a failed send is retried by the next run.
- Telegram's limit is 4096 characters per message: the digest lists at most 10 titles and says how many more remain.
- No new migration (production migrations need the owner's 1Password approval).
- Reduced motion keeps every new behavior still.
- Money is never a JavaScript `number`; rounding uses `bigint`.

## Review Focus

1. A digest run must never hold an open transaction during the Telegram call. Pinned in Task 1 (`calls Telegram with no transaction open`).
2. A failed send must still leave no record, so the next run retries. Pinned in Task 1 (existing `a failed send leaves no record`).
3. The toast must not cover the bottom actions on a phone and must be dismissible by tap and keyboard. Pinned in Task 3.
4. A Laporan delta with sen must not print sen, and an exact delta must stay exact. Pinned in Task 6 (`deltaLabel`).
5. A refresh of Laporan with the same data must not rebuild the chart. Pinned in Task 6 (`a refresh keeps the same chart`).

---

### Task 1: Digest outside the transaction, capped at 10 titles

**Files:** `src/server/application/reminders.ts`, `src/lib/reminder-text.ts`, `src/lib/reminder-text.test.ts`, `tests/reminders/reminder.integration.test.ts`, `.github/workflows/telegram-reminder.yml`.

- [ ] **Failing tests.** DB: `calls Telegram with no transaction open` counts `pg_stat_activity` rows of `fintrack_app` in `idle in transaction` from inside `send` and expects 0. Unit: 25 tasks print the header count 25, exactly 10 bullet titles, and `• dan 15 tugas lain`.
- [ ] **Implement.** `deliverDailyDigest`: `withOwnerDb` returns `{ outcome }` or `{ text }` (checks the date, builds the dashboard and text); outside it, `await send(text)`; then a second short `withOwnerDb` inserts the date (`onConflictDoNothing`). `digestText` slices 10 titles and appends the remainder line. Workflow: `concurrency: { group: telegram-reminder, cancel-in-progress: false }` and the comment explains record-after-send.
- [ ] **Verify** `pnpm test`, `pnpm test:db tests/reminders`. **Commit** `fix(reminders): call Telegram outside the transaction and cap the digest`.

### Task 2: Status icons and the revision confirmation

**Files:** `src/lib/labels.ts` (+ test), `src/app/(app)/rutinitas/page.tsx`, `src/app/(app)/pengaturan/sections.tsx`, `src/app/(app)/pengaturan/page.tsx`, `tests/e2e/pengaturan.spec.ts`.

- [ ] **Failing tests.** Unit: `occurrenceStatusIcon` maps `PENDING → clock`, `CONFIRMED → check`, `NOT_RECEIVED`/`NOT_CHARGED → minus`. E2E: saving `Ubah perkiraan` for `Biaya bulanan bank` shows the toast `Perkiraan Biaya bulanan bank diubah mulai <next month>`.
- [ ] **Implement.** Rutinitas occurrence tags pass `icon={occurrenceStatusIcon[status]}`. `RevisionForm` gets `name`, drops the unreachable `Saved`, and confirms with `useToast`.
- [ ] **Commit** `fix(ui): pending tags show a clock, revisions confirm with a toast`.

### Task 3: Toast that stays out of the way

**Files:** `src/components/toast.tsx`, `tests/e2e/motion.spec.ts`.

- [ ] **Failing tests.** On a phone the toast sits under the header (top < 30% of the viewport) and drops in from above; tapping it dismisses it at once.
- [ ] **Implement.** Region `fixed inset-x-4 top-[calc(3.5rem+env(safe-area-inset-top)+0.5rem)] md:inset-x-auto md:top-auto md:bottom-6 md:right-6`; the toast is a `button` (`pointer-events-auto`, `onClick` dismiss) inside the persistent `role=status` region; rise direction from `useMediaQuery("(min-width: 48rem)")`.
- [ ] **Commit** `fix(ui): the toast sits under the header on a phone and dismisses on tap`.

### Task 4: Account skeletons with tiles

**Files:** `src/components/skeletons.tsx` (`AccountBlock` with a `data-tile` 40px square; `AccountsSkeleton`; Beranda skeleton uses `AccountBlock`), `src/app/(app)/akun/loading.tsx`, `tests/e2e/motion.spec.ts`.

- [ ] **Failing test.** With the `/akun` RSC response held 1.5 s, navigating to Akun shows three `[data-tile]` blocks in the skeleton.
- [ ] **Commit** `fix(ui): account skeletons show the tile`.

### Task 5: Onboarding steps crossfade

**Files:** `src/components/motion.tsx` (`StepTransition` uses `mode="popLayout"`), `src/app/onboarding/onboarding-flow.tsx` (step area `relative`, `data-step-area`), `tests/e2e/onboarding.spec.ts`.

- [ ] **Failing test.** Sampling the summed opacity of the step area's children every frame through the first `Simpan & lanjut`, the minimum stays above 0.6 (with `mode="wait"` it drops to about 0).
- [ ] **Commit** `fix(onboarding): steps crossfade instead of leaving a blank`.

### Task 6: Laporan deltas and a stable chart

**Files:** `src/lib/report-view.ts` (+ test: `deltaLabel`), `src/app/(app)/aktivitas/laporan/page.tsx`, `trend-chart.tsx` (stable props from a serialized key), `chart-canvas.tsx` (`chart` prop, `data-chart-id`), `tests/e2e/laporan.spec.ts`.

- [ ] **Failing tests.** Unit: `deltaLabel("1234567.43") === "≈ +Rp1.234.567"`, `deltaLabel("-50000") === "−Rp50.000"`, `deltaLabel("0") === "Rp0"`, `deltaLabel("12.50") === "≈ +Rp13"`. E2E: on desktop Laporan, `window.next.router.refresh()` keeps the same `data-chart-id`.
- [ ] **Commit** `fix(laporan): whole-rupiah deltas and a chart that survives a refresh`.

### Task 7: Sheet without a gap, quiet replayed rows

**Files:** `src/components/app-shell.tsx` (phone sheet panel extends 48px of surface below itself), `src/components/motion.tsx` (`AnimatedItem` `decorative` → `aria-hidden`), `src/components/task-section.tsx`, tests in `motion.spec.ts` and `memory.spec.ts`.

- [ ] **Failing tests.** The phone sheet panel's `::after` is 48px of surface below it; a replayed task `li` is `aria-hidden="true"`.
- [ ] **Commit** `fix(motion): no gap under the bouncing sheet, replayed rows hidden from screen readers`.

### Task 8: Docs, verify, deploy

- [ ] PRD v0.23: status `Production active`; `Prioritas pembahasan berikutnya` and `Pending onboarding data` record that production and onboarding are done; P6 `Pelaksanaan S21`; footer `Slices 0–21`. Implementation plan: S21 row, stale "belum di-deploy" and "belum diuji otomatis" lines updated.
- [ ] Full verification (`lint`, `typecheck`, `test`, `test:db`, `build`, `test:e2e`, `test:e2e:prod`), commit, push, confirm Ready and CI green.
