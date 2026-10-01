# S16 Motion and One Recording-Form Pattern Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add meaningful Motion animation to the surfaces PRD v0.20 P3 names, keep reduced-motion users still, and give the three recording forms one shared submit pattern.

**Architecture:** One client module, `src/components/motion.tsx`, owns every Motion primitive (`MotionProvider`, `Collapse`, `Swap`, `StepTransition`, `Reveal`, `AnimatedList`, `AnimatedItem`). Pages and forms use those primitives and never import `motion/react` directly, with two exceptions: the `+ Catat` sheet and `RecordingForm`, which need `AnimatePresence` callbacks or `m.form`. Every primitive wraps `AnimatePresence initial={false}`, so server-rendered markup is never hidden waiting for JavaScript. Native `<details>` in server components animate with CSS (`::details-content`), and content after a skeleton fades in with a CSS keyframe. `RecordingForm` owns validation, the cutover-day question, the acknowledged outcome, and `Catat lagi`.

**Tech Stack:** Next.js 16 App Router, React 19.2, `motion` 13.4.6 (`motion/react`: `LazyMotion`, `domAnimation`, `m`, `AnimatePresence`, `MotionConfig`), Tailwind 4 + daisyUI 5, Playwright (Pixel 7 project), Vitest.

**Spec:** `PRD.md` → `Visual refresh dan fitur pasca-MVP (v0.20)` → P3 (LOCKED), plus `Motion` and `Form dan action behavior` in `Visual language dan component behavior`.

## Global Constraints

- Motion only through `m` components inside `<LazyMotion features={domAnimation} strict>`; never the `motion.*` components.
- `MotionConfig reducedMotion="user"`: with `prefers-reduced-motion: reduce`, transforms are skipped and only opacity changes.
- Durations 160–220 ms, ease-out: default 200 ms; swaps and steps 160–180 ms.
- Never animate an amount (no count-up, no rolling numbers).
- No global page choreography: the only page-level effect is a 150 ms opacity fade of the content that replaces a skeleton.
- Every animated wrapper uses `AnimatePresence initial={false}`, so first render and server markup show final state.
- Radius 0 everywhere (P7); `src/lib/square-geometry.test.ts` must stay green.
- Toasts are supplemental (PRD: Feedback); they announce through one persistent `role="status"` region.
- Financial mutations still wait for server acknowledgement; nothing becomes optimistic.

## Review Focus

1. Escape on the `+ Catat` sheet must close it after the exit animation and return focus to the button that opened it. Pinned in Task 1 (`Escape closes the sheet and returns focus`).
2. A user with `prefers-reduced-motion: reduce` must never see the sheet move. Pinned in Task 1 (`reduced motion keeps the sheet still`).
3. `Catat lagi` must give an empty form again, not the previous amount. Pinned in Task 7 (`special expense records and Catat lagi clears the form`).
4. The cutover-day question must still re-submit with the answer and show the skipped outcome. Pinned in Task 7 (`the cutover-day question skips a record already in the opening balance`).
5. A collapsed region must not leave focusable inputs behind once closed. Pinned in Task 2 (`Ubah detail reveals the actual fields and Tutup detail removes them`).

---

### Task 1: Motion foundation and the animated `+ Catat` sheet

**Files:**
- Create: `src/components/motion.tsx`
- Create: `tests/e2e/motion.spec.ts`
- Modify: `src/app/layout.tsx` (wrap `children` in `MotionProvider`)
- Modify: `src/components/app-shell.tsx` (`CatatSheet`)
- Modify: `src/app/globals.css` (sheet backdrop)

**Interfaces:**
- Produces: `MotionProvider({ children })`, `Collapse({ open, children })`, `Swap({ swapKey, children })`, `StepTransition({ step, direction, children })`, `Reveal({ revealKey, children })`, `AnimatedList({ className, children })`, `AnimatedItem({ children })` from `@/components/motion`. Later tasks use them by these names.

- [ ] **Step 1: Write the failing e2e tests**

`tests/e2e/motion.spec.ts`:

```ts
// Motion surfaces (PRD v0.20 P3): the + Catat sheet, reduced motion, collapses,
// toasts, native disclosures, and the content fade after a skeleton.
import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);
Object.assign(process.env, env);
const { closeClients, createAuthUser, resetWithConfirmedFixture, testClients } = await import("../helpers/owner");

const clients = testClients();
let user: Awaited<ReturnType<typeof createAuthUser>>;

function daysAgo(n: number): string {
  const today = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date())}T00:00:00Z`);
  return new Date(today.getTime() - n * 86_400_000).toISOString().slice(0, 10);
}

