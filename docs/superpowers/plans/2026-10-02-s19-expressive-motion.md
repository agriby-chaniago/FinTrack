# S19 Expressive-Calm Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the eight animations the owner picked from the interactive demo (PRD v0.21 P9) without ever showing a wrong amount, and keep reduced-motion users completely still.

**Architecture:** Entrances are CSS keyframes in `src/app/globals.css` that run once when an element mounts (`backwards` fill, so server HTML is final at rest). The headline count-up follows the Next.js "preventing flash before hydration" guide: the server renders the exact amount, an inline script counts it up during HTML parsing on a full page load, and a layout effect does the same after a client navigation. Both paths run one self-contained function from `src/lib/count-up.ts`, serialized with `Function.prototype.toString`. Motion (`motion/react`) still owns the `+ Catat` sheet; Chart.js gets its draw-in from a pure options builder in `src/lib/chart-motion.ts`.

**Tech Stack:** Next.js 16.3 App Router, React 19.2, Tailwind 4 (individual `translate`/`scale`/`rotate` properties), `motion` 13.4, Chart.js 4.5, Vitest (unit project), Playwright (Pixel 7 project).

**Spec:** `PRD.md` → `Visual refresh dan fitur pasca-MVP (v0.20)` → P9 (v0.21, LOCKED), plus `Motion` and `Typography dan density` in `Visual language dan component behavior`. Demo the owner used: https://claude.ai/artifact/VQaRqtTRa5KECuYuFLsCeb.

## Global Constraints

- One easing: `cubic-bezier(0.2, 0.7, 0.2, 1)` (`--ease-calm` in CSS, `[0.2, 0.7, 0.2, 1]` in Motion).
- Durations: section rise 260 ms, 50 ms apart, last delay 300 ms; count-up 600 ms; progress fill 600 ms after 250 ms; strip and segment pop 40 ms apart; hover/press 160 ms (`duration-150` in Tailwind); sheet 220 ms; drawn check 400 ms after 120 ms; chart 700 ms in total; toast countdown equals the toast lifetime, 3.5 s.
- Count-up only on the Beranda `Personal cash tercatat` amount. Money math stays in `BigInt`; the only `number` is the 0–1 progress.
- Server HTML always holds the final state; nothing waits for JavaScript to become visible.
- `prefers-reduced-motion: reduce`: no movement, rotation, counting, or drawing; every animation and transition delay becomes 0; Chart.js `animation: false`; the toast countdown is hidden.
- Radius 0 everywhere (P7); `src/lib/square-geometry.test.ts` stays green.
- No new dependencies. No database or API changes; query budgets do not change.

## Review Focus

1. A full page load must never paint the exact amount and then jump to Rp0. Pinned in Task 3 (`the headline counts up on a full page load`: the recorded texts start at Rp0, never go down, and end on the exact amount).
2. A client navigation back to Beranda must count up again, and a re-render with the same amount must not restart it. Pinned in Task 3 (`the headline counts up again after a client navigation`).
3. A reduced-motion user must see the exact amount at once and no section must wait on a delay. Pinned in Task 3 (`reduced motion shows the exact headline at once`) and Task 2 (`reduced motion drops every animation delay`).
4. A negative personal cash value must count toward the negative amount with the leading `−` sign. Pinned in Task 3 (`countUpText` unit tests).
5. Switching the theme while the Laporan chart is open must recolor without replaying the draw-in. Pinned in Task 6 (`recolor` uses `chart.update("none")`; unit test on `chartMotion`).

---

### Task 1: PRD v0.21 P9

**Files:**
- Modify: `PRD.md` (metadata, `Typography dan density`, `Motion`, P3, new P9, `Tidak termasuk MVP`, acceptance criteria, superseded table, decision log, footer)
- Modify: `docs/implementation-plan.md` (S19 row, plan link)

