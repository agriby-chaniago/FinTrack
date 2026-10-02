# S20 Meriah Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the owner's batch 2 picks (PRD v0.22 P10): the Meriah intensity for every P9 entrance plus twelve new animations, with reduced-motion users kept completely still and no amount ever shown wrong.

**Architecture:** Entrances stay CSS keyframes in `src/app/globals.css`, now driven by three tokens (`--rise-distance`, `--rise-duration`, `--ease-spring`) and an inherited `--stagger-delay`, so rows, bars, and markers inside a section start after that section. Tab slides use React `<ViewTransition>` (App Router, no config) with `Link transitionTypes`; persistent chrome is anchored with `view-transition-name`. Session memory lives in client modules: amounts seen earlier roll like an odometer over the exact text (`src/lib/odometer.ts` + `src/components/rolling-money.tsx`), and tasks seen earlier that are gone come back once to be checked off (`src/components/task-section.tsx`). A full page load has no memory, so it never replays anything.

**Tech Stack:** Next.js 16.3 App Router (React canary `ViewTransition`, `Link transitionTypes`), React 19.2, Tailwind 4, `motion` 13.4, Vitest, Playwright (Pixel 7).

**Spec:** `PRD.md` → `Visual refresh dan fitur pasca-MVP (v0.20)` → P10 (v0.22, LOCKED), with P9 for the animations it retunes. Guide: `node_modules/next/dist/docs/01-app/02-guides/view-transitions.md`. Demo the owner used: https://claude.ai/artifact/VQaRqtTRa5KECuYuFLsCeb (version 4).

## Global Constraints

- Meriah: rise 40px, 520ms, 90ms between sections, last section delay 450ms; spring easing `cubic-bezier(0.34, 1.56, 0.64, 1)`.
- Cascade: 80ms after the section, then 90ms per item, at most 8 steps; items start 30px lower at scale 0.97.
- Tab slide: old page leaves in 160ms, new page enters from 80px in 520ms, only for links between the four main tabs.
- Indicator 420ms spring; icon hop 380ms; ripple 520ms; odometer 1040ms with 40ms per digit place; sheet items 55ms apart from 90ms, icons from 140ms; today ping 700ms after 760ms; progress shine 650ms after 900ms; headline sweep 900ms after 620ms; celebration 750ms before the fold.
- No confetti. No `number` arithmetic on money; the odometer only moves digit glyphs of display strings.
- Server HTML always shows the exact, final state. Only client-side memory (this session) triggers rolls and celebrations.
- `prefers-reduced-motion: reduce`: every animation, transition, delay, iteration, and view transition is zero; ripple, shimmer, odometer, celebration, and the toast countdown do not appear.
- Radius 0 (P7) — ripples and pings are squares.

## Review Focus

1. A full page load must show exact amounts with no odometer and no replayed task. Pinned in Task 5 (`a full page load never rolls`) and Task 6 (`a full page load replays no finished task`).
2. The rolling overlay must never change the DOM text a screen reader or a test reads. Pinned in Task 5 (`rolling keeps the exact amount in the DOM`).
3. Reduced motion must produce no slide, ripple, roll, or celebration. Pinned in Task 4 (`reduced motion does not slide between tabs`), Task 5 and Task 6 reduced-motion tests, Task 7 (`reduced motion adds no ripple`).
4. Infinite animations (the skeleton shimmer) must not flicker under reduced motion. Pinned in Task 2 (`animation-iteration-count: 1 !important`).
5. When the last task is finished, Beranda must still show it being checked off before the section disappears. Pinned in Task 6 (`the last finished task still celebrates`).

---

### Task 1: PRD v0.22 P10 and this plan

- [ ] Add P10 (LOCKED) after P9, update the superseded rules (Typography, Motion, MVP exclusions, acceptance, superseded table, decision log), bump to 0.22, add the S20 row. Commit `docs: PRD v0.22 P10 Meriah motion and the S20 plan`.

### Task 2: CSS foundation

**Files:** `src/app/globals.css`, `src/lib/motion-css.test.ts`, `tests/e2e/motion.spec.ts` (P9 strip timing becomes relative).

- [ ] **Step 1: Failing unit tests** — extend `motion-css.test.ts`:

```ts
it("uses the Meriah tokens", () => {
  expect(css).toContain("--rise-distance: 40px;");
  expect(css).toContain("--rise-duration: 520ms;");
  expect(css).toContain("--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);");
});

it("staggers sections 90 ms apart and never waits longer than 450 ms", () => {
  const delays = [...css.matchAll(/\.stagger > :nth-child\([^)]+\) \{\s*--stagger-delay: (\d+)ms;/g)].map((m) => Number(m[1]));
  expect(delays).toEqual([90, 180, 270, 360, 450]);
});

it("cascades list items in at most eight steps", () => {
  const steps = [...css.matchAll(/\.cascade > :nth-child\([^)]+\) \{\s*--cascade-step: (\d+);/g)].map((m) => Number(m[1]));
  expect(steps).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
});

it("defines every P9 and P10 keyframe", () => {
  for (const name of ["rise", "rise-small", "fill", "pop", "draw", "drain", "shine-pass", "shimmer", "sweep-line", "ping", "hop", "rise-sheet", "pop-icon", "flash-success", "strike", "ripple", "tab-leave", "tab-enter"]) {
    expect(css).toContain(`@keyframes ${name} {`);
  }
});

it("stops every animation, loop, and view transition under reduced motion", () => {
  expect(reduced).toContain("animation-iteration-count: 1 !important;");
  expect(reduced).toMatch(/::view-transition-group\(\*\) \{\s*animation-duration: 0s !important;/);
  expect(reduced).toMatch(/\.toast-timer,\s*\.ripple-wave \{\s*display: none;/);
});
```

The old P9 delay test (`[50, 100, …, 300]`) is replaced by the 90 ms one.

- [ ] **Step 2:** `pnpm vitest run --project unit src/lib/motion-css.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Replace the P9 block with the P10 block: tokens on `:root`; keyframes `rise` (translateY(var(--rise-distance))), `rise-small`, `fill`, `pop`, `draw`, `drain`, `shine-pass`, `shimmer`, `sweep-line`, `ping`, `hop`, `rise-sheet`, `pop-icon`, `flash-success`, `strike`, `ripple`, `tab-leave`, `tab-enter`; classes:

```css
.stagger > * { --stagger-delay: 0ms; animation: rise var(--rise-duration) var(--ease-spring) var(--stagger-delay) backwards; }
.stagger > :nth-child(2) { --stagger-delay: 90ms; }   /* 3: 180, 4: 270, 5: 360, n + 6: 450 */
.cascade > * { --cascade-step: 0; animation: rise-small var(--rise-duration) var(--ease-spring) calc(var(--stagger-delay, 0ms) + 80ms + var(--cascade-step) * 90ms) backwards; }
.cascade > :nth-child(2) { --cascade-step: 1; }       /* … 8: 7, n + 9: 8 */
.fill-in { transform-origin: left; animation: fill 600ms var(--ease-calm) calc(var(--stagger-delay, 0ms) + 250ms) backwards; }
.pop-in { animation: pop 220ms var(--ease-spring) backwards; }
.shine { position: relative; overflow: hidden; }       /* ::after gradient, shine-pass 650ms ease-in-out, delay section + 900ms */
.shimmer { position: relative; overflow: hidden; }     /* ::after gradient, shimmer 1.1s linear infinite */
.sweep-line { position: relative; display: inline-block; } /* ::after 3px petrol, sweep-line 900ms, delay section + 620ms */
.today-ping { position: relative; }                   /* ::after square ring, ping 700ms ease-out, delay section + 760ms */
.tab-indicator { transition: translate 420ms var(--ease-spring), opacity 200ms ease-out; }
.tab-hop[aria-current="page"] > svg { animation: hop 380ms var(--ease-spring); }
.sheet-cascade > li { animation: rise-sheet 300ms var(--ease-spring) backwards; }  /* delays 90, 145, 200, 255, 310 */
.sheet-cascade .sheet-icon { animation: pop-icon 380ms var(--ease-spring) backwards; } /* delays 140, 195, 250, 305, 360 */
.celebrate { animation: flash-success 900ms ease-out 150ms; }
.celebrate-strike { transform-origin: left; animation: strike 280ms var(--ease-calm) 180ms backwards; }
.ripple-host { overflow: hidden; }
.ripple-wave { position: absolute; pointer-events: none; background: currentColor; animation: ripple 520ms ease-out forwards; }
.odo-overlay { position: absolute; inset: 0; white-space: nowrap; }
.odo { display: inline-block; height: 1lh; overflow: hidden; vertical-align: top; }
```

plus the View Transition rules (`::view-transition { pointer-events: none }`, `.tab-forward`/`.tab-back` old/new animations with `--tab-offset` = ±2 × rise distance, and `app-header`, `app-nav`, `app-sidebar`, `app-catat` groups with `animation: none; z-index: 100`, old `display: none`, new `animation: none`). Add `--shine-bar` and `--shine-skeleton` to the light, system-dark, and dark token blocks. Reduced motion adds `animation-iteration-count: 1 !important`, zero-duration view transitions, and hides `.toast-timer, .ripple-wave`.

- [ ] **Step 4:** Unit tests PASS. Update the P9 strip e2e to assert 40 ms steps between markers (`d[1] − d[0] = 0.04`) instead of absolute delays, run `pnpm test:e2e tests/e2e/motion.spec.ts` → PASS.
- [ ] **Step 5: Commit** `feat(motion): Meriah tokens, spring, and the P10 keyframes`.

### Task 3: Cascade, shimmer, shine, today ping, headline sweep

**Files:** `src/components/skeletons.tsx` (`animate-pulse` → `shimmer`), `src/components/ui.tsx` (`ProgressBar` inner bar `fill-in shine`; `SegmentBar` delay `calc(var(--stagger-delay, 0ms) + …)`), `src/app/(app)/page.tsx` (`WeekStrip` gets `today`; today's marker `today-ping outline-2 outline-offset-2 outline-primary`, label `…, hari ini`; marker delays relative; account grid `cascade`; tasks list `cascade`), `src/components/count-up-money.tsx` (visible span `sweep-line`), `cascade` on the Akun card list and lists, Aktivitas history list, Rutinitas occurrence and target lists, Laporan summary grid and category list. Tests in `tests/e2e/motion.spec.ts`.

- [ ] **Step 1: Failing e2e tests**

```ts
test("cards and rows arrive one by one after their section", async ({ page }) => {
  await signIn(page);
  const cards = page.locator("main .cascade").nth(1).locator("> *");
  const timing = await cards.evaluateAll((els) => els.map((el) => [getComputedStyle(el).animationName, parseFloat(getComputedStyle(el).animationDelay)] as const));
  expect(timing.every(([name]) => name === "rise-small")).toBe(true);
  expect(Math.round((timing[1][1] - timing[0][1]) * 1000)).toBe(90);
});

test("skeletons shimmer while a page loads", async ({ page }) => {
  await signIn(page);
  await page.route(/\/rutinitas\?_rsc=/, async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
  await page.getByRole("navigation", { name: "Navigasi utama" }).getByRole("link", { name: "Rutinitas" }).click();
  await expect.poll(() => page.locator("[data-slot=skeleton]").first().evaluate((el) => getComputedStyle(el, "::after").animationName)).toBe("shimmer");
});

test("today pulses once, progress shines, and the headline line sweeps", async ({ page }) => {
  await signIn(page);
  const today = page.getByRole("list", { name: "Income harian minggu berjalan" }).locator("li[aria-label$='hari ini'] > span:first-child");
  expect(await today.evaluate((el) => getComputedStyle(el, "::after").animationName)).toBe("ping");
  expect(await page.getByRole("progressbar", { name: "Kelayakan tren mingguan" }).locator("div").evaluate((el) => getComputedStyle(el, "::after").animationName)).toBe("shine-pass");
  expect(await page.locator("[data-count-up]").evaluate((el) => getComputedStyle(el, "::after").animationName)).toBe("sweep-line");
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. **Step 5: Commit** `feat(motion): cascading cards and rows, shimmer, shine, today ping, headline sweep`.

### Task 4: Sliding tab indicator, icon hop, and tab transitions

**Files:** Create `src/components/tab-transition.tsx`; modify `src/components/app-shell.tsx`; wrap the Beranda, Rutinitas, Aktivitas, Laporan, and Akun pages in `TabTransition`.

```tsx
// src/components/tab-transition.tsx
import { ViewTransition, type ReactNode } from "react";

const slide = { "tab-forward": "tab-forward", "tab-back": "tab-back", default: "none" };

/** A main tab's page slides with the tab order (PRD v0.22 P10); every other transition leaves it still. */
export function TabTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter={slide} exit={slide} default="none">
      {children}
    </ViewTransition>
  );
}
```

In `AppShell`: `const activeIndex = destinations.findIndex((item) => isActive(pathname, item.href));` and `const tabTypes = (index: number) => (activeIndex < 0 || index === activeIndex ? undefined : [index > activeIndex ? "tab-forward" : "tab-back"]);`. Both navs pass `transitionTypes={tabTypes(index)}` and `tab-hop` on links. The bottom nav gets `<span aria-hidden="true" className="tab-indicator absolute -top-px left-0 h-[3px] w-1/4 bg-primary" style={{ translate: `${Math.max(activeIndex, 0) * 100}% 0` }} />` (`opacity-0` when no tab is active); the sidebar nav becomes `relative` with a `tab-indicator absolute inset-x-0 top-0 h-11 bg-primary-soft` block at `translate: 0 ${index * 3}rem`, its list `relative`, and its links lose `aria-[current=page]:bg-primary-soft`. Mobile header, bottom nav, sidebar, and FAB get `viewTransitionName` `app-header`, `app-nav`, `app-sidebar`, `app-catat`.

- [ ] **Step 1: Failing e2e tests** (`tests/e2e/motion.spec.ts`)

```ts
/** Records view-transition animation names (with their duration) for 1.5 s after this call. */
function recordViewTransitions(page: Page) {
  return page.evaluate(() => {
    const seen = ((window as unknown as { __vt: string[] }).__vt = []);
    const start = performance.now();
    const tick = () => {
      for (const animation of document.getAnimations()) {
        const pseudo = (animation.effect as KeyframeEffect | null)?.pseudoElement ?? "";
        if (!pseudo.startsWith("::view-transition")) continue;
        const entry = `${(animation as CSSAnimation).animationName}:${animation.effect?.getComputedTiming().duration}`;
        if (!seen.includes(entry)) seen.push(entry);
      }
      if (performance.now() - start < 1500) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

test("switching tabs slides the page in tab order", async ({ page }) => {
  await signIn(page);
  await page.waitForLoadState("networkidle");
  await recordViewTransitions(page);
  await page.getByRole("navigation", { name: "Navigasi utama" }).getByRole("link", { name: "Rutinitas" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __vt: string[] }).__vt.join(" "))).toMatch(/tab-enter:520/);
  expect(await page.evaluate(() => (window as unknown as { __vt: string[] }).__vt.join(" "))).toMatch(/tab-leave:160/);
});

test("reduced motion does not slide between tabs", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  await page.waitForLoadState("networkidle");
  await recordViewTransitions(page);
  await page.getByRole("navigation", { name: "Navigasi utama" }).getByRole("link", { name: "Rutinitas" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Rutinitas" })).toBeVisible();
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => (window as unknown as { __vt: string[] }).__vt.filter((e) => !e.endsWith(":0")))).toEqual([]);
});

test("the tab indicator slides to the new tab and its icon hops", async ({ page }) => {
  await signIn(page);
  const nav = page.getByRole("navigation", { name: "Navigasi utama" });
  await nav.getByRole("link", { name: "Rutinitas" }).click();
  const link = nav.getByRole("link", { name: "Rutinitas" });
  await expect(link).toHaveAttribute("aria-current", "page");
  expect(await link.locator("svg").evaluate((el) => getComputedStyle(el).animationName)).toBe("hop");
  const indicator = nav.locator(".tab-indicator");
  expect(await indicator.evaluate((el) => getComputedStyle(el).transitionDuration)).toContain("0.42s");
  await expect.poll(async () => Math.round((await indicator.boundingBox())!.x - (await link.boundingBox())!.x)).toBe(0);
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run the motion and shell specs → PASS. **Step 5: Commit** `feat(motion): sliding tab indicator, icon hop, and tab transitions`.

### Task 5: Rolling digits

**Files:** Create `src/lib/odometer.ts`, `src/lib/odometer.test.ts`, `src/components/rolling-money.tsx`; modify `src/components/count-up-money.tsx` (a changed headline rolls instead of counting up) and use `RollingMoney` for the account amount on Beranda cards, Akun cards, and the Akun detail headline (`memoryKey={`account:${id}`}`).

```ts
// src/lib/odometer.ts
// Rolling digits (PRD v0.22 P10): which digit each place of a new amount rolls from.
// Pure string work on display text; no arithmetic on money.
export type OdometerCell = { digit: true; from: number; to: number; place: number } | { digit: false; text: string };

const isDigit = (char: string) => char >= "0" && char <= "9";

/** Cells of `to`; each digit rolls from the digit in the same place (from the right) of `from`, or from 0. */
export function odometerCells(from: string, to: string): OdometerCell[] {
  const fromDigits = [...from].filter(isDigit);
  const chars = [...to];
  let place = chars.filter(isDigit).length;
  return chars.map((char) => {
    if (!isDigit(char)) return { digit: false, text: char };
    place -= 1;
    const previous = fromDigits[fromDigits.length - 1 - place];
    return { digit: true, from: previous === undefined ? 0 : Number(previous), to: Number(char), place };
  });
}
```

`rolling-money.tsx` exports `rememberAmount(key, text)` (session `Map`), `rollDigits(host, from, to)` (aria-hidden `.odo-overlay` of digit columns animated with WAAPI over the host, whose own text turns transparent; removed when every column lands; returns a cleanup that lands at once), and `RollingMoney({ value, memoryKey })` (a `tabular relative whitespace-nowrap` span holding the exact `money(value)` text; a layout effect rolls from the remembered or previous text).

- [ ] **Step 1: Failing unit tests** (`src/lib/odometer.test.ts`): same length, a new leading digit rolls from 0, fractions, the minus sign stays text, places count from the right.
- [ ] **Step 2: Failing e2e tests:** after recording a Rp85.000 special expense through `+ Catat` (client navigation) and returning with `Ke Beranda`, the Jago card shows an `.odo-overlay`, its DOM text is the exact new amount throughout (`rolling keeps the exact amount in the DOM`), and the overlay is gone after 2 s; the headline rolls too and never shows Rp0. `a full page load never rolls`: after `page.goto("/")`, no `.odo-overlay` appears. Reduced motion: no overlay after the same flow.
- [ ] **Step 3:** Implement. **Step 4:** Run → PASS. **Step 5: Commit** `feat(motion): amounts roll like an odometer when they changed`.

### Task 6: Finished tasks are celebrated

**Files:** Create `src/components/task-section.tsx` (Beranda `Perlu dilakukan` as a client section that remembers the task keys, titles, and details it showed; tasks gone since then come back once as `celebrate` rows with a drawn check and `celebrate-strike`, then fold away sideways after 750 ms; the section stays until that fold ends even when no task is left) and `src/components/resolve-flash.tsx` (a Rutinitas occurrence `li` that flashes `celebrate` with a drawn-check corner badge when its status leaves `PENDING`); `AnimatedItem` gains `leaveX`; `AnimatedList` gains `onExitComplete`.

- [ ] **Step 1: Failing e2e tests:** confirming the monthly income in Rutinitas flashes its card (`flash-success`); returning to Beranda through the nav shows `Konfirmasi income bulanan` once more as a `celebrate` row whose check draws, then it is gone; `a full page load replays no finished task`; reduced motion shows no celebrate row; `the last finished task still celebrates` (a fixture whose only Beranda task is the income confirmation).
- [ ] **Step 2–4:** RED, implement, GREEN. **Step 5: Commit** `feat(motion): finished tasks are checked off on return`.

### Task 7: Ripple, sheet cascade, springy toast and sheet

**Files:** Create `src/components/ripple.ts` (`installRipple()`: one `pointerdown` listener adding a square `.ripple-wave` to the nearest enabled `.ripple-host`, skipped under reduced motion); `AppShell` installs it; `buttonClass` primary/secondary/danger, `cardLinkClass`, both Catat buttons, and the sheet links become `ripple-host relative` (the fixed FAB only `ripple-host`). `CatatSheet`: list `sheet-cascade`, icon `sheet-icon`, desktop rise 40px, spring `[0.34, 1.3, 0.64, 1]` over 0.24 s. Toast: rise 20px with spring `[0.34, 1.56, 0.64, 1]`.

- [ ] **Step 1: Failing e2e tests:** pressing `Ubah detail` adds a `.ripple-wave` inside it that animates `ripple` and is removed; reduced motion adds none; sheet choices animate `rise-sheet` 55 ms apart and icons `pop-icon`.
- [ ] **Step 2–4:** RED, implement, GREEN. **Step 5: Commit** `feat(motion): square ripples, cascading sheet, springy toast`.

### Task 8: Verify, document, deploy

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm build`, then `pnpm test:e2e && pnpm test:e2e:prod`.
- [ ] Mark S20 `Selesai`, add `Pelaksanaan S20` under P10, PRD footer `Slices 0–20 implemented`; commit `docs: S20 Meriah motion is done`; push `main`; confirm the deployment is Ready and CI is green.