test.beforeAll(async () => {
  user = await createAuthUser(clients.authAdmin, "e2e-motion");
  // Cutover three days ago leaves this month's income and obligations pending.
  await resetWithConfirmedFixture(clients, user.id, `${daysAgo(3)}T20:00:00+07:00`);
});

test.afterAll(async () => {
  await clients.admin`truncate fintrack.app_owner cascade`;
  await clients.authAdmin.auth.admin.deleteUser(user.id);
  await closeClients(clients);
});

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByText("Personal cash tercatat")).toBeVisible();
}

const identity = /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/;

/** Clicks the visible + Catat button and records the sheet panel's transform every frame for 400 ms. */
function openSheetAndSample(page: Page) {
  return page.evaluate(async () => {
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Catat" && b.checkVisibility())!;
    button.click();
    const seen: string[] = [];
    const start = performance.now();
    while (performance.now() - start < 400) {
      await new Promise(requestAnimationFrame);
      const panel = document.querySelector("dialog[open] > div");
      if (panel) seen.push(getComputedStyle(panel).transform);
    }
    return seen;
  });
}

test("the + Catat sheet slides in", async ({ page }) => {
  await signIn(page);
  const transforms = await openSheetAndSample(page);
  expect(transforms.some((t) => !identity.test(t))).toBe(true);
  expect(transforms.at(-1)).toMatch(identity);
});

test("Escape closes the sheet and returns focus", async ({ page }) => {
  await signIn(page);
  const button = page.getByRole("button", { name: "Catat" });
  await button.click();
  await expect(page.getByRole("dialog", { name: "Catat" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(button).toBeFocused();
});

test("reduced motion keeps the sheet still", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  const transforms = await openSheetAndSample(page);
  expect(transforms.length).toBeGreaterThan(0);
  expect(transforms.every((t) => identity.test(t))).toBe(true);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test:e2e tests/e2e/motion.spec.ts`
Expected: `the + Catat sheet slides in` FAILS (every sampled transform is `none`). The other two may pass already; they guard behavior the change must keep.

- [ ] **Step 3: Create `src/components/motion.tsx`**

```tsx
"use client";

// Motion primitives (PRD v0.20 P3). Only `m` components with the domAnimation
// bundle are used, and `reducedMotion="user"` drops transform animation when the
// OS asks for reduced motion, so only opacity changes remain. Every wrapper uses
// `initial={false}`: server markup and first render always show the final state.
import { AnimatePresence, LazyMotion, MotionConfig, domAnimation, m } from "motion/react";
import type { ReactNode } from "react";

/** PRD Motion: 160–220 ms, ease-out. */
const enter = { duration: 0.2, ease: "easeOut" } as const;
const quick = { duration: 0.16, ease: "easeOut" } as const;

const shown = { opacity: 1, height: "auto", transitionEnd: { overflow: "visible" } } as const;
const hidden = { opacity: 0, height: 0, overflow: "hidden" } as const;

export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user" transition={enter}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}

/** Expands and collapses its content (expand/collapse detail). */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <m.div key="collapse" initial={hidden} animate={shown} exit={hidden}>
          {children}
        </m.div>
      ) : null}
    </AnimatePresence>
  );
}

/** Replaces one state of a surface with the next, folding the old one away first. */
export function Swap({ swapKey, children }: { swapKey: string; children: ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <m.div key={swapKey} initial={hidden} animate={shown} exit={hidden} transition={quick}>
        {children}
      </m.div>
    </AnimatePresence>
  );
}

const step = {
  enter: (direction: number) => ({ opacity: 0, x: 16 * direction }),
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({ opacity: 0, x: -16 * direction }),
};

/** Guided-flow steps: forward slides in from the right, back from the left. */
export function StepTransition({ step: current, direction, children }: { step: number; direction: 1 | -1; children: ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false} custom={direction}>
      <m.div key={current} custom={direction} variants={step} initial="enter" animate="center" exit="exit" transition={{ duration: 0.18, ease: "easeOut" }}>
        {children}
      </m.div>
    </AnimatePresence>
  );
}

/** Fades new content in whenever `revealKey` changes. */
export function Reveal({ revealKey, children }: { revealKey: string; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      <m.div key={revealKey} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        {children}
      </m.div>
    </AnimatePresence>
  );
}

/** A list whose items fold away when they leave, so the rest of the list moves up. */
export function AnimatedList({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <ul className={className}>
      <AnimatePresence initial={false}>{children}</AnimatePresence>
    </ul>
  );
}