- [ ] **Step 1:** Add P9 after P8 with the bullets in the Global Constraints above, mark it LOCKED (owner chose all eight on 2 October 2026), and edit each superseded rule so it names P9 as the exception. Bump the version to 0.21.
- [ ] **Step 2:** Add the S19 row (`Sedang dikerjakan`) and `Rencana S19` link.
- [ ] **Step 3: Commit**

```bash
git add PRD.md docs/implementation-plan.md docs/superpowers/plans/2026-10-02-s19-expressive-motion.md
git commit -m "docs: PRD v0.21 P9 expressive-calm motion and the S19 plan"
```

### Task 2: Motion keyframes, reduced-motion delays, and the page stagger

**Files:**
- Create: `src/lib/motion-css.test.ts`
- Modify: `src/app/globals.css`
- Modify: the root `<div>` of `src/app/(app)/page.tsx`, `rutinitas/page.tsx`, `rutinitas/settlement/[id]/page.tsx`, `aktivitas/page.tsx`, `aktivitas/[id]/page.tsx`, `aktivitas/laporan/page.tsx`, `akun/page.tsx`, `akun/[id]/page.tsx`, `akun/dana-titipan/[id]/page.tsx`, `akun/saldo-awal/page.tsx`, `pengaturan/page.tsx` (add `stagger`)
- Test: `tests/e2e/motion.spec.ts`

**Interfaces:**
- Produces CSS classes used by later tasks: `stagger`, `fill-in`, `pop-in`, `draw-check`, `toast-timer`, and the token `--ease-calm`.

- [ ] **Step 1: Write the failing unit test** `src/lib/motion-css.test.ts`

```ts
// Guards the expressive-calm motion rules (PRD v0.21 P9) in globals.css.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");
const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));

describe("motion css", () => {
  it("defines every P9 keyframe", () => {
    for (const name of ["rise", "fill", "pop", "draw", "drain"]) expect(css).toContain(`@keyframes ${name} {`);
  });

  it("staggers sections 50 ms apart and never waits longer than 300 ms", () => {
    const delays = [...css.matchAll(/\.stagger > [^{]+\{\s*animation-delay: (\d+)ms;/g)].map((m) => Number(m[1]));
    expect(delays).toEqual([50, 100, 150, 200, 250, 300]);
  });

  it("removes every delay and the toast countdown under reduced motion", () => {
    expect(reduced).toContain("animation-delay: 0s !important;");
    expect(reduced).toContain("transition-delay: 0s !important;");
    expect(reduced).toMatch(/\.toast-timer \{\s*display: none;/);
  });
});
```

- [ ] **Step 2:** Run `pnpm vitest run --project unit src/lib/motion-css.test.ts`. Expected: FAIL (no keyframes, no delay rule).

- [ ] **Step 3: Implement.** Replace the reduced-motion block in `globals.css` and append the P9 rules after the `main > *` fade:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition-duration: 0.01ms !important;
    transition-delay: 0s !important;
    animation-duration: 0.01ms !important;
    animation-delay: 0s !important;
  }

  .toast-timer {
    display: none;
  }
}
```

```css
/* Expressive-calm motion (PRD v0.21 P9). Each entrance runs once when its element
   mounts and fills backwards, so server HTML is already final at rest. */
:root {
  --ease-calm: cubic-bezier(0.2, 0.7, 0.2, 1);
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
}

@keyframes fill {
  from {
    transform: scaleX(0);
  }
}

@keyframes pop {
  from {
    opacity: 0;
    transform: scale(0.6);
  }
}

@keyframes draw {
  from {
    stroke-dashoffset: 1;
  }
}

@keyframes drain {
  to {
    transform: scaleX(0);
  }
}

/* Page sections rise one after another, once per page open. */
.stagger > * {
  animation: rise 260ms var(--ease-calm) backwards;
}

.stagger > :nth-child(2) {
  animation-delay: 50ms;
}

