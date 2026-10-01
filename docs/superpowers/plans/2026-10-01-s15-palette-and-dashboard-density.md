# S15 Palette `Petrol & Paper` and Beranda Density Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the indigo/cool-grey palette with `Petrol & Paper` and make Beranda denser and more informative without adding charts or decoration.

**Architecture:** Tokens change only in `src/app/globals.css` (plus the two places that hard-code theme colors). A contrast test reads that file so token drift fails CI. Beranda's new elements are fed by pure helpers in `src/lib/dashboard-view.ts`. `dashboard()` returns their already-classified, JSON-safe output, adds no queries, and keeps the Beranda query budget at 44.

**Tech Stack:** Next.js 16 App Router (server components), Tailwind 4 + daisyUI 5, Drizzle on node-postgres, Vitest (unit and db projects), Playwright.

**Spec:** `PRD.md` → `Visual refresh dan fitur pasca-MVP (v0.20)`, items P1, P2, and the eligibility card from P4. Visual reference: https://claude.ai/artifact/Q4bY3aNEMPsuNpKtmq7Pyg

**Precondition:** P1, P2, and P4 are relabelled **LOCKED** in `PRD.md`. Do not start before that.

## Global Constraints

- Light tokens: canvas `#F6F5F1`, surface `#FFFFFF`, subtle `#EEECE6`, border `#E3E0D8`, control `#7F8A8F`, text `#1A1F22`, muted `#5F6B70`, primary `#0E6170`, hover `#0B4F5B`, pressed `#083E48`, primary content `#FFFFFF`, soft `#E3F2F3`, plum `#7A5AA6`.
- Dark tokens: canvas `#0D1316`, surface `#141B1F`, subtle `#1B2428`, border `#2A353B`, control `#6B7C84`, text `#F2F4F3`, muted `#9AA8AD`, primary `#4FC3CF`, hover `#7DD6DE`, pressed `#A8E5EA`, primary content `#0D1316`, soft `#0F2E33`, plum `#B9A3E0`.
- Monogram accents (light/dark): petrol `#0E6170`/`#4FC3CF`, plum `#7A5AA6`/`#B9A3E0`, ochre `#7D5F27`/`#E0B872`, sage `#4D6B57`/`#9CC9A9`. Assigned by account order, never by provider.
- Semantic pairs (`--confirmed-*`, `--calculated-*`, `--review-*`, `--danger-*`, `--success-*`, `--outflow-*`) do not change.
- Contrast floors: normal text 4.5:1; control boundary and large UI 3:1 (PRD `Accessibility`).
- Never animate or count up amounts. Money stays as decimal strings or `bigint`, never `number`.
- Every progress bar shows its numbers as text as well; meaning never relies on color alone.
- Page loads only read; no new queries on Beranda (`tests/perf/query-budget.integration.test.ts` budget stays 44).

## Review Focus

1. A first settlement period shorter than seven days (rule started mid-week) must render a strip with only that period's days, not seven. Pinned in Task 2 (`weekStrip` short-period test).
2. An overdue settlement spans several weeks. The strip must show the first unsettled period only, with no `UPCOMING` days. Pinned in Task 2 (`weekStrip` all-past test).
3. A transfer target whose linked amount exceeds the suggestion must show a full bar, not one over 100%. Pinned in Task 2 (`progressPercent` clamp test).
4. A month with no obligations must not divide by zero or show `0/0 selesai`. Pinned in Task 2 (`obligationProgress` empty test) and Task 5 (hidden when total is 0).
5. An account display name with leading spaces or an emoji must still get a readable monogram. Pinned in Task 2 (`monogramFor` tests).

---

### Task 1: `Petrol & Paper` tokens with a contrast guard

**Files:**
- Create: `src/lib/theme-tokens.test.ts`
- Modify: `src/app/globals.css` (both daisyUI theme blocks, the three token blocks, `@theme inline`)
- Modify: `src/app/layout.tsx:21-24` (`themeColor`)
- Modify: `src/app/manifest.ts:18-19`

**Interfaces:**
- Produces Tailwind colors `mono-1`…`mono-4` and `plum` (classes `bg-mono-1`, `text-mono-1`, `text-plum`, and so on) for Tasks 4–5.

- [ ] **Step 1: Write the failing test**