export function AnimatedItem({ children }: { children: ReactNode }) {
  return (
    <m.li initial={hidden} animate={shown} exit={hidden}>
      {children}
    </m.li>
  );
}
```

- [ ] **Step 4: Mount the provider**

`src/app/layout.tsx`: import `MotionProvider` from `@/components/motion` and change the body to:

```tsx
      <body className="flex min-h-full flex-col">
        <MotionProvider>{children}</MotionProvider>
      </body>
```

- [ ] **Step 5: Animate the sheet**

In `src/components/app-shell.tsx`, import `AnimatePresence` and `m` from `motion/react`, and replace `CatatSheet` with:

```tsx
/** `+ Catat` sheet: the panel slides up and fades; the dialog closes after the exit animation. */
function CatatSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && open && !dialog.open) dialog.showModal();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        // Escape runs the exit animation first; onExitComplete then closes the dialog.
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      data-closing={open ? undefined : ""}
      aria-labelledby="catat-title"
      className="sheet m-0 mt-auto w-full max-w-none bg-transparent p-0 text-text md:m-auto md:max-w-md"
    >
      <AnimatePresence onExitComplete={() => ref.current?.close()}>
        {open ? (
          <m.div key="sheet" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }} className="bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl">
            {/* existing header (title + close button) and action list, unchanged */}
          </m.div>
        ) : null}
      </AnimatePresence>
    </dialog>
  );
}
```

Move the existing `<div className="mb-3 flex items-center justify-between">…</div>` and `<ul className="space-y-1">…</ul>` into the `m.div` unchanged, and delete the old wrapper `<div className="p-4 pb-[…]">`.

- [ ] **Step 6: Fade the backdrop with the panel**

Append to `src/app/globals.css`:

```css
/* The + Catat sheet backdrop fades with its panel (PRD v0.20 P3). */
dialog.sheet::backdrop {
  background: rgb(0 0 0 / 0.4);
  transition: opacity 200ms ease-out;
}

dialog.sheet[data-closing]::backdrop {
  opacity: 0;
}

@starting-style {
  dialog.sheet[open]::backdrop {
    opacity: 0;
  }
}
```

- [ ] **Step 7: Run the tests, the guards, lint, and typecheck**

Run: `pnpm test:e2e tests/e2e/motion.spec.ts && pnpm vitest run --project unit && pnpm lint && pnpm typecheck`
Expected: 3 e2e tests PASS; unit tests PASS; no lint or type errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/motion.tsx src/app/layout.tsx src/components/app-shell.tsx src/app/globals.css tests/e2e/motion.spec.ts package.json pnpm-lock.yaml
git commit -m "feat(ui): Motion foundation and an animated + Catat sheet"
```

---

### Task 2: Collapse and swap for in-place surfaces, and smooth native disclosures

**Files:**
- Modify: `src/app/(app)/rutinitas/actions.tsx` (`OccurrenceActions`, `CloseTargetButton`)
- Modify: `src/app/(app)/rutinitas/settlement/settlement-flow.tsx` (closing balance card)
- Modify: `src/app/(app)/pengaturan/sections.tsx` (`EndRuleForm`, the second `open` form, the category row)
- Modify: `src/app/globals.css` (`::details-content`)
- Test: `tests/e2e/motion.spec.ts`

**Interfaces:**
- Consumes from Task 1: `Collapse({ open, children })`, `Swap({ swapKey, children })`.

- [ ] **Step 1: Add the failing tests to `tests/e2e/motion.spec.ts`**

```ts
test("Ubah detail reveals the actual fields and Tutup detail removes them", async ({ page }) => {
  await signIn(page);
  await page.goto("/rutinitas");
  await page.getByRole("button", { name: "Ubah detail" }).first().click();
  await expect(page.getByLabel("Tanggal aktual")).toBeVisible();
  const heights = await page.getByLabel("Tanggal aktual").evaluate(async (input) => {
    const region = input.closest("[style]") as HTMLElement;
    const seen: number[] = [];
    (document.querySelector("button[aria-expanded='true']") as HTMLButtonElement | null)?.click();
    const start = performance.now();
    while (performance.now() - start < 300) {
      await new Promise(requestAnimationFrame);
      seen.push(region.getBoundingClientRect().height);
    }
    return seen;
  });
  expect(new Set(heights.map(Math.round)).size).toBeGreaterThan(2);
  await expect(page.getByLabel("Tanggal aktual")).toHaveCount(0);
});

test("native disclosures open and close smoothly", async ({ page }) => {
  await signIn(page);
  await page.goto("/rutinitas");
  const duration = await page.locator("details").first().evaluate((el) => getComputedStyle(el, "::details-content").transitionDuration);
  expect(duration).toContain("0.18s");
});
```