.stagger > :nth-child(3) {
  animation-delay: 100ms;
}

.stagger > :nth-child(4) {
  animation-delay: 150ms;
}

.stagger > :nth-child(5) {
  animation-delay: 200ms;
}

.stagger > :nth-child(6) {
  animation-delay: 250ms;
}

.stagger > :nth-child(n + 7) {
  animation-delay: 300ms;
}

/* Progress fills from empty; callers may override the delay inline. */
.fill-in {
  transform-origin: left;
  animation: fill 600ms var(--ease-calm) 250ms backwards;
}

/* Markers pop in; callers set the delay inline so they arrive in order. */
.pop-in {
  animation: pop 220ms var(--ease-calm) backwards;
}

/* A success check draws itself (path uses pathLength="1"). */
.draw-check {
  stroke-dasharray: 1 2;
  animation: draw 400ms var(--ease-calm) 120ms backwards;
}

/* The toast countdown drains over the toast lifetime (duration set inline). */
.toast-timer {
  transform-origin: left;
  animation-name: drain;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}
```

Then add `stagger` to each listed page's root `<div>` (`<div>` → `<div className="stagger">`, `<div className="space-y-8">` → `<div className="stagger space-y-8">`).

- [ ] **Step 4:** Run the unit test again. Expected: PASS.

- [ ] **Step 5: Add the e2e tests** to `tests/e2e/motion.spec.ts`:

```ts
test("page sections rise in one after another", async ({ page }) => {
  await signIn(page);
  const sections = page.locator("main .stagger > *");
  await expect.poll(() => sections.nth(1).evaluate((el) => getComputedStyle(el).animationName)).toBe("rise");
  const delays = await sections.evaluateAll((els) => els.slice(0, 3).map((el) => getComputedStyle(el).animationDelay));
  expect(delays).toEqual(["0s", "0.05s", "0.1s"]);
});

test("reduced motion drops every animation delay", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  const delays = await page.locator("main .stagger > *").evaluateAll((els) => els.map((el) => getComputedStyle(el).animationDelay));
  expect(delays.length).toBeGreaterThan(2);
  expect(new Set(delays)).toEqual(new Set(["0s"]));
});
```

- [ ] **Step 6:** Run `pnpm test:e2e tests/e2e/motion.spec.ts`. Expected: PASS, including the existing fade-in test.
- [ ] **Step 7: Commit** `feat(motion): staggered page sections and shared P9 keyframes`.

### Task 3: Headline count-up without a flash

**Files:**
- Create: `src/lib/count-up.ts`, `src/lib/count-up.test.ts`, `src/components/inline-script.tsx`, `src/components/count-up-money.tsx`
- Modify: `src/app/(app)/page.tsx` (headline uses `CountUpMoney`), `src/app/globals.css` (`.tabular` comment)
- Test: `tests/e2e/motion.spec.ts`

**Interfaces:**
- Produces: `COUNT_UP_MS: 600`, `countUpText(minor: bigint, progress: number): string`, `runCountUp(el: HTMLElement | null, text: (minor: bigint, progress: number) => string, duration: number): void` from `@/lib/count-up`; `InlineScript({ html })`; `CountUpMoney({ value }: { value: string })`.

- [ ] **Step 1: Write the failing unit test** `src/lib/count-up.test.ts`

```ts
import { describe, expect, it } from "vitest";

import { countUpText } from "./count-up";