```ts
// Guards the Petrol & Paper tokens (PRD v0.20 P1): exact values, matching
// dark blocks, and the WCAG floors from PRD `Accessibility`.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function block(selector: RegExp): Record<string, string> {
  const match = css.match(selector);
  if (!match) throw new Error(`block not found: ${selector}`);
  return Object.fromEntries([...match[1].matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map(([, k, v]) => [k, v.toLowerCase()]));
}

const light = block(/:root,\s*\[data-theme="fintrack-light"\]\s*\{([^}]*)\}/);
const dark = block(/\[data-theme="fintrack-dark"\]\s*\{([^}]*)\}/);
const systemDark = block(/:root:not\(\[data-theme\]\)\s*\{([^}]*)\}/);

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("Petrol & Paper tokens", () => {
  it("uses the PRD values", () => {
    expect(light).toMatchObject({ canvas: "#f6f5f1", surface: "#ffffff", "surface-subtle": "#eeece6", border: "#e3e0d8", "control-boundary": "#7f8a8f", text: "#1a1f22", muted: "#5f6b70", primary: "#0e6170", "primary-hover": "#0b4f5b", "primary-pressed": "#083e48", "primary-content": "#ffffff", "primary-soft": "#e3f2f3", plum: "#7a5aa6", "mono-1": "#0e6170", "mono-2": "#7a5aa6", "mono-3": "#7d5f27", "mono-4": "#4d6b57" });
    expect(dark).toMatchObject({ canvas: "#0d1316", surface: "#141b1f", "surface-subtle": "#1b2428", border: "#2a353b", "control-boundary": "#6b7c84", text: "#f2f4f3", muted: "#9aa8ad", primary: "#4fc3cf", "primary-hover": "#7dd6de", "primary-pressed": "#a8e5ea", "primary-content": "#0d1316", "primary-soft": "#0f2e33", plum: "#b9a3e0", "mono-1": "#4fc3cf", "mono-2": "#b9a3e0", "mono-3": "#e0b872", "mono-4": "#9cc9a9" });
  });

  it("keeps the system-dark block identical to the explicit dark theme", () => {
    expect(systemDark).toEqual(dark);
  });

  for (const [name, t] of [["light", light], ["dark", dark]] as const) {
    it(`meets the contrast floors in ${name}`, () => {
      for (const bg of [t.canvas, t.surface, t["surface-subtle"]]) {
        expect(contrast(t.text, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.muted, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t["control-boundary"], bg)).toBeGreaterThanOrEqual(3);
        expect(contrast(t.primary, bg)).toBeGreaterThanOrEqual(4.5);
        for (const mono of [t["mono-1"], t["mono-2"], t["mono-3"], t["mono-4"]]) expect(contrast(mono, bg)).toBeGreaterThanOrEqual(4.5);
      }
      for (const fill of [t.primary, t["primary-hover"], t["primary-pressed"]]) expect(contrast(t["primary-content"], fill)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.primary, t["primary-soft"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.text, t["primary-soft"])).toBeGreaterThanOrEqual(4.5);
    });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run --project unit src/lib/theme-tokens.test.ts`
Expected: FAIL on `uses the PRD values` (`canvas` is `#f7f8fa`).

- [ ] **Step 3: Update `src/app/globals.css`**

In the `fintrack-light` daisyUI block, set:

```css
  --color-base-100: #ffffff;
  --color-base-200: #f6f5f1;
  --color-base-300: #eeece6;
  --color-base-content: #1a1f22;
  --color-primary: #0e6170;
  --color-primary-content: #ffffff;
  --color-secondary: #e3f2f3;
  --color-secondary-content: #083e48;
  --color-accent: #7a5aa6;
  --color-accent-content: #ffffff;
```

In the `fintrack-dark` daisyUI block, set:

```css
  --color-base-100: #141b1f;
  --color-base-200: #0d1316;
  --color-base-300: #1b2428;
  --color-base-content: #f2f4f3;
  --color-primary: #4fc3cf;
  --color-primary-content: #0d1316;
  --color-secondary: #0f2e33;
  --color-secondary-content: #a8e5ea;
  --color-accent: #b9a3e0;
  --color-accent-content: #0d1316;
```

Replace the first nine lines of the `:root, [data-theme="fintrack-light"]` block and add the new tokens after `--primary-soft`:

```css
  --canvas: #f6f5f1;
  --surface: #ffffff;
  --surface-subtle: #eeece6;
  --border: #e3e0d8;
  --control-boundary: #7f8a8f;
  --text: #1a1f22;
  --muted: #5f6b70;
  --primary: #0e6170;
  --primary-hover: #0b4f5b;
  --primary-pressed: #083e48;
  --primary-content: #ffffff;
  --primary-soft: #e3f2f3;
  --plum: #7a5aa6;
  --mono-1: #0e6170;
  --mono-2: #7a5aa6;
  --mono-3: #7d5f27;
  --mono-4: #4d6b57;
```

In both `:root:not([data-theme])` (inside the media query) and `[data-theme="fintrack-dark"]`, make the same replacement with the dark values:

```css
    --canvas: #0d1316;
    --surface: #141b1f;
    --surface-subtle: #1b2428;
    --border: #2a353b;
    --control-boundary: #6b7c84;
    --text: #f2f4f3;
    --muted: #9aa8ad;
    --primary: #4fc3cf;
    --primary-hover: #7dd6de;
    --primary-pressed: #a8e5ea;
    --primary-content: #0d1316;
    --primary-soft: #0f2e33;
    --plum: #b9a3e0;
    --mono-1: #4fc3cf;
    --mono-2: #b9a3e0;
    --mono-3: #e0b872;
    --mono-4: #9cc9a9;
```

Add to `@theme inline` after `--color-primary-soft`:

```css
  --color-plum: var(--plum);
  --color-mono-1: var(--mono-1);
  --color-mono-2: var(--mono-2);
  --color-mono-3: var(--mono-3);
  --color-mono-4: var(--mono-4);
```

Update the comment above the token block to say `Petrol & Paper tokens (PRD v0.20 P1)`.

- [ ] **Step 4: Update the hard-coded theme colors**

`src/app/layout.tsx`:

```ts
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1316" },
  ],
```

`src/app/manifest.ts`:

```ts
    background_color: "#f6f5f1",
    theme_color: "#0e6170",
```

Check `public/icons/icon.svg` and `src/app/icon.svg` for `#4f46e5`. If either uses it, change it to `#0e6170`, and regenerate the PNG icons with whatever produced them (see git history of `public/icons`). If you cannot regenerate them, leave the PNGs and say so in the task report.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run --project unit src/lib/theme-tokens.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/theme-tokens.test.ts src/app/globals.css src/app/layout.tsx src/app/manifest.ts src/app/icon.svg public/icons
git commit -m "feat(ui): Petrol & Paper palette with a contrast guard"
```

---

### Task 2: Pure Beranda view helpers

**Files:**
- Create: `src/lib/dashboard-view.ts`
- Create: `src/lib/dashboard-view.test.ts`

**Interfaces:**
- Consumes: `addDays(date: string, days: number): string` from `@/lib/business-time`; `parseIdrDecimal(value: string): bigint` from `@/lib/money`.
- Produces:
  - `type DayMarker = "RECEIVED" | "ADJUSTED" | "MISSED" | "INACTIVE" | "UPCOMING"`
  - `type StripDay = { date: string; weekday: string; marker: DayMarker }`
  - `weekStrip(input: { periodStart: string; normalEnd: string; today: string; days: { date: string; state: string; amount: bigint; overridden: boolean }[] }): StripDay[]`
  - `stripSummary(days: StripDay[]): string`
  - `markerLabel: Record<DayMarker, string>`
  - `progressPercent(part: string, whole: string): number` (integer 0–100)
  - `obligationProgress(obligations: { status: string }[]): { resolved: number; total: number }`
  - `chartEligibility(input: { settlements: number; cycles: number }): { weekly: Eligibility; monthly: Eligibility }` with `type Eligibility = { count: number; needed: number; eligible: boolean }`
  - `monogramFor(name: string, index: number): { letter: string; tone: 1 | 2 | 3 | 4 }`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";

import { chartEligibility, monogramFor, obligationProgress, progressPercent, stripSummary, weekStrip } from "./dashboard-view";

const day = (date: string, extra: Partial<{ state: string; amount: bigint; overridden: boolean }> = {}) => ({ date, state: "ACTIVE", amount: 5_000_000n, overridden: false, ...extra });

describe("weekStrip", () => {
  it("classifies each day of the open week and marks future days upcoming", () => {
    const strip = weekStrip({
      periodStart: "2026-09-28",
      normalEnd: "2026-10-04",
      today: "2026-10-02",
      days: [day("2026-09-28"), day("2026-09-29", { overridden: true, amount: 3_000_000n }), day("2026-09-30", { overridden: true, amount: 0n }), day("2026-10-01", { state: "PAUSED", amount: 0n }), day("2026-10-02")],
    });
    expect(strip.map((d) => d.marker)).toEqual(["RECEIVED", "ADJUSTED", "MISSED", "INACTIVE", "RECEIVED", "UPCOMING", "UPCOMING"]);
    expect(strip.map((d) => d.weekday)).toEqual(["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"]);
  });

  it("covers only the days of a short first period", () => {
    const strip = weekStrip({ periodStart: "2026-10-01", normalEnd: "2026-10-04", today: "2026-10-01", days: [day("2026-10-01")] });
    expect(strip).toHaveLength(4);
    expect(strip[0]).toEqual({ date: "2026-10-01", weekday: "Kam", marker: "RECEIVED" });
  });

  it("has no upcoming days for an overdue period", () => {
    const strip = weekStrip({ periodStart: "2026-09-14", normalEnd: "2026-09-20", today: "2026-10-01", days: ["14", "15", "16", "17", "18", "19", "20"].map((d) => day(`2026-09-${d}`)) });
    expect(strip.every((d) => d.marker === "RECEIVED")).toBe(true);
  });

  it("treats a past day without income data as inactive", () => {
    const strip = weekStrip({ periodStart: "2026-09-28", normalEnd: "2026-09-29", today: "2026-09-29", days: [day("2026-09-29")] });
    expect(strip.map((d) => d.marker)).toEqual(["INACTIVE", "RECEIVED"]);
  });
});

describe("stripSummary", () => {
  it("lists non-zero counts in a fixed order", () => {
    expect(stripSummary([
      { date: "a", weekday: "Sen", marker: "RECEIVED" },
      { date: "b", weekday: "Sel", marker: "RECEIVED" },
      { date: "c", weekday: "Rab", marker: "ADJUSTED" },
      { date: "d", weekday: "Kam", marker: "UPCOMING" },
    ])).toBe("2 hari diterima · 1 nominal disesuaikan · 1 hari belum terjadi");
  });
});

describe("progressPercent", () => {
  it("floors to whole percent", () => expect(progressPercent("600000", "1000000.01")).toBe(59));
  it("clamps above 100", () => expect(progressPercent("1500000", "1000000")).toBe(100));
  it("returns 0 for a zero or negative whole", () => {
    expect(progressPercent("10", "0")).toBe(0);
    expect(progressPercent("10", "-5")).toBe(0);
  });
  it("returns 0 for a negative part", () => expect(progressPercent("-1", "10")).toBe(0));
});

describe("obligationProgress", () => {
  it("counts CONFIRMED and NOT_CHARGED as resolved", () => {
    expect(obligationProgress([{ status: "CONFIRMED" }, { status: "NOT_CHARGED" }, { status: "PENDING" }])).toEqual({ resolved: 2, total: 3 });
  });
  it("handles a month without obligations", () => expect(obligationProgress([])).toEqual({ resolved: 0, total: 0 }));
});

describe("chartEligibility", () => {
  it("applies the PRD thresholds of four settlements and three cycles", () => {
    expect(chartEligibility({ settlements: 3, cycles: 3 })).toEqual({
      weekly: { count: 3, needed: 4, eligible: false },
      monthly: { count: 3, needed: 3, eligible: true },
    });
  });
});

describe("monogramFor", () => {
  it("uses the first letter, upper-cased, and cycles four tones by order", () => {
    expect(monogramFor("  jago", 0)).toEqual({ letter: "J", tone: 1 });
    expect(monogramFor("Tunai", 4)).toEqual({ letter: "T", tone: 1 });
    expect(monogramFor("BCA", 1)).toEqual({ letter: "B", tone: 2 });
  });
  it("keeps a whole emoji instead of half a surrogate pair", () => {
    expect(monogramFor("💰 Dompet", 2)).toEqual({ letter: "💰", tone: 3 });
  });
  it("falls back for an empty name", () => expect(monogramFor("   ", 3)).toEqual({ letter: "?", tone: 4 }));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run --project unit src/lib/dashboard-view.test.ts`