The first test clicks the toggle a second time from inside the page so it can sample the height while the region folds; the toggle carries `aria-expanded`, which this task adds.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test:e2e tests/e2e/motion.spec.ts -g "Ubah detail|native disclosures"`
Expected: both FAIL (no `aria-expanded` toggle and no height change; `transitionDuration` is `0s`).

- [ ] **Step 3: Occurrence actions**

In `src/app/(app)/rutinitas/actions.tsx`, import `Collapse` and `Swap` from `@/components/motion`.

Restructure `OccurrenceActions` so it has one return: compute the confirmed block and the pending block as before, then return `<Swap swapKey={props.status}>{props.status === "CONFIRMED" ? confirmedBlock : pendingBlock}</Swap>`.

In the pending block, replace `{editing ? (<div className="grid gap-3 sm:grid-cols-2">…</div>) : null}` with:

```tsx
      <Collapse open={editing}>
        <div className="grid gap-3 pb-1 sm:grid-cols-2">
          <DateField label="Tanggal aktual" value={date} max={today} onChange={setDate} />
          <AmountInput label="Nominal aktual" value={amount} onChange={setAmount} />
        </div>
      </Collapse>
```

and give the `Ubah detail` / `Tutup detail` button `aria-expanded={editing}`.

`CloseTargetButton`: single return `<Swap swapKey={confirming ? "confirm" : "idle"}>{confirming ? confirmBlock : linkButton}</Swap>`.

- [ ] **Step 4: Settlement closing balance**

In `src/app/(app)/rutinitas/settlement/settlement-flow.tsx`, import `Swap`, and wrap the `editing ? <form…/> : <div…/>` expression inside the closing-balance `Card` with `<Swap swapKey={editing ? "edit" : "summary"}>…</Swap>`.

- [ ] **Step 5: Pengaturan inline forms**

In `src/app/(app)/pengaturan/sections.tsx`, import `Swap`. For `EndRuleForm` and the other component with `const [open, setOpen]`, turn the early `if (!open) return <button…>` into a single return wrapped in `<Swap swapKey={open ? "form" : "button"}>`. In the category row, wrap the `editing ? <form…/> : <div…/>` expression in `<Swap swapKey={editing ? "edit" : "view"}>`.

- [ ] **Step 6: Native disclosures**

Append to `src/app/globals.css`:

```css
/* Native <details> open and close smoothly (PRD v0.20 P3); the global
   reduced-motion rule makes this instant. Browsers without ::details-content toggle. */
:root {
  interpolate-size: allow-keywords;
}

details::details-content {
  block-size: 0;
  overflow-y: clip;
  transition:
    block-size 180ms ease-out,
    content-visibility 180ms allow-discrete;
}

details[open]::details-content {
  block-size: auto;
}
```

- [ ] **Step 7: Run the tests and checks**

Run: `pnpm test:e2e tests/e2e/motion.spec.ts && pnpm vitest run --project unit && pnpm lint && pnpm typecheck`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add 'src/app/(app)/rutinitas/actions.tsx' 'src/app/(app)/rutinitas/settlement/settlement-flow.tsx' 'src/app/(app)/pengaturan/sections.tsx' src/app/globals.css tests/e2e/motion.spec.ts
git commit -m "feat(ui): animated collapses and swaps, smooth native disclosures"
```

---

### Task 3: Toast for in-place Rutinitas actions

**Files:**
- Create: `src/components/toast.tsx`
- Modify: `src/components/app-shell.tsx` (wrap content in `ToastProvider`)
- Modify: `src/app/(app)/rutinitas/actions.tsx` (`OccurrenceActions` gains `name`; toasts on resolve and close)
- Modify: `src/app/(app)/rutinitas/page.tsx` (pass `name`)
- Test: `tests/e2e/motion.spec.ts`

**Interfaces:**
- Produces: `ToastProvider({ children })`, `useToast(): (message: string) => void`.
- `OccurrenceActions` props gain `name: string`.

- [ ] **Step 1: Add the failing test (last in the file: it confirms the income)**

```ts
test("confirming an occurrence shows a toast and the confirmed state", async ({ page }) => {
  await signIn(page);
  await page.goto("/rutinitas");
  await page.getByRole("button", { name: /^Konfirmasi sesuai saran · Rp750\.000/ }).click();
  const toast = page.getByRole("status").filter({ hasText: "Income bulanan dikonfirmasi" });
  await expect(toast).toBeVisible();
  await expect(page.getByRole("button", { name: "Tandai tidak diterima" })).toBeVisible();
  await expect(toast).toBeHidden({ timeout: 6000 });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test:e2e tests/e2e/motion.spec.ts -g "toast"`