describe("countUpText", () => {
  it("starts at Rp0", () => {
    expect(countUpText(1_245_000_000n, 0)).toBe("Rp0");
  });

  it("eases out and shows whole thousands while counting", () => {
    // ease-out cubic at 0.5 is 0.875 → 10.893.750 rupiah, shown as 10.893.000.
    expect(countUpText(1_245_000_000n, 0.5)).toBe("Rp10.893.000");
  });

  it("reaches the whole-thousand amount at the end and clamps beyond it", () => {
    expect(countUpText(83_199_993n, 1)).toBe("Rp831.000");
    expect(countUpText(1_245_000_000n, 1.4)).toBe("Rp12.450.000");
  });

  it("counts toward a negative amount with the leading minus sign", () => {
    expect(countUpText(-5_000_000n, 0)).toBe("Rp0");
    expect(countUpText(-5_000_000n, 1)).toBe("−Rp50.000");
  });

  it("is self-contained, so it can run from an inline script", () => {
    const rebuilt = new Function(`return (${countUpText})`)() as typeof countUpText;
    expect(rebuilt(1_245_000_000n, 0.5)).toBe("Rp10.893.000");
  });
});
```

- [ ] **Step 2:** Run `pnpm vitest run --project unit src/lib/count-up.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `src/lib/count-up.ts`

```ts
// Headline count-up (PRD v0.21 P9). Both functions are also serialized into an
// inline script for the first paint (Function.prototype.toString), so each must
// stay self-contained: no imports, no module-level values, browser globals only.

export const COUNT_UP_MS = 600;

/** Text at `progress` (0–1) of a count-up toward `minor` sen: eased out, whole thousands of rupiah, BigInt only. */
export function countUpText(minor: bigint, progress: number): string {
  const negative = minor < 0n;
  const rupiah = (negative ? -minor : minor) / 100n;
  const t = Math.min(Math.max(progress, 0), 1);
  const eased = 1 - Math.pow(1 - t, 3);
  const thousands = (rupiah * BigInt(Math.round(eased * 10000))) / 10_000_000n;
  const grouped = (thousands * 1000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative && thousands > 0n ? "−" : ""}Rp${grouped}`;
}

/**
 * Counts `el` up once, from Rp0 to the exact text it already shows. The amount in
 * sen is in `data-count-up`. Does nothing under reduced motion, stops as soon as
 * React renders a different amount, and waits while the element is still hidden
 * (a streamed boundary not yet revealed).
 */
export function runCountUp(el: HTMLElement | null, text: (minor: bigint, progress: number) => string, duration: number): void {
  if (!el || el.hasAttribute("data-counted")) return;
  el.setAttribute("data-counted", "");
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const amount = el.getAttribute("data-count-up") ?? "0";
  const minor = BigInt(amount);
  const exact = el.textContent;
  el.textContent = text(minor, 0);
  let start = -1;
  const frame = (now: number) => {
    if (!el.isConnected || el.getAttribute("data-count-up") !== amount) return;
    if (el.getClientRects().length === 0) {
      requestAnimationFrame(frame);
      return;
    }
    if (start < 0) start = now;
    const progress = (now - start) / duration;
    el.textContent = progress >= 1 ? exact : text(minor, progress);
    if (progress < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
```

`src/components/inline-script.tsx` (from `node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md`):

```tsx
// Runs during HTML parsing on a full page load and stays inert after a client
// navigation (text/plain), so React never renders an executable script.
export function InlineScript({ html }: { html: string }) {
  return <script type={typeof window === "undefined" ? "text/javascript" : "text/plain"} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: html }} />;
}
```

`src/components/count-up-money.tsx`:

```tsx
"use client";

// Headline amount that counts up once when it appears (PRD v0.21 P9). The server
// HTML holds the exact amount. On a full page load the inline script counts it up
// before the first paint; after a client navigation the layout effect does.
import { useId, useLayoutEffect, useRef } from "react";

import { InlineScript } from "@/components/inline-script";
import { COUNT_UP_MS, countUpText, runCountUp } from "@/lib/count-up";
import { money } from "@/lib/format";
import { parseIdrDecimal } from "@/lib/money";

export function CountUpMoney({ value }: { value: string }) {
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => runCountUp(ref.current, countUpText, COUNT_UP_MS), []);
  return (
    <>
      <span id={id} ref={ref} data-count-up={parseIdrDecimal(value).toString()} suppressHydrationWarning className="tabular whitespace-nowrap">
        {money(value)}
      </span>
      <InlineScript html={`(${runCountUp})(document.getElementById(${JSON.stringify(id)}),${countUpText},${COUNT_UP_MS})`} />
    </>
  );
}
```

In `src/app/(app)/page.tsx`, replace `<Money value={data.personalCashRecorded} />` in the headline with `<CountUpMoney value={data.personalCashRecorded} />`. In `globals.css`, change the `.tabular` comment to: `/* Financial numbers never shift width; only the Beranda headline counts up (PRD v0.21 P9). */`.

- [ ] **Step 4:** Run the unit test. Expected: PASS.

- [ ] **Step 5: Add the e2e tests** to `tests/e2e/motion.spec.ts`:

```ts
type Recorder = { __headline: string[] };