Expected: FAIL with `Failed to resolve import "./dashboard-view"`.

- [ ] **Step 3: Implement**

```ts
// Beranda view helpers (PRD v0.20 P2, P4). Pure: no IO, and money stays bigint or decimal string.
import { addDays } from "@/lib/business-time";
import { parseIdrDecimal } from "@/lib/money";

export type DayMarker = "RECEIVED" | "ADJUSTED" | "MISSED" | "INACTIVE" | "UPCOMING";
export type StripDay = { date: string; weekday: string; marker: DayMarker };
export type Eligibility = { count: number; needed: number; eligible: boolean };

const weekdays = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

export const markerLabel: Record<DayMarker, string> = {
  RECEIVED: "hari diterima",
  ADJUSTED: "nominal disesuaikan",
  MISSED: "hari tidak diterima",
  INACTIVE: "hari tidak aktif",
  UPCOMING: "hari belum terjadi",
};

const markerOrder: DayMarker[] = ["RECEIVED", "ADJUSTED", "MISSED", "INACTIVE", "UPCOMING"];

/** One marker per day of the settlement period `[periodStart, normalEnd]`. */
export function weekStrip(input: { periodStart: string; normalEnd: string; today: string; days: { date: string; state: string; amount: bigint; overridden: boolean }[] }): StripDay[] {
  const byDate = new Map(input.days.map((d) => [d.date, d]));
  const strip: StripDay[] = [];
  for (let date = input.periodStart; date <= input.normalEnd; date = addDays(date, 1)) {
    const weekday = weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()];
    const d = byDate.get(date);
    let marker: DayMarker;
    if (date > input.today) marker = "UPCOMING";
    else if (!d || d.state !== "ACTIVE") marker = "INACTIVE";
    else if (d.overridden && d.amount === 0n) marker = "MISSED";
    else if (d.overridden) marker = "ADJUSTED";
    else marker = "RECEIVED";
    strip.push({ date, weekday, marker });
  }
  return strip;
}

export function stripSummary(days: StripDay[]): string {
  return markerOrder
    .map((marker) => [marker, days.filter((d) => d.marker === marker).length] as const)
    .filter(([, count]) => count > 0)
    .map(([marker, count]) => `${count} ${markerLabel[marker]}`)
    .join(" · ");
}

/** Whole percent of `part` in `whole`, floored and clamped to 0–100. */
export function progressPercent(part: string, whole: string): number {
  const w = parseIdrDecimal(whole);
  const p = parseIdrDecimal(part);
  if (w <= 0n || p <= 0n) return 0;
  const percent = (p * 100n) / w;
  return Number(percent > 100n ? 100n : percent);
}

export function obligationProgress(obligations: { status: string }[]): { resolved: number; total: number } {
  return { resolved: obligations.filter((o) => o.status === "CONFIRMED" || o.status === "NOT_CHARGED").length, total: obligations.length };
}

/** PRD `Chart`: weekly trend after four completed settlements, monthly after three completed cycles. */
export function chartEligibility(input: { settlements: number; cycles: number }): { weekly: Eligibility; monthly: Eligibility } {
  return {
    weekly: { count: input.settlements, needed: 4, eligible: input.settlements >= 4 },
    monthly: { count: input.cycles, needed: 3, eligible: input.cycles >= 3 },
  };
}

export function monogramFor(name: string, index: number): { letter: string; tone: 1 | 2 | 3 | 4 } {
  const first = Array.from(name.trim())[0];
  return { letter: first ? first.toUpperCase() : "?", tone: ((index % 4) + 1) as 1 | 2 | 3 | 4 };
}
```