Expected: FAIL (no status region with that text).

- [ ] **Step 3: Create `src/components/toast.tsx`**

```tsx
"use client";

// Supplemental success toast (PRD: Feedback dan responsive behavior). The
// relevant surface still shows the real status; the toast only confirms it and
// is announced through one persistent polite live region.
import { AnimatePresence, m } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { Icon } from "./ui";

const ToastContext = createContext<(message: string) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const show = useCallback((message: string) => setToast({ id: Date.now(), message }), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-[calc(8.75rem+env(safe-area-inset-bottom))] z-40 flex justify-center md:inset-x-auto md:bottom-6 md:right-6">
        <AnimatePresence>
          {toast ? (
            <m.p key={toast.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="flex items-center gap-2 bg-text px-4 py-3 text-sm font-medium text-canvas shadow-lg">
              <Icon name="check" className="size-4" />
              {toast.message}
            </m.p>
          ) : null}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
```

- [ ] **Step 4: Mount it and use it**

`src/components/app-shell.tsx`: wrap the shell's returned tree in `<ToastProvider>…</ToastProvider>`.

`src/app/(app)/rutinitas/page.tsx`: pass `name="Income bulanan"` to the income `OccurrenceActions` and `name={o.name}` to each obligation.

`src/app/(app)/rutinitas/actions.tsx`: add `name: string` to `OccurrenceProps`; `const toast = useToast();`; after a successful confirm call `toast(`${props.name} dikonfirmasi`)`; after a successful no-event resolution call `toast(`${props.name} ditandai ${noEventLabel.toLowerCase()}`)`. In `CloseTargetButton`, after a successful close call `toast("Target ditutup")`.

- [ ] **Step 5: Run the tests and checks**

Run: `pnpm test:e2e tests/e2e/motion.spec.ts && pnpm lint && pnpm typecheck`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/toast.tsx src/components/app-shell.tsx 'src/app/(app)/rutinitas/actions.tsx' 'src/app/(app)/rutinitas/page.tsx' tests/e2e/motion.spec.ts
git commit -m "feat(ui): supplemental toast for in-place Rutinitas actions"
```

---

### Task 4: Step transitions in onboarding and the settlement result

**Files:**
- Modify: `src/app/onboarding/onboarding-flow.tsx`
- Modify: `src/app/(app)/rutinitas/settlement/settlement-flow.tsx`
- Test: `tests/e2e/onboarding.spec.ts`, `tests/e2e/cash.spec.ts` (run only)

**Interfaces:**
- Consumes from Task 1: `StepTransition({ step, direction, children })`, `Reveal({ revealKey, children })`.

- [ ] **Step 1: Run the flow tests as the safety net**

Run: `pnpm test:e2e tests/e2e/onboarding.spec.ts tests/e2e/cash.spec.ts`
Expected: PASS before any change (they must still pass after).

- [ ] **Step 2: Onboarding steps**

In `onboarding-flow.tsx`: import `StepTransition`; add `const [direction, setDirection] = useState<1 | -1>(1);` and

```tsx
  function goTo(next: number) {
    setDirection(next >= step ? 1 : -1);
    setStep(next);
  }