/** Records every text the headline amount shows, from the first parsed byte of each page. */
const recordHeadline = (page: Page) =>
  page.addInitScript(() => {
    const seen: string[] = ((window as unknown as Recorder).__headline = []);
    new MutationObserver(() => {
      const text = document.querySelector("[data-count-up]")?.textContent;
      if (text && text !== seen.at(-1)) seen.push(text);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });

const recorded = (page: Page) => page.evaluate(() => (window as unknown as Recorder).__headline);
const digits = (text: string) => BigInt(text.replace(/\D/g, "") || "0");

/** The exact headline text, derived from the amount in sen (whole rupiah drop ",00"). */
async function exactHeadline(page: Page) {
  const minor = BigInt((await page.locator("[data-count-up]").getAttribute("data-count-up"))!);
  const absolute = minor < 0n ? -minor : minor;
  return `${absolute / 100n}${absolute % 100n === 0n ? "" : (absolute % 100n).toString().padStart(2, "0")}`;
}

async function expectCountedUp(page: Page) {
  const exact = await exactHeadline(page);
  await expect.poll(async () => (await recorded(page)).at(-1)?.replace(/\D/g, "")).toBe(exact);
  const texts = await recorded(page);
  const from = texts.indexOf("Rp0");
  expect(from).toBeGreaterThanOrEqual(0);
  const values = texts.slice(from).map(digits);
  expect(values.every((value, i) => i === 0 || value >= values[i - 1])).toBe(true);
  expect(values.length).toBeGreaterThan(2);
}

test("the headline counts up on a full page load", async ({ page }) => {
  await signIn(page);
  await recordHeadline(page);
  await page.goto("/");
  await expectCountedUp(page);
});

test("the headline counts up again after a client navigation", async ({ page }) => {
  await signIn(page);
  const nav = page.getByRole("navigation", { name: "Navigasi utama" });
  await nav.getByRole("link", { name: "Rutinitas" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Rutinitas" })).toBeVisible();
  await page.evaluate(() => {
    const seen: string[] = ((window as unknown as Recorder).__headline = []);
    new MutationObserver(() => {
      const text = document.querySelector("[data-count-up]")?.textContent;
      if (text && text !== seen.at(-1)) seen.push(text);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await nav.getByRole("link", { name: "Beranda" }).click();
  await expectCountedUp(page);
});

test("reduced motion shows the exact headline at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  await recordHeadline(page);
  await page.goto("/");
  await expect(page.locator("[data-count-up]")).toHaveAttribute("data-counted", "");
  expect(await recorded(page)).not.toContain("Rp0");
  expect((await page.locator("[data-count-up]").textContent())!.replace(/\D/g, "")).toBe(await exactHeadline(page));
});
```

- [ ] **Step 6:** Run `pnpm test:e2e tests/e2e/motion.spec.ts` and, after `pnpm build`, `pnpm test:e2e:prod` (the inline script must survive production minification). Expected: PASS.
- [ ] **Step 7: Commit** `feat(motion): count up the Beranda headline without a flash`.

### Task 4: Progress fill and the week strip

**Files:**
- Modify: `src/components/ui.tsx` (`ProgressBar`, `SegmentBar`), `src/app/(app)/page.tsx` (`WeekStrip`)
- Test: `tests/e2e/motion.spec.ts`

- [ ] **Step 1: Write the failing e2e test**

```ts
test("progress fills and the week strip pops in order", async ({ page }) => {
  await signIn(page);
  const bar = page.getByRole("progressbar", { name: "Kelayakan tren mingguan" }).locator("div");
  expect(await bar.evaluate((el) => getComputedStyle(el).animationName)).toBe("fill");
  const markers = page.getByRole("list", { name: "Income harian minggu berjalan" }).locator("li > span:first-child");
  const timing = await markers.evaluateAll((els) => els.slice(0, 3).map((el) => `${getComputedStyle(el).animationName} ${getComputedStyle(el).animationDelay}`));
  expect(timing).toEqual(["pop 0.3s", "pop 0.34s", "pop 0.38s"]);
});
```

- [ ] **Step 2:** Run it. Expected: FAIL (`none`).
- [ ] **Step 3: Implement.** `ProgressBar` inner bar gets `fill-in`; `SegmentBar` done segments get `fill-in` and `style={{ animationDelay: `${250 + i * 40}ms` }}`; `WeekStrip` maps with an index and gives each marker span `pop-in` and `style={{ animationDelay: `${300 + index * 40}ms` }}`.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(motion): progress fills and the week strip pops in`.

### Task 5: Hover and press, the rotating `+ Catat`, and the sheet rise

**Files:**
- Create: `src/components/use-media-query.ts`
- Modify: `src/components/ui.tsx` (`buttonClass`, new `cardLinkClass`), `src/app/(app)/page.tsx` and `src/app/(app)/akun/page.tsx` (account cards), `src/components/app-shell.tsx` (`catatIcon`, both Catat buttons, `CatatSheet`), `src/app/(app)/aktivitas/laporan/trend-chart.tsx` (use the hook)
- Test: `tests/e2e/motion.spec.ts`

**Interfaces:**
- Produces: `useMediaQuery(query: string): boolean` (false on the server), `cardLinkClass: string`.

- [ ] **Step 1: Write the failing e2e tests**

```ts
test("+ Catat turns into a close mark while the sheet is open", async ({ page }) => {
  await signIn(page);
  const state = await page.evaluate(async () => {
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Catat" && b.checkVisibility())!;
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 400));
    return `${button.getAttribute("aria-expanded")} ${getComputedStyle(button.querySelector("svg")!).rotate}`;
  });
  expect(state).toBe("true 45deg");
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Catat" })).toHaveAttribute("aria-expanded", "false");
});

test("account cards give a little when pressed", async ({ page }) => {
  await signIn(page);
  const card = page.locator("main a[href^='/akun/']").first();
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + 12, box.y + 12);
  await page.mouse.down();
  await expect.poll(() => card.evaluate((el) => getComputedStyle(el).scale)).toBe("0.98");
  await page.mouse.up();
});
```

- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.**

`src/components/use-media-query.ts`:

```ts
"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Whether `query` matches; false on the server and during hydration. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => matchMedia(query).matches, () => false);
}
```

`ui.tsx`: in `buttonClass.primary`, `.secondary`, and `.danger`, replace `transition-colors duration-150` with `transition-[color,background-color,border-color,scale] duration-150 active:scale-[0.98]`, and add

```ts
/** A card that opens a detail: lifts 2px on hover, gives 2% when pressed (PRD v0.21 P9). */
export const cardLinkClass =
  "block border border-border bg-surface p-4 transition-[translate,scale,border-color] duration-150 ease-out hover:-translate-y-0.5 hover:border-control active:scale-[0.98] md:p-5";
```

Use `cardLinkClass` for the account card links on Beranda and Akun.

`app-shell.tsx`: `catatIcon` becomes `<Icon name="plus" className="-ml-1 size-4 transition-[rotate] duration-200 ease-out group-aria-expanded:rotate-45" />`; both Catat buttons get `group`, `aria-haspopup="dialog"`, `aria-expanded={catatOpen}`, and `active:scale-[0.98]` with `scale` in their transition. In `CatatSheet`, replace `useSlide(24)` with:

```tsx
const reduced = useReducedMotion();
const wide = useMediaQuery("(min-width: 48rem)");
// Phone: the sheet rises from the bottom edge. Desktop: the centered popover rises 16px.
const hidden = reduced ? { opacity: 0 } : wide ? { opacity: 0, y: 16 } : { y: "100%" };
```

and use `initial={hidden} animate={{ opacity: 1, y: 0 }} exit={hidden} transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}`. `trend-chart.tsx` uses `useMediaQuery("(min-width: 48rem)")` instead of its own `subscribe`.

- [ ] **Step 4:** Run the motion spec. Expected: PASS, including `the + Catat sheet slides in` and `reduced motion keeps the sheet still`.
- [ ] **Step 5: Commit** `feat(motion): card lift and press, rotating + Catat, rising sheet`.

### Task 6: Drawn success check and the toast countdown

**Files:**
- Modify: `src/components/ui.tsx` (new `DrawnCheck`, `Alert` success icon), `src/components/toast.tsx`
- Test: `tests/e2e/motion.spec.ts` (extend the toast test)

**Interfaces:**
- Produces: `DrawnCheck({ className }: { className?: string })`.

- [ ] **Step 1: Extend the failing test** `confirming an occurrence shows a toast and the confirmed state`, right after the toast is visible:

```ts
expect(await toast.locator(".toast-timer").evaluate((el) => `${getComputedStyle(el).animationName} ${getComputedStyle(el).animationDuration}`)).toBe("drain 3.5s");
expect(await toast.locator("svg path").evaluate((el) => getComputedStyle(el).animationName)).toBe("draw");
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement.**

```tsx
/** A check that draws itself once when it appears (PRD v0.21 P9). */
export function DrawnCheck({ className = "size-4" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className={`${className} shrink-0`}>
      <path d="M4 10.5 8 14.5 16.5 6" pathLength={1} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="square" className="draw-check" />
    </svg>
  );
}
```

`Alert` renders `<DrawnCheck className="mt-0.5 size-4" />` for `tone === "success"` and the current `Icon` otherwise. `toast.tsx`: `const TOAST_MS = 3500;` drives the timeout; the toast becomes an `m.div` holding the message row (`<p className="flex items-center gap-2 px-4 py-3"><DrawnCheck />…</p>`) and `<span aria-hidden="true" className="toast-timer block h-0.5 bg-current opacity-40" style={{ animationDuration: `${TOAST_MS}ms` }} />`.

- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(motion): drawn success check and toast countdown`.

### Task 7: Chart draw-in

**Files:**
- Create: `src/lib/chart-motion.ts`, `src/lib/chart-motion.test.ts`
- Modify: `src/app/(app)/aktivitas/laporan/chart-canvas.tsx`

**Interfaces:**
- Produces: `CHART_DRAW_MS: 700`, `chartMotion(kind: "line" | "bar", points: number, reduced: boolean)` returning `{ animation: false }` or Chart.js `animation`/`animations` options.

- [ ] **Step 1: Write the failing unit test**

```ts
import { describe, expect, it } from "vitest";

import { chartMotion } from "./chart-motion";

type Delay = (ctx: Record<string, unknown>) => number;

describe("chartMotion", () => {
  it("turns animation off under reduced motion", () => {
    expect(chartMotion("line", 4, true)).toEqual({ animation: false });
    expect(chartMotion("bar", 6, true)).toEqual({ animation: false });
  });

  it("draws a line from the left within 700 ms", () => {
    const motion = chartMotion("line", 4, false) as { animations: { x: { duration: number; delay: Delay } } };
    expect(motion.animations.x.duration).toBe(175);
    const ctx = { type: "data", index: 3 };
    expect(motion.animations.x.delay(ctx)).toBe(525);
    expect(motion.animations.x.delay(ctx)).toBe(0);
    expect(motion.animations.x.delay({ type: "dataset", index: 0 })).toBe(0);
  });

  it("grows bars one after another within 700 ms", () => {
    const motion = chartMotion("bar", 6, false) as { animation: { duration: number; delay: Delay } };
    expect(motion.animation.duration).toBe(400);
    expect(motion.animation.delay({ type: "data", mode: "default", dataIndex: 5 })).toBe(250);
    expect(motion.animation.delay({ type: "data", mode: "resize", dataIndex: 5 })).toBe(0);
  });
});
```

- [ ] **Step 2:** Run it. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `src/lib/chart-motion.ts`

```ts
// Chart draw-in (PRD v0.21 P9): a line draws from left to right, bars grow one
// after another, 700 ms in total; no animation under reduced motion.
import type { Chart } from "chart.js";

export const CHART_DRAW_MS = 700;
const BAR_GROW_MS = 400;

type DrawContext = { type: string; mode?: string; index: number; dataIndex: number; datasetIndex: number; chart: Chart; xStarted?: boolean; yStarted?: boolean };

export function chartMotion(kind: "line" | "bar", points: number, reduced: boolean) {
  if (reduced) return { animation: false as const };
  if (kind === "bar") {
    const gap = (CHART_DRAW_MS - BAR_GROW_MS) / Math.max(points - 1, 1);
    return {
      animation: {
        duration: BAR_GROW_MS,
        easing: "easeOutCubic" as const,
        delay: (ctx: DrawContext) => (ctx.type === "data" && ctx.mode === "default" ? ctx.dataIndex * gap : 0),
      },
    };
  }
  const step = CHART_DRAW_MS / Math.max(points, 1);
  // Each point appears in turn and rises from the previous one, so the line extends to the right.
  const once = (flag: "xStarted" | "yStarted") => (ctx: DrawContext) => {
    if (ctx.type !== "data" || ctx[flag]) return 0;
    ctx[flag] = true;
    return ctx.index * step;
  };
  const previousY = (ctx: DrawContext) =>
    ctx.index === 0 ? ctx.chart.scales.y.getPixelForValue(0) : ctx.chart.getDatasetMeta(ctx.datasetIndex).data[ctx.index - 1].getProps(["y"], true).y;
  return {
    animation: { duration: CHART_DRAW_MS },
    animations: {
      x: { type: "number" as const, easing: "linear" as const, duration: step, from: NaN, delay: once("xStarted") },
      y: { type: "number" as const, easing: "linear" as const, duration: step, from: previousY, delay: once("yStarted") },
    },
  };
}
```

In `chart-canvas.tsx`, replace the `animation:` line with `...chartMotion(kind, labels.length, matchMedia("(prefers-reduced-motion: reduce)").matches),` and make `recolor` call `chart.update("none")`.

- [ ] **Step 4:** Run the unit test and `pnpm test:e2e tests/e2e/laporan.spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(motion): Laporan charts draw in`.

### Task 8: Verify, document, deploy

- [ ] **Step 1:** `pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm build`, then `pnpm test:e2e && pnpm test:e2e:prod`. Expected: all green.
- [ ] **Step 2:** Mark S19 `Selesai` in `docs/implementation-plan.md`, add a `Pelaksanaan S19` note under P9, and set the PRD footer to `Slices 0–19 implemented`.
- [ ] **Step 3: Commit** `docs: S19 expressive-calm motion is done`, push `main` (deploys production), and confirm the Vercel deployment is Ready and CI is green.