Before running, check that `parseIdrDecimal` accepts `"1000000.01"` and `"-5"` (see `src/lib/money.ts`). If it rejects a negative string, keep the `progressPercent` contract by testing the sign on the string first.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run --project unit src/lib/dashboard-view.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard-view.ts src/lib/dashboard-view.test.ts
git commit -m "feat(ui): pure Beranda view helpers for strip, progress, and eligibility"
```

---

### Task 3: Dashboard data for the new elements, without new queries

**Files:**
- Modify: `src/server/application/reports.ts` (`DashboardTask`, `danaCard`, `dashboard`)
- Test: `tests/reports/reports.integration.test.ts` (the `builds the dashboard…` case)
- Test: `tests/perf/query-budget.integration.test.ts` (unchanged budget 44, run only)

**Interfaces:**
- Consumes from Task 2: `weekStrip`, `chartEligibility`, `StripDay`, `Eligibility`.
- Produces on the `dashboard()` result:
  - `dana.week: { periodStart: string; normalEnd: string; days: StripDay[] } | null`
  - `chart: { weekly: Eligibility; monthly: Eligibility }`
  - `TRANSFER` tasks gain `amount: string` and `linked: string`

- [ ] **Step 1: Extend the failing integration assertion**

In `tests/reports/reports.integration.test.ts`, add to the end of `builds the dashboard in reading order with tasks and summaries`:

```ts
    expect(body.data.chart).toEqual({
      weekly: { count: expect.any(Number), needed: 4, eligible: expect.any(Boolean) },
      monthly: { count: expect.any(Number), needed: 3, eligible: expect.any(Boolean) },
    });
    expect(body.data.chart.weekly.count).toBeGreaterThanOrEqual(1);
    if (body.data.dana.week) {
      expect(body.data.dana.week.days.length).toBeGreaterThan(0);
      expect(body.data.dana.week.days.length).toBeLessThanOrEqual(7);
      expect(body.data.dana.week.days[0]).toEqual({ date: body.data.dana.week.periodStart, weekday: expect.any(String), marker: expect.any(String) });
    }
    for (const task of body.data.tasks.filter((t: { type: string }) => t.type === "TRANSFER")) {
      expect(task).toMatchObject({ amount: expect.any(String), linked: expect.any(String) });
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run --project db tests/reports/reports.integration.test.ts -t "builds the dashboard"`
Expected: FAIL (`body.data.chart` is `undefined`).

- [ ] **Step 3: Implement in `reports.ts`**

Import the helpers:

```ts
import { chartEligibility, weekStrip } from "@/lib/dashboard-view";
```

Change the `TRANSFER` member of `DashboardTask`:

```ts
  | { type: "TRANSFER"; targetId: string; route: string; amount: string; linked: string; remaining: string; transferNow: string; contextKey: string }
```

In `danaCard`, load the settlement count on the same query with a window function, keep the open-week days, and return both. Replace the `completed` query and the return:

```ts
  const [latestRow] = await tx
    .select({ row: settlement, total: sql<number>`count(*) over ()`.mapWith(Number) })
    .from(settlement)
    .where(and(eq(settlement.ownerId, ownerId), eq(settlement.accountId, rule.accountId), eq(settlement.status, "SETTLED")))
    .orderBy(sql`${settlement.endDate} desc`)
    .limit(1);
  const completed = latestRow?.row;
```

Keep the rest of the `latest` computation as it is. Then:

```ts
  const open = openFrom && openFrom <= today && router.mode !== "NO_WEEKLY_ACCOUNT";
  return {
    accountId: rule.accountId,
    openWeek: open ? { periodStart: openFrom, recognizedIncomeToDate: amount(incomeToDate?.recognized ?? 0n), livingExpense: null } : null,
    week: open ? { periodStart: openFrom, normalEnd: router.normalEnd, days: weekStrip({ periodStart: openFrom, normalEnd: router.normalEnd, today, days: incomeToDate?.days ?? [] }) } : null,
    latestCompleted: latest,
    completedCount: latestRow?.total ?? 0,
  };
```

If TypeScript does not narrow `router` inside the ternary, assign `const normalEnd = router.mode === "NO_WEEKLY_ACCOUNT" ? null : router.normalEnd;` before the return and use `open && normalEnd`.

In `dashboard()`, add `amount` and `linked` to the transfer task:

```ts
      tasks.push({
        type: "TRANSFER",
        targetId: target.id,
        route: `${target.route.sourceName} → ${target.route.destinationName}`,
        amount: target.version.amount,
        linked: target.linked,
        remaining: target.remaining,
        transferNow: suggestion?.transferNow ?? "0",
        contextKey: target.contextKey,
      });
```

Add `chart` to the returned object, after `external`:

```ts
    chart: chartEligibility({
      settlements: dana?.completedCount ?? 0,
      cycles: cycles.filter((c) => c.state === "COMPLETE" || c.state === "CLOSED_NO_INCOME").length,
    }),
```

- [ ] **Step 4: Run the integration test and the query budget**

Run: `pnpm vitest run --project db tests/reports/reports.integration.test.ts tests/perf/query-budget.integration.test.ts`
Expected: PASS, with the Beranda budget still 44 and no change to the budget file.

- [ ] **Step 5: Commit**

```bash
git add src/server/application/reports.ts tests/reports/reports.integration.test.ts
git commit -m "feat(reports): dashboard week strip, transfer progress, and chart eligibility"
```

---

### Task 4: UI primitives — icons, section icon, progress bar, monogram

**Files:**
- Modify: `src/components/ui.tsx`

**Interfaces:**
- Consumes: Tailwind colors `mono-1`…`mono-4` from Task 1.
- Produces:
  - `IconName` gains `calendar`, `trend`, `bars`, `checklist`
  - `SectionTitle({ children, action, icon }: { children: ReactNode; action?: ReactNode; icon?: IconName })`
  - `ProgressBar({ percent, label }: { percent: number; label: string })` with `role="progressbar"`
  - `SegmentBar({ done, total, label }: { done: number; total: number; label: string })`
  - `Monogram({ letter, tone }: { letter: string; tone: 1 | 2 | 3 | 4 })`
  - `EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: IconName })`

- [ ] **Step 1: Add the icon paths to `paths` in `ui.tsx`**

```ts
  calendar: "M6 2h2v2h4V2h2v2h1a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1V2ZM5 8v8h10V8H5Z",
  trend: "M2 14.6 7.5 9l3.5 3.5L15.6 8H13V6h6v6h-2V9.4l-6 6-3.5-3.5L3.4 16 2 14.6Z",
  bars: "M3 17h14v2H3v-2Zm1-6h3v5H4v-5Zm5-6h3v11H9V5Zm5 3h3v8h-3V8Z",
  checklist: "M2 4.5 3.4 3 5 4.6 8 1.6 9.4 3 5 7.4 2 4.5ZM11 4h7v2h-7V4Zm-9 7.5L3.4 10 5 11.6 8 8.6 9.4 10 5 14.4l-3-2.9ZM11 11h7v2h-7v-2Zm-8 5h4v2H3v-2Zm8 0h7v2h-7v-2Z",