```

Replace every `setStep(` call with `goTo(`. Wrap all the `step === n ? (…) : null` branches inside `<div className="mt-6">` with `<StepTransition step={step} direction={direction}>…</StepTransition>`.

- [ ] **Step 3: Settlement result**

In `settlement-flow.tsx`, import `Reveal` and wrap the `Hasil rekonstruksi` card with `<Reveal revealKey={String(draft.version)}>…</Reveal>` so each recomputed result fades in.

- [ ] **Step 4: Run the flow tests again**

Run: `pnpm test:e2e tests/e2e/onboarding.spec.ts tests/e2e/cash.spec.ts && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/onboarding/onboarding-flow.tsx 'src/app/(app)/rutinitas/settlement/settlement-flow.tsx'
git commit -m "feat(ui): step transitions in onboarding and the settlement result"
```

---

### Task 5: Beranda tasks fold away with stable keys

**Files:**
- Modify: `src/lib/dashboard-view.ts`, `src/lib/dashboard-view.test.ts` (`taskKey`)
- Modify: `src/app/(app)/page.tsx` (`Perlu dilakukan` list)

**Interfaces:**
- Consumes from Task 1: `AnimatedList`, `AnimatedItem`.
- Produces: `taskKey(task: { type: "SETTLEMENT" } | { type: "CONFIRM_INCOME" | "CONFIRM_OBLIGATION"; occurrenceId: string } | { type: "TRANSFER"; targetId: string } | { type: "RECONCILE"; accountId: string }): string`.

- [ ] **Step 1: Write the failing unit test**

Append to `src/lib/dashboard-view.test.ts` (and add `taskKey` to its import):

```ts
describe("taskKey", () => {
  it("names each task by what it is about, so keys survive list changes", () => {
    expect(taskKey({ type: "SETTLEMENT" })).toBe("settlement");
    expect(taskKey({ type: "CONFIRM_INCOME", occurrenceId: "o1" })).toBe("occurrence:o1");
    expect(taskKey({ type: "CONFIRM_OBLIGATION", occurrenceId: "o2" })).toBe("occurrence:o2");
    expect(taskKey({ type: "TRANSFER", targetId: "t1" })).toBe("target:t1");
    expect(taskKey({ type: "RECONCILE", accountId: "a1" })).toBe("reconcile:a1");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run --project unit src/lib/dashboard-view.test.ts`
Expected: FAIL (`taskKey` is not exported).

- [ ] **Step 3: Implement**

Append to `src/lib/dashboard-view.ts`:

```ts
type KeyedTask =
  | { type: "SETTLEMENT" }
  | { type: "CONFIRM_INCOME" | "CONFIRM_OBLIGATION"; occurrenceId: string }
  | { type: "TRANSFER"; targetId: string }
  | { type: "RECONCILE"; accountId: string };

/** Stable identity of a Perlu dilakukan task, so the right row animates when it leaves. */
export function taskKey(task: KeyedTask): string {
  switch (task.type) {
    case "SETTLEMENT":
      return "settlement";
    case "CONFIRM_INCOME":
    case "CONFIRM_OBLIGATION":
      return `occurrence:${task.occurrenceId}`;
    case "TRANSFER":
      return `target:${task.targetId}`;
    case "RECONCILE":
      return `reconcile:${task.accountId}`;
  }
}
```

In `src/app/(app)/page.tsx`, import `AnimatedList` and `AnimatedItem` from `@/components/motion` and `taskKey`. Replace `<ul className="divide-y divide-border border border-border bg-surface">` with `<AnimatedList className="divide-y divide-border border border-border bg-surface">`, its closing tag accordingly, and each `<li key={index}>` with `<AnimatedItem key={taskKey(task)}>` (closing `</AnimatedItem>`).

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run --project unit src/lib/dashboard-view.test.ts && pnpm test:e2e tests/e2e/beranda.spec.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard-view.ts src/lib/dashboard-view.test.ts 'src/app/(app)/page.tsx'
git commit -m "feat(ui): Beranda tasks fold away with stable keys"
```

---

### Task 6: Content fades in after the skeleton

**Files:**
- Modify: `src/app/globals.css`
- Test: `tests/e2e/motion.spec.ts`

- [ ] **Step 1: Add the failing test**

```ts
test("page content fades in when it replaces the skeleton", async ({ page }) => {
  await signIn(page);
  await page.goto("/akun");
  expect(await page.locator("main > *").first().evaluate((el) => getComputedStyle(el).animationName)).toBe("fade-in");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test:e2e tests/e2e/motion.spec.ts -g "fades in"`
Expected: FAIL (`animationName` is `none`).

- [ ] **Step 3: Implement**

Append to `src/app/globals.css`:

```css
/* Content and skeletons fade in as they replace each other (PRD v0.20 P3).
   Opacity only; the global reduced-motion rule makes it instant. */
@keyframes fade-in {
  from {
    opacity: 0;
  }
}

main > * {
  animation: fade-in 150ms ease-out;
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test:e2e tests/e2e/motion.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css tests/e2e/motion.spec.ts
git commit -m "feat(ui): fade content in after the skeleton"
```

---

### Task 7: One submit pattern for the recording forms

**Files:**
- Create: `tests/e2e/recording.spec.ts`
- Create: `src/components/recording-form.tsx`
- Modify: `src/app/(app)/catat/pengeluaran/special-expense-form.tsx`, `src/app/(app)/catat/transfer/transfer-form.tsx`, `src/components/external-movement-form.tsx`

**Interfaces:**
- Produces: `RecordingForm({ path, submitLabel, validate, body, onReset, children }: { path: string; submitLabel: string; validate: () => string[]; body: () => Record<string, unknown>; onReset: () => void; children: ReactNode })`.

- [ ] **Step 1: Write the characterization tests**

`tests/e2e/recording.spec.ts` (same header, fixture, and `signIn` as `motion.spec.ts`, with user label `e2e-recording`):

```ts
test("special expense records and Catat lagi clears the form", async ({ page }) => {
  await signIn(page);
  await page.goto("/catat/pengeluaran");
  await page.getByLabel("Nominal").fill("25.000");
  await page.getByRole("button", { name: "Simpan pengeluaran" }).click();
  await expect(page.getByText("Catatan sudah masuk ke Aktivitas dan saldo tercatat.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Lihat catatan" })).toBeVisible();
  await page.getByRole("button", { name: "Catat lagi" }).click();
  await expect(page.getByLabel("Nominal")).toHaveValue("");
});

test("an empty amount keeps the form and names the issue", async ({ page }) => {
  await signIn(page);
  await page.goto("/catat/pengeluaran");
  await page.getByRole("button", { name: "Simpan pengeluaran" }).click();
  await expect(page.getByText("Isi nominal.")).toBeVisible();
  await expect(page.getByLabel("Nominal")).toBeVisible();
});

test("the cutover-day question skips a record already in the opening balance", async ({ page }) => {
  await signIn(page);
  await page.goto("/catat/pengeluaran");
  await page.getByLabel("Nominal").fill("15.000");
  await page.getByLabel("Tanggal").fill(daysAgo(3));
  await page.getByRole("button", { name: "Simpan pengeluaran" }).click();
  await expect(page.getByText("Sudah termasuk saldo awal?")).toBeVisible();
  await page.getByRole("button", { name: "Ya, sudah termasuk" }).click();
  await expect(page.getByText("Tidak dicatat ulang")).toBeVisible();
});

test("transfer records", async ({ page }) => {
  await signIn(page);
  await page.goto("/catat/transfer");
  await page.getByLabel("Nominal transfer").fill("10.000");
  await page.getByRole("button", { name: "Simpan transfer" }).click();
  await expect(page.getByText("Catatan sudah masuk ke Aktivitas dan saldo tercatat.")).toBeVisible();
});

test("dana titipan receipt records", async ({ page }) => {
  await signIn(page);
  await page.goto("/catat/dana-titipan");
  await page.getByLabel("Nominal").fill("10.000");
  await page.getByRole("button", { name: "Simpan", exact: true }).click();
  await expect(page.getByText("Catatan sudah masuk ke Aktivitas dan saldo tercatat.")).toBeVisible();
});
```

- [ ] **Step 2: Run them against the current forms**

Run: `pnpm test:e2e tests/e2e/recording.spec.ts`
Expected: PASS. These pin today's behavior; the refactor must keep them green.

- [ ] **Step 3: Create `src/components/recording-form.tsx`**

```tsx
"use client";

// One submit pattern for the recording forms (PRD: Form dan action behavior):
// validate locally, post once (useMutation keeps the idempotency key), ask the
// cutover-day question when the server needs it, then show the acknowledged
// outcome. `onReset` clears the caller's fields for `Catat lagi`.
import { AnimatePresence, m } from "motion/react";
import { useState, type ReactNode } from "react";

import { CutoverDayQuestion, FormErrors, SubmitBar, SubmitButton } from "@/components/form";
import { Recorded, type PostResult } from "@/components/recorded";
import { useMutation } from "@/lib/api-client";

export function RecordingForm(props: {
  path: string;
  submitLabel: string;
  validate: () => string[];
  body: () => Record<string, unknown>;
  onReset: () => void;
  children: ReactNode;
}) {
  const save = useMutation<Record<string, unknown>, PostResult>(props.path);
  const [done, setDone] = useState<PostResult | null>(null);
  const [formKey, setFormKey] = useState(0);

  async function submit(cutoverDayAnswer?: "ALREADY_IN_OPENING" | "NOT_IN_OPENING") {
    const issues = props.validate();
    if (issues.length) {
      save.setError(issues);
      return;
    }
    const result = await save.submit({ ...props.body(), ...(cutoverDayAnswer ? { cutoverDayAnswer } : {}) });
    if (result.ok) setDone(result.data);
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      {done ? (
        <m.div key="done" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
          <Recorded
            result={done}
            onAgain={() => {
              setDone(null);
              props.onReset();
              setFormKey((key) => key + 1);
            }}
          />
        </m.div>
      ) : (
        <m.form
          key={`form-${formKey}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="max-w-xl space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            await submit();
          }}
        >
          {props.children}
          {save.needsCutoverAnswer ? <CutoverDayQuestion pending={save.pending} onAnswer={(answer) => submit(answer)} /> : null}
          <FormErrors errors={save.error} />
          <SubmitBar>
            <SubmitButton pending={save.pending}>{props.submitLabel}</SubmitButton>
          </SubmitBar>
        </m.form>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 4: Move the three forms onto it**

For each form, delete `formKey`, `done`, `save`, `submit`, the `if (done)` block, and the `<form>` wrapper with its cutover question, errors, and submit bar. Return `<RecordingForm …>{fields}</RecordingForm>` instead, keeping every field and every piece of logic that is not about submitting.

`special-expense-form.tsx`:

```tsx
    <RecordingForm
      path="/api/v1/special-expenses"
      submitLabel="Simpan pengeluaran"
      validate={() => [...(amount ? [] : ["Isi nominal."]), ...(category === NEW_CATEGORY && !newCategory.trim() ? ["Isi nama kategori baru."] : [])]}
      body={() => ({
        amount,
        ...(category === NEW_CATEGORY ? { newCategoryName: newCategory.trim() } : { categoryId: category }),
        sourceAccountId: source,
        businessDate: date,
        note: note.trim() || undefined,
      })}
      onReset={() => {
        setAmount(null);
        setNote("");
      }}
    >
```

`transfer-form.tsx` (compute `const external = includesExternal ? components.filter((c) => c.subjectId) : [];` in the component body):

```tsx
    <RecordingForm
      path="/api/v1/transfers"
      submitLabel="Simpan transfer"
      validate={() => [
        ...(amount ? [] : ["Isi nominal transfer."]),
        ...(source === destination ? ["Akun asal dan tujuan harus berbeda."] : []),
        ...(external.some((c) => !c.amount) ? ["Isi nominal setiap bagian dana titipan."] : []),
      ]}
      body={() => ({
        sourceAccountId: source,
        destinationAccountId: destination,
        amount,
        externalComponents: external.map((c) => ({ subjectId: c.subjectId, amount: c.amount })),
        businessDate: date,
        note: note.trim() || undefined,
      })}
      onReset={() => {
        setAmount(null);
        setNote("");
        setComponents([]);
        setIncludesExternal(false);
      }}
    >
```

`external-movement-form.tsx`:

```tsx
    <RecordingForm
      path="/api/v1/external-movements"
      submitLabel="Simpan"
      validate={() => [
        ...(amount ? [] : ["Isi nominal."]),
        ...(subject === NEW_SUBJECT && !subjectName.trim() ? ["Isi nama pemilik dana."] : []),
        ...(type === "INTERNAL_TRANSFER" && account === toAccount ? ["Akun asal dan tujuan harus berbeda."] : []),
      ]}
      body={() => ({
        type,
        ...(type === "INTERNAL_TRANSFER" ? { fromAccountId: account, toAccountId: toAccount } : { accountId: account }),
        ...(subject === NEW_SUBJECT ? { subjectName: subjectName.trim() } : { subjectId: subject }),
        amount,
        businessDate: date,
        note: note.trim() || undefined,
      })}
      onReset={() => {
        setAmount(null);
        setNote("");
      }}
    >
```

Remove imports that become unused (`useMutation`, `Recorded`, `CutoverDayQuestion`, `FormErrors`, `SubmitBar`, `SubmitButton`).

- [ ] **Step 5: Run the tests**

Run: `pnpm test:e2e tests/e2e/recording.spec.ts && pnpm lint && pnpm typecheck && pnpm vitest run --project unit`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/recording-form.tsx 'src/app/(app)/catat/pengeluaran/special-expense-form.tsx' 'src/app/(app)/catat/transfer/transfer-form.tsx' src/components/external-movement-form.tsx tests/e2e/recording.spec.ts
git commit -m "refactor(forms): one submit pattern for the recording forms"
```

---

### Task 8: Full suite, visual pass, and docs

**Files:**
- Modify: `docs/implementation-plan.md` (S16 row), `PRD.md` (P3 notes and footer)

- [ ] **Step 1: Full suite**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm build && pnpm test:e2e && pnpm test:e2e:prod`
Expected: all green. Note the `First Load JS` of `/` in the build output.

- [ ] **Step 2: Visual pass**

Capture frames of the sheet opening, a swap in Rutinitas, a toast, and an onboarding step change in light and dark at 390px with Playwright, and check that nothing moves with reduced motion.

- [ ] **Step 3: Docs**

`docs/implementation-plan.md`: start the S16 exit-criteria cell with `Selesai;`. `PRD.md` P3: add that native `<details>` animate with CSS `::details-content`, that the recording outcome fades in, and that the toast confirms in-place Rutinitas actions only. Footer: `Slices 0–16 implemented`.

- [ ] **Step 4: Commit**

```bash
git add docs/implementation-plan.md PRD.md
git commit -m "docs: mark S16 complete"
```