```

- [ ] **Step 2: Replace `SectionTitle` and `EmptyState`, and add the new primitives**

```tsx
export function SectionTitle({ children, action, icon }: { children: ReactNode; action?: ReactNode; icon?: IconName }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        {icon ? <Icon name={icon} className="size-4.5 text-primary" /> : null}
        {children}
      </h2>
      {action}
    </div>
  );
}

/** A labelled bar; the caller always shows the numbers as text too (PRD v0.20 P2). */
export function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 rounded-full bg-surface-subtle">
      <div className="h-1.5 rounded-full bg-primary transition-[width] duration-200 ease-out" style={{ width: `${percent}%` }} />
    </div>
  );
}

/** One segment per item, for counts such as resolved obligations. */
export function SegmentBar({ done, total, label }: { done: number; total: number; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} className="flex gap-1">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-1.5 flex-1 rounded-full ${i < done ? "bg-primary" : "bg-surface-subtle"}`} />
      ))}
    </div>
  );
}

const monoClass: Record<1 | 2 | 3 | 4, string> = {
  1: "bg-mono-1/15 text-mono-1",
  2: "bg-mono-2/15 text-mono-2",
  3: "bg-mono-3/15 text-mono-3",
  4: "bg-mono-4/15 text-mono-4",
};

/** Account monogram; color comes from account order, never from the provider brand. */
export function Monogram({ letter, tone }: { letter: string; tone: 1 | 2 | 3 | 4 }) {
  return (
    <span aria-hidden="true" className={`flex size-10 shrink-0 items-center justify-center rounded-[10px] text-base font-semibold ${monoClass[tone]}`}>
      {letter}
    </span>
  );
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: IconName }) {
  return (
    <div className="rounded-xl border border-dashed border-control px-4 py-6 text-center">
      {icon ? <Icon name={icon} className="mx-auto mb-2 size-6 text-primary" /> : null}
      <p className="font-medium">{title}</p>
      {children ? <div className="mt-1 text-sm text-muted">{children}</div> : null}
    </div>
  );
}
```

`EmptyState` now uses `border-control` because the PRD says `Border` must not be the only boundary of a control-like surface. The empty state is not a control, but the dashed `border` token is too faint on the new warm canvas. If a reviewer disagrees, revert that one class.

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors. (`size-4.5` is valid in Tailwind 4.)

- [ ] **Step 4: Commit**

```bash
git add src/components/ui.tsx
git commit -m "feat(ui): section icons, progress and segment bars, account monogram"
```

---

### Task 5: Beranda layout with the new elements

**Files:**
- Modify: `src/app/(app)/page.tsx`
- Modify: `src/components/skeletons.tsx:63-83` (`BerandaSkeleton`)
- Create: `tests/e2e/beranda.spec.ts`

**Interfaces:**
- Consumes from Task 2: `stripSummary`, `markerLabel`, `progressPercent`, `obligationProgress`, `monogramFor`, `StripDay`.
- Consumes from Task 3: `data.dana.week`, `data.chart`, `TRANSFER.amount`, `TRANSFER.linked`.
- Consumes from Task 4: `SectionTitle icon`, `ProgressBar`, `SegmentBar`, `Monogram`.

- [ ] **Step 1: Write the failing e2e test**

```ts
// Beranda density (PRD v0.20 P2, P4): headline panel, monograms, DANA strip, chart eligibility.
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

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
  user = await createAuthUser(clients.authAdmin, "e2e-beranda");
  await resetWithConfirmedFixture(clients, user.id, `${daysAgo(3)}T20:00:00+07:00`);
});

test.afterAll(async () => {
  await clients.admin`truncate fintrack.app_owner cascade`;
  await clients.authAdmin.auth.admin.deleteUser(user.id);
  await closeClients(clients);
});

test("Beranda shows the week strip, monograms, and chart eligibility with text", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByText("Personal cash tercatat")).toBeVisible();

  const strip = page.getByRole("list", { name: "Income harian minggu berjalan" });
  await expect(strip).toBeVisible();
  await expect(strip.getByRole("listitem").first()).toHaveAccessibleName(/^(Sen|Sel|Rab|Kam|Jum|Sab|Min) /);
  await expect(page.getByText(/hari (diterima|belum terjadi|tidak aktif)/).first()).toBeVisible();

  await expect(page.getByRole("progressbar", { name: "Kelayakan tren mingguan" })).toBeVisible();
  await expect(page.getByText(/\d\/4 settlement/)).toBeVisible();

  const firstCard = page.locator("a[href^='/akun/']").first();
  await expect(firstCard).toContainText(/^[A-Z?]/);
});
```

Check `resetWithConfirmedFixture` in `tests/helpers/owner.ts` before relying on `daysAgo(3)`. The cutover must leave an open DANA week on today's date. If the fixture forces its own dates, follow the date pattern `tests/e2e/cash.spec.ts` uses instead.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test:e2e tests/e2e/beranda.spec.ts`
Expected: FAIL (no list named `Income harian minggu berjalan`).

- [ ] **Step 3: Update `src/app/(app)/page.tsx`**

Imports:

```tsx
import { Alert, Card, EmptyState, Icon, Monogram, Money, ProgressBar, Row, SectionTitle, SegmentBar, StatusBadge, Tag } from "@/components/ui";
import { markerLabel, monogramFor, obligationProgress, progressPercent, stripSummary, type StripDay } from "@/lib/dashboard-view";
```

Widen the local `dana` cast:

```tsx
  const dana = data.dana as {
    accountId: string;
    openWeek: { periodStart: string; recognizedIncomeToDate: string } | null;
    week: { periodStart: string; normalEnd: string; days: StripDay[] } | null;
    latestCompleted: { settlementId: string; startDate: string; endDate: string; livingExpense: string; averagePerDay: string; hasCorrections: boolean } | null;
  } | null;
```

Add a strip component above `BerandaPage` (server-safe, no hooks):

```tsx
const markerStyle: Record<StripDay["marker"], string> = {
  RECEIVED: "bg-primary text-primary-content",
  ADJUSTED: "border-2 border-plum text-plum",
  MISSED: "border-2 border-danger-fg text-danger-fg",
  INACTIVE: "bg-surface-subtle text-muted",
  UPCOMING: "border-2 border-dashed border-control",
};

const markerIcon: Partial<Record<StripDay["marker"], "check" | "swap" | "close" | "repeat">> = { RECEIVED: "check", ADJUSTED: "swap", MISSED: "close", INACTIVE: "repeat" };

function WeekStrip({ days }: { days: StripDay[] }) {
  return (
    <div className="space-y-2">
      <ul aria-label="Income harian minggu berjalan" className="flex justify-between gap-1">
        {days.map((day) => (
          <li key={day.date} aria-label={`${day.weekday} ${markerLabel[day.marker]}`} className="flex flex-1 flex-col items-center gap-1.5">
            <span className={`flex size-8 items-center justify-center rounded-full ${markerStyle[day.marker]}`}>
              {markerIcon[day.marker] ? <Icon name={markerIcon[day.marker]!} className="size-3.5" /> : null}
            </span>
            <span aria-hidden="true" className="text-xs text-muted">{day.weekday}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">{stripSummary(days)}</p>
    </div>
  );
}
```

Headline section: wrap the existing headline content in the soft-primary panel. Change the opening tag to:

```tsx
      <section aria-labelledby="headline" className="space-y-3 rounded-2xl bg-primary-soft p-5 md:p-6">
```

Keep every child as it is. Check the DANA disclosure `Alert` and warnings still meet contrast on `primary-soft`: they carry their own semantic background, so they do.

`Perlu dilakukan`: give the title an icon (`<SectionTitle icon="checklist">`). In the `TRANSFER` row, under the link content, render the progress (inside the `<li>`, after the `Link`, before the existing warning paragraph):

```tsx
                {task.type === "TRANSFER" ? (
                  <div className="space-y-1 px-4 pb-3">
                    <ProgressBar percent={progressPercent(task.linked, task.amount)} label={`Progres ${view.title}`} />
                    <p className="text-xs text-muted tabular">
                      <Money value={task.linked} /> dari <Money value={task.amount} /> · {progressPercent(task.linked, task.amount)}% terpenuhi
                    </p>
                  </div>
                ) : null}
```

Accounts: change `<SectionTitle>` to `<SectionTitle icon="wallet">`, switch `map((account) =>` to `map((account, index) =>`, and replace the card header `div` with:

```tsx
                <div className="flex items-center gap-3">
                  <Monogram {...monogramFor(account.displayName, index)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{account.displayName}</p>
                    <p className="text-xs text-muted">{account.purposeLabel}</p>
                  </div>
                  <StatusBadge status={account.status} />
                </div>
```

DANA card: `<SectionTitle icon="calendar">DANA mingguan</SectionTitle>`, and directly under it:

```tsx
            {dana.week ? <div className="mb-3"><WeekStrip days={dana.week.days} /></div> : null}
```

BCA card: `<SectionTitle icon="bars">BCA bulanan</SectionTitle>`. Inside `data.bca.currentCycle ? (`, before the `<dl>`, add:

```tsx
            (() => {
              const progress = obligationProgress(data.bca.currentCycle.obligations);
              return progress.total > 0 ? (
                <div className="mb-3 space-y-1.5">
                  <p className="flex justify-between text-xs text-muted">
                    <span>Kewajiban {formatCycle(data.bca.currentCycle.cycleKey)}</span>
                    <span className="tabular">{progress.resolved}/{progress.total} selesai</span>
                  </p>
                  <SegmentBar done={progress.resolved} total={progress.total} label="Kewajiban bulan ini yang selesai" />
                </div>
              ) : null;
            })()
```

Do not use an IIFE in JSX if lint rejects it. Instead, compute `const obligations = data.bca.currentCycle ? obligationProgress(data.bca.currentCycle.obligations) : null;` at the top of `BerandaPage` and render from that.

Reserve card: `<SectionTitle icon="arrowUp">`. External card: `<SectionTitle icon="user">`.

Chart eligibility card, the last child of the summary grid (`md:col-span-2`), shown only while the weekly trend is not yet eligible:

```tsx
        {!data.chart.weekly.eligible ? (
          <section aria-labelledby="trend-title" className="flex gap-3 rounded-xl border border-dashed border-control p-4 md:col-span-2 md:p-5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-primary-soft text-primary">
              <Icon name="trend" className="size-4.5" />
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <div>
                <h2 id="trend-title" className="font-medium">Tren mingguan</h2>
                <p className="text-sm text-muted">Muncul di Laporan setelah {data.chart.weekly.needed} settlement selesai.</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <ProgressBar percent={Math.floor((data.chart.weekly.count * 100) / data.chart.weekly.needed)} label="Kelayakan tren mingguan" />
                </div>
                <span className="text-xs text-muted tabular">{data.chart.weekly.count}/{data.chart.weekly.needed} settlement</span>
              </div>
            </div>
          </section>
        ) : null}
```

`count` and `needed` are plain counts, not money, so `number` is correct here.

Empty state at the bottom: `<EmptyState icon="wallet" title="Belum ada akun aktif" />`.

- [ ] **Step 4: Match the skeleton geometry**

In `BerandaSkeleton`, wrap the headline block in the same panel shape so the layout does not jump:

```tsx
      <div className="space-y-3 rounded-2xl bg-primary-soft p-5 md:p-6">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
```

- [ ] **Step 5: Run the e2e test, the full checks, and a manual look**

Run: `pnpm test:e2e tests/e2e/beranda.spec.ts`
Expected: PASS.

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm build && pnpm test:e2e && pnpm test:e2e:prod`
Expected: all green.

Then run `pnpm dev`, log in as the local owner, and compare Beranda at 390px and at 1280px, in light and dark, against the preview artifact. Check that the focus ring (`--primary`) is visible on the warm canvas and on `primary-soft`.

- [ ] **Step 6: Commit**

```bash
git add 'src/app/(app)/page.tsx' src/components/skeletons.tsx tests/e2e/beranda.spec.ts
git commit -m "feat(ui): denser Beranda with week strip, monograms, and progress"
```

---

### Task 6: Repaint check across the other pages, and PRD status

**Files:**
- Modify: any file found by the grep in Step 1
- Modify: `PRD.md` (P1, P2, P4 status lines; superseded table; decision log), `docs/implementation-plan.md` (S15 row status)

- [ ] **Step 1: Find leftovers of the old palette**

Run: `grep -rniE "indigo|#4f46e5|#818cf8|#eef2ff|#1e1b4b|#f7f8fa|#0b0f14" src public --include='*.ts' --include='*.tsx' --include='*.css' --include='*.svg'`
Expected: no matches outside `src/lib/theme-tokens.test.ts`. Replace any match with the matching token class (`bg-primary`, `text-primary`, `bg-canvas`, and so on).

- [ ] **Step 2: Visual pass on every app route**

With `pnpm dev`, open `/`, `/rutinitas`, `/rutinitas/settlement`, `/aktivitas`, `/akun`, an account detail page, `/catat/pengeluaran`, `/pengaturan`, `/onboarding` (with a fresh local owner), and `/login`, in light and dark at 390px. Check that disabled buttons, focus rings, inputs (`border-control`), and badges stay readable. List anything off in the task report instead of fixing it outside this slice.

- [ ] **Step 3: Update the docs**

In `PRD.md`, once the owner has approved: change P1, P2, and P4 to **LOCKED** with the approval date. Move the old palette row in `Keputusan yang telah diganti` to say `Custom Quiet Ledger themes dengan neutral surfaces dan indigo accent` → `Quiet Ledger dengan palette Petrol & Paper (v0.20)`. Update the three matching decision-log rows. In `docs/implementation-plan.md`, set the S15 exit-criteria cell to start with `Selesai;`.

- [ ] **Step 4: Commit**

```bash
git add -A PRD.md docs/implementation-plan.md src public
git commit -m "docs(prd): lock Petrol & Paper and Beranda density after S15"
```
