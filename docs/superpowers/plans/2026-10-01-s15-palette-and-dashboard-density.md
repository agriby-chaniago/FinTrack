# S15 Petrol & Paper, Square Geometry, Provider Icons, and Beranda Density Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the indigo/cool-grey palette with `Petrol & Paper`, make every UI shape square, show the provider app icon for BCA, DANA, and Jago, and make Beranda denser and more informative without charts or decoration.

**Architecture:** Tokens change only in `src/app/globals.css` (plus the two places that hard-code theme colors). Two unit guards read the source: one checks contrast, the other forbids rounded utilities. Beranda's new elements are fed by pure helpers in `src/lib/dashboard-view.ts` and `src/lib/account-icon.ts`. `dashboard()` returns their already-classified, JSON-safe output, adds no queries, and keeps the Beranda query budget at 44. Provider icons are static PNGs rendered through `next/image`.

**Tech Stack:** Next.js 16 App Router (server components), Tailwind 4 + daisyUI 5, Drizzle on node-postgres, Vitest (unit and db projects), Playwright.

**Spec:** `PRD.md` → `Visual refresh dan fitur pasca-MVP (v0.20)`, items P1, P2, P4 (eligibility card only), P7, and P8, all **LOCKED** on 1 October 2026. Visual reference for colors and layout (its rounded corners are superseded by P7): https://claude.ai/artifact/Q4bY3aNEMPsuNpKtmq7Pyg

## Global Constraints

- Light tokens: canvas `#F6F5F1`, surface `#FFFFFF`, subtle `#EEECE6`, border `#E3E0D8`, control `#7A8589`, text `#1A1F22`, muted `#5F6B70`, primary `#0E6170`, hover `#0B4F5B`, pressed `#083E48`, primary content `#FFFFFF`, soft `#E3F2F3`, plum `#7A5AA6`.
- Dark tokens: canvas `#0D1316`, surface `#141B1F`, subtle `#1B2428`, border `#2A353B`, control `#6B7C84`, text `#F2F4F3`, muted `#9AA8AD`, primary `#4FC3CF`, hover `#7DD6DE`, pressed `#A8E5EA`, primary content `#0D1316`, soft `#0F2E33`, plum `#B9A3E0`.
- Monogram accents (light/dark): petrol `#0E6170`/`#4FC3CF`, plum `#7A5AA6`/`#B9A3E0`, ochre `#7D5F27`/`#E0B872`, sage `#4D6B57`/`#9CC9A9`. Assigned by account order, never by provider.
- Semantic pairs (`--confirmed-*`, `--calculated-*`, `--review-*`, `--danger-*`, `--success-*`, `--outflow-*`) do not change.
- Contrast floors: normal text 4.5:1; control boundary and large UI 3:1 (PRD `Accessibility`).
- Radius 0 everywhere. No `rounded*` utility, no inline radius. The daisyUI radio is the only round shape (P7 exception).
- Provider match: normalized `provider_name` (lower case, letters and digits only): `bca`, `bankbca`, `bankcentralasia`, `mybca` → BCA; `dana` → DANA; `jago`, `bankjago`, `jagosyariah` → Jago. `accountType === "CASH"` → cash glyph. Anything else → monogram.
- Provider icons live in the repository and are never hotlinked. Brand color appears only inside the icon.
- Never animate or count up amounts. Money stays as decimal strings or `bigint`, never `number`.
- Every progress bar shows its numbers as text as well; meaning never relies on color alone.
- Page loads only read; no new queries on Beranda (`tests/perf/query-budget.integration.test.ts` budget stays 44).

## Review Focus

1. A first settlement period shorter than seven days (rule started mid-week) must render a strip with only that period's days, not seven. Pinned in Task 3 (`weekStrip` short-period test).
2. An overdue settlement spans several weeks. The strip must show the first unsettled period only, with no `UPCOMING` days. Pinned in Task 3 (`weekStrip` all-past test).
3. A transfer target whose linked amount exceeds the suggestion must show a full bar, not one over 100%. Pinned in Task 3 (`progressPercent` clamp test).
4. `BCA Syariah` is a different bank. It must not get the BCA icon just because its name contains `bca`. Pinned in Task 6 (`accountTile` exact-match test).
5. An account display name with leading spaces or an emoji must still get a readable monogram. Pinned in Task 6 (`monogramFor` tests).

---

### Task 1: `Petrol & Paper` tokens with a contrast guard

**Files:**
- Create: `src/lib/theme-tokens.test.ts`
- Modify: `src/app/globals.css` (both daisyUI theme blocks, the three token blocks, `@theme inline`)
- Modify: `src/app/layout.tsx` (`themeColor`)
- Modify: `src/app/manifest.ts` (`background_color`, `theme_color`)

**Interfaces:**
- Produces Tailwind colors `mono-1`…`mono-4` and `plum` (classes such as `bg-mono-1/15`, `text-mono-1`, `border-plum`) for Tasks 5–7.

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
    expect(light).toMatchObject({ canvas: "#f6f5f1", surface: "#ffffff", "surface-subtle": "#eeece6", border: "#e3e0d8", "control-boundary": "#7a8589", text: "#1a1f22", muted: "#5f6b70", primary: "#0e6170", "primary-hover": "#0b4f5b", "primary-pressed": "#083e48", "primary-content": "#ffffff", "primary-soft": "#e3f2f3", plum: "#7a5aa6", "mono-1": "#0e6170", "mono-2": "#7a5aa6", "mono-3": "#7d5f27", "mono-4": "#4d6b57" });
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

Replace the first twelve lines of the `:root, [data-theme="fintrack-light"]` block (canvas through primary-soft) with these, which add the new tokens:

```css
  --canvas: #f6f5f1;
  --surface: #ffffff;
  --surface-subtle: #eeece6;
  --border: #e3e0d8;
  --control-boundary: #7a8589;
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

Update the comments that say `Quiet Ledger tokens` / `Quiet Ledger themes` to name `Petrol & Paper (PRD v0.20 P1)`.

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

Check `src/app/icon.svg` and `public/icons/icon.svg` for `#4f46e5`. If either uses it, change it to `#0e6170`, and regenerate the PNG icons from the SVG (see the git history of `public/icons` for how they were made). If they cannot be regenerated, leave the PNGs and record a ruling.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run --project unit src/lib/theme-tokens.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/theme-tokens.test.ts src/app/globals.css src/app/layout.tsx src/app/manifest.ts
git commit -m "feat(ui): Petrol & Paper palette with a contrast guard"
```

---

### Task 2: Square geometry with a source guard

**Files:**
- Create: `src/lib/square-geometry.test.ts`
- Modify: `src/app/globals.css` (daisyUI radii in both theme blocks)
- Modify: every `.tsx` file under `src` that has a `rounded*` class (18 files at plan time)

**Interfaces:**
- Produces the rule every later task follows: no `rounded*` utilities and no inline radius in `src/**/*.tsx` or `src/**/*.css`.

- [ ] **Step 1: Write the failing test**

```ts
// Guards the square geometry (PRD v0.20 P7): UI code carries no rounded
// utilities or inline radii, and daisyUI radii are zero in both themes.
// The daisyUI radio keeps its built-in round shape, the one allowed exception.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const src = fileURLToPath(new URL("..", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(tsx|css)$/.test(entry.name) ? [path] : [];
  });
}

describe("square geometry", () => {
  it("uses no rounded utilities or inline radii in UI code", () => {
    const offenders = sources(src).flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(/(?<![\w-])rounded(?:-[\w.[\]/%-]+)?(?![\w-])|borderRadius|border-radius/g)].map((m) => `${path.slice(src.length)}: ${m[0]}`),
    );
    expect(offenders).toEqual([]);
  });

  it("sets every daisyUI radius to zero in both themes", () => {
    const css = readFileSync(join(src, "app/globals.css"), "utf8");
    const radii = [...css.matchAll(/--radius-(selector|field|box):\s*([^;]+);/g)].map((m) => `${m[1]}=${m[2].trim()}`);
    expect(radii).toEqual(["selector=0", "field=0", "box=0", "selector=0", "field=0", "box=0"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run --project unit src/lib/square-geometry.test.ts`
Expected: FAIL on both tests (75 rounded tokens; radii `0.5rem`/`0.75rem`).

- [ ] **Step 3: Set the daisyUI radii to zero**

In both daisyUI theme blocks of `src/app/globals.css`:

```css
  --radius-selector: 0;
  --radius-field: 0;
  --radius-box: 0;
```

- [ ] **Step 4: Strip the rounded utilities**

```bash
find src -name '*.tsx' -print0 | xargs -0 perl -pi -e 's/\s+rounded(?:-[\w.\[\]\/%-]+)?(?![\w-])//g; s/(?<=["`\x27])rounded(?:-[\w.\[\]\/%-]+)?(?![\w-])\s*//g'
```

The first substitution removes a token together with the space before it. The second removes a token that opens a string, together with the space after it. Then review the diff:

```bash
git diff --stat
grep -rnE 'className=""|className=\{""\}|" "' src --include='*.tsx'
```

Expected: only class-list changes; no empty `className` attributes. Remove any empty attribute by hand.

- [ ] **Step 5: Run the guard, lint, and typecheck**

Run: `pnpm vitest run --project unit src/lib/square-geometry.test.ts && pnpm lint && pnpm typecheck`
Expected: PASS (2 tests), no lint or type errors.

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "feat(ui): square geometry everywhere with a source guard"
```

---

### Task 3: Pure Beranda view helpers

**Files:**
- Create: `src/lib/dashboard-view.ts`
- Create: `src/lib/dashboard-view.test.ts`

**Interfaces:**
- Consumes: `addDays(date: string, days: number): string` from `@/lib/business-time`; `parseIdrDecimal(value: string): bigint` from `@/lib/money`.
- Produces:
  - `type DayMarker = "RECEIVED" | "ADJUSTED" | "MISSED" | "INACTIVE" | "UPCOMING"`
  - `type StripDay = { date: string; weekday: string; marker: DayMarker }`
  - `type Eligibility = { count: number; needed: number; eligible: boolean }`
  - `weekStrip(input: { periodStart: string; normalEnd: string; today: string; days: { date: string; state: string; amount: bigint; overridden: boolean }[] }): StripDay[]`
  - `stripSummary(days: StripDay[]): string`
  - `markerLabel: Record<DayMarker, string>`
  - `progressPercent(part: string, whole: string): number` (integer 0–100)
  - `obligationProgress(obligations: { status: string }[]): { resolved: number; total: number }`
  - `chartEligibility(input: { settlements: number; cycles: number }): { weekly: Eligibility; monthly: Eligibility }`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";

import { chartEligibility, obligationProgress, progressPercent, stripSummary, weekStrip } from "./dashboard-view";

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
    expect(
      stripSummary([
        { date: "a", weekday: "Sen", marker: "RECEIVED" },
        { date: "b", weekday: "Sel", marker: "RECEIVED" },
        { date: "c", weekday: "Rab", marker: "ADJUSTED" },
        { date: "d", weekday: "Kam", marker: "UPCOMING" },
      ]),
    ).toBe("2 hari diterima · 1 nominal disesuaikan · 1 hari belum terjadi");
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
```

Before running, check that `parseIdrDecimal` accepts `"1000000.01"` and `"-5"` (see `src/lib/money.ts`). If it rejects a negative string, keep the `progressPercent` contract by checking the sign on the string first.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run --project unit src/lib/dashboard-view.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard-view.ts src/lib/dashboard-view.test.ts
git commit -m "feat(ui): pure Beranda view helpers for strip, progress, and eligibility"
```

---

### Task 4: Dashboard data for the new elements, without new queries

**Files:**
- Modify: `src/server/application/reports.ts` (`DashboardTask`, `danaCard`, `dashboard`)
- Test: `tests/reports/reports.integration.test.ts` (the `builds the dashboard…` case)
- Test: `tests/perf/query-budget.integration.test.ts` (unchanged budget 44, run only)

**Interfaces:**
- Consumes from Task 3: `weekStrip`, `chartEligibility`.
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

In `danaCard`, load the settlement count on the same query with a window function, keep the open-week days, and return both. Replace the `completed` query:

```ts
  const [latestRow] = await tx
    .select({ row: settlement, total: sql<number>`count(*) over ()`.mapWith(Number) })
    .from(settlement)
    .where(and(eq(settlement.ownerId, ownerId), eq(settlement.accountId, rule.accountId), eq(settlement.status, "SETTLED")))
    .orderBy(sql`${settlement.endDate} desc`)
    .limit(1);
  const completed = latestRow?.row;
```

Keep the rest of the `latest` computation as it is. Replace the return:

```ts
  const normalEnd = router.mode === "NO_WEEKLY_ACCOUNT" ? null : router.normalEnd;
  const open = openFrom !== null && openFrom <= today;
  return {
    accountId: rule.accountId,
    openWeek: open ? { periodStart: openFrom, recognizedIncomeToDate: amount(incomeToDate?.recognized ?? 0n), livingExpense: null } : null,
    week: open && normalEnd ? { periodStart: openFrom, normalEnd, days: weekStrip({ periodStart: openFrom, normalEnd, today, days: incomeToDate?.days ?? [] }) } : null,
    latestCompleted: latest,
    completedCount: latestRow?.total ?? 0,
  };
```

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

### Task 5: Square UI primitives

**Files:**
- Modify: `src/components/ui.tsx`

**Interfaces:**
- Consumes: Tailwind colors `mono-1`…`mono-4` and `plum` from Task 1; the square rule from Task 2.
- Produces:
  - `IconName` gains `calendar`, `trend`, `bars`, `checklist`, `minus`, `cash`
  - `SectionTitle({ children, action, icon }: { children: ReactNode; action?: ReactNode; icon?: IconName })`
  - `PageHeader({ title, description, action, leading }: { title: string; description?: string; action?: ReactNode; leading?: ReactNode })`
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
  minus: "M4 9h12v2H4V9Z",
  cash: "M1 5h18v10H1V5Zm2 2v6h14V7H3Zm5 1h4v4H8V8Z",
```

- [ ] **Step 2: Replace `SectionTitle`, `PageHeader`, and `EmptyState`, and add the new primitives**

```tsx
export function PageHeader({ title, description, action, leading }: { title: string; description?: string; action?: ReactNode; leading?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-center gap-3">
        {leading}
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
        </div>
      </div>
      {action}
    </header>
  );
}

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
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 bg-surface-subtle">
      <div className="h-1.5 bg-primary transition-[width] duration-200 ease-out" style={{ width: `${percent}%` }} />
    </div>
  );
}

/** One segment per item, for counts such as resolved obligations. */
export function SegmentBar({ done, total, label }: { done: number; total: number; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} className="flex gap-1">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-1.5 flex-1 ${i < done ? "bg-primary" : "bg-surface-subtle"}`} />
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
    <span aria-hidden="true" className={`flex size-10 shrink-0 items-center justify-center text-base font-semibold ${monoClass[tone]}`}>
      {letter}
    </span>
  );
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: IconName }) {
  return (
    <div className="border border-dashed border-control px-4 py-6 text-center">
      {icon ? <Icon name={icon} className="mx-auto mb-2 size-6 text-primary" /> : null}
      <p className="font-medium">{title}</p>
      {children ? <div className="mt-1 text-sm text-muted">{children}</div> : null}
    </div>
  );
}
```

`EmptyState` uses `border-control`: the dashed `border` token is too faint on the warm canvas, and with square corners the dashed edge carries the whole shape.

- [ ] **Step 3: Run the guards, lint, and typecheck**

Run: `pnpm vitest run --project unit src/lib/square-geometry.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS; no type or lint errors (`size-4.5` is valid in Tailwind 4).

- [ ] **Step 4: Commit**

```bash
git add src/components/ui.tsx
git commit -m "feat(ui): section icons, progress and segment bars, square monogram"
```

---

### Task 6: Provider app icons

**Files:**
- Create: `src/assets/providers/bca.png` (myBCA app icon, 192×192), `src/assets/providers/dana.png`, `src/assets/providers/jago.png`
- Create: `src/lib/account-icon.ts`, `src/lib/account-icon.test.ts`
- Create: `src/components/account-tile.tsx`
- Modify: `src/server/application/ledger.ts` (`AccountBalanceView` gains `accountType`)
- Test: `tests/reports/reports.integration.test.ts`

**Interfaces:**
- Consumes from Task 5: `Icon` (`cash`), `Monogram`.
- Produces:
  - `type ProviderIcon = "bca" | "dana" | "jago"`
  - `accountTile(account: { providerName: string; accountType: string }): ProviderIcon | "cash" | null`
  - `monogramFor(name: string, index: number): { letter: string; tone: 1 | 2 | 3 | 4 }`
  - `AccountBalanceView.accountType: string` (`"BANK" | "E_WALLET" | "CASH"` by the table check)
  - `AccountTile({ account, index }: { account: { displayName: string; providerName: string; accountType: string }; index: number })`

- [ ] **Step 1: Write the failing unit tests**

`src/lib/account-icon.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { accountTile, monogramFor } from "./account-icon";

const bank = (providerName: string) => ({ providerName, accountType: "BANK" });

describe("accountTile", () => {
  it("recognizes the three providers by normalized provider name", () => {
    expect(accountTile(bank("BCA"))).toBe("bca");
    expect(accountTile(bank(" Bank BCA "))).toBe("bca");
    expect(accountTile(bank("Bank Central Asia"))).toBe("bca");
    expect(accountTile({ providerName: "DANA", accountType: "E_WALLET" })).toBe("dana");
    expect(accountTile(bank("Jago"))).toBe("jago");
    expect(accountTile(bank("Jago Syariah"))).toBe("jago");
  });

  it("does not match a different bank that only contains a known name", () => {
    expect(accountTile(bank("BCA Syariah"))).toBeNull();
    expect(accountTile(bank("GoPay"))).toBeNull();
  });

  it("uses the cash glyph for a CASH account whatever its provider name", () => {
    expect(accountTile({ providerName: "Tunai", accountType: "CASH" })).toBe("cash");
    expect(accountTile({ providerName: "DANA", accountType: "CASH" })).toBe("cash");
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

In `tests/reports/reports.integration.test.ts`, add to the same dashboard case:

```ts
    expect(body.data.accounts.map((a: { accountType: string }) => a.accountType)).toEqual(["BANK", "BANK", "E_WALLET"]);
```

- [ ] **Step 2: Run both to verify they fail**

Run: `pnpm vitest run --project unit src/lib/account-icon.test.ts`
Expected: FAIL with `Failed to resolve import "./account-icon"`.

Run: `pnpm vitest run --project db tests/reports/reports.integration.test.ts -t "builds the dashboard"`
Expected: FAIL (`accountType` is `undefined`).

- [ ] **Step 3: Implement the mapping**

`src/lib/account-icon.ts`:

```ts
// Account tile kinds (PRD v0.20 P8). Providers match on the normalized provider
// name, never on the display name or an id; anything unknown gets a monogram.
export type ProviderIcon = "bca" | "dana" | "jago";

const providers: Record<string, ProviderIcon> = {
  bca: "bca",
  bankbca: "bca",
  bankcentralasia: "bca",
  mybca: "bca",
  dana: "dana",
  jago: "jago",
  bankjago: "jago",
  jagosyariah: "jago",
};

export function accountTile(account: { providerName: string; accountType: string }): ProviderIcon | "cash" | null {
  if (account.accountType === "CASH") return "cash";
  return providers[account.providerName.toLowerCase().replace(/[^a-z0-9]/g, "")] ?? null;
}

export function monogramFor(name: string, index: number): { letter: string; tone: 1 | 2 | 3 | 4 } {
  const first = Array.from(name.trim())[0];
  return { letter: first ? first.toUpperCase() : "?", tone: ((index % 4) + 1) as 1 | 2 | 3 | 4 };
}
```

- [ ] **Step 4: Add `accountType` to `AccountBalanceView`**

In `src/server/application/ledger.ts`: add `accountType: string;` after `providerName` in `AccountBalanceView`, add `account_type: string;` to the `sqlRows` row type, select `a.account_type` next to `a.provider_name` in the query's final select, and map `accountType: row.account_type` next to `providerName`. This adds a column, not a query.

- [ ] **Step 5: Add the icon files**

Copy the 192×192 PNGs downloaded from the Google Play listings (`com.bca.mybca.omni.android`, `id.dana`, `com.jago.digitalBanking`, URL suffix `=s192`, no rounding suffix) to `src/assets/providers/bca.png`, `dana.png`, and `jago.png`. Check each file with `file` (PNG, 192 x 192) and view it once.

- [ ] **Step 6: Implement `AccountTile`**

`src/components/account-tile.tsx`:

```tsx
// Account tile (PRD v0.20 P8): the provider's app icon, the cash glyph, or a
// monogram. Decorative: the account name is always written next to it.
import Image from "next/image";

import bca from "@/assets/providers/bca.png";
import dana from "@/assets/providers/dana.png";
import jago from "@/assets/providers/jago.png";
import { Icon, Monogram } from "@/components/ui";
import { accountTile, monogramFor } from "@/lib/account-icon";

const icons = { bca, dana, jago };

export function AccountTile({ account, index }: { account: { displayName: string; providerName: string; accountType: string }; index: number }) {
  const kind = accountTile(account);
  if (kind === "cash") {
    return (
      <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center bg-primary-soft text-primary">
        <Icon name="cash" className="size-5" />
      </span>
    );
  }
  if (kind) return <Image src={icons[kind]} alt="" width={40} height={40} className="size-10 shrink-0" />;
  return <Monogram {...monogramFor(account.displayName, index)} />;
}
```

- [ ] **Step 7: Run both tests to verify they pass**

Run: `pnpm vitest run --project unit src/lib/account-icon.test.ts && pnpm vitest run --project db tests/reports/reports.integration.test.ts tests/perf/query-budget.integration.test.ts && pnpm typecheck`
Expected: PASS; budget unchanged; no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/assets/providers src/lib/account-icon.ts src/lib/account-icon.test.ts src/components/account-tile.tsx src/server/application/ledger.ts tests/reports/reports.integration.test.ts
git commit -m "feat(ui): provider app icons for BCA, DANA, and Jago account tiles"
```

---

### Task 7: Beranda, Akun list, and Akun detail with the new elements

**Files:**
- Modify: `src/app/(app)/page.tsx`
- Modify: `src/app/(app)/akun/page.tsx`
- Modify: `src/app/(app)/akun/[id]/page.tsx`
- Modify: `src/components/skeletons.tsx` (`BerandaSkeleton`)
- Create: `tests/e2e/beranda.spec.ts`

**Interfaces:**
- Consumes from Task 3: `stripSummary`, `markerLabel`, `progressPercent`, `obligationProgress`, `StripDay`.
- Consumes from Task 4: `data.dana.week`, `data.chart`, `TRANSFER.amount`, `TRANSFER.linked`.
- Consumes from Task 5: `SectionTitle icon`, `PageHeader leading`, `ProgressBar`, `SegmentBar`, `EmptyState icon`, icons `checklist`, `calendar`, `bars`, `trend`, `minus`.
- Consumes from Task 6: `AccountTile`, `AccountBalanceView.accountType`.

- [ ] **Step 1: Write the failing e2e test**

```ts
// Beranda density (PRD v0.20 P2, P4, P7, P8): provider icons, week strip,
// chart eligibility with text, and square shapes.
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

test("Beranda shows provider icons, the week strip, and chart eligibility, all square", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByText("Personal cash tercatat")).toBeVisible();

  for (const provider of ["jago", "bca", "dana"]) await expect(page.locator(`main img[src*="${provider}"]`).first()).toBeVisible();

  const strip = page.getByRole("list", { name: "Income harian minggu berjalan" });
  await expect(strip).toBeVisible();
  await expect(strip.getByRole("listitem").first()).toHaveAccessibleName(/^(Sen|Sel|Rab|Kam|Jum|Sab|Min) /);

  await expect(page.getByRole("progressbar", { name: "Kelayakan tren mingguan" })).toBeVisible();
  await expect(page.getByText(/\d\/4 settlement/)).toBeVisible();

  const card = page.locator("main a[href^='/akun/']").first();
  expect(await card.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("0px");
});
```

Check `resetWithConfirmedFixture` in `tests/helpers/owner.ts` before relying on `daysAgo(3)`: the cutover must leave an open DANA week that includes today. If the fixture forces its own dates, follow the date pattern `tests/e2e/cash.spec.ts` uses instead, and record a ruling.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test:e2e tests/e2e/beranda.spec.ts`
Expected: FAIL (no provider image in `main`).

- [ ] **Step 3: Update Beranda (`src/app/(app)/page.tsx`)**

Imports:

```tsx
import { AccountTile } from "@/components/account-tile";
import { Alert, Card, EmptyState, Icon, Money, ProgressBar, Row, SectionTitle, SegmentBar, StatusBadge, Tag, type IconName } from "@/components/ui";
import { markerLabel, obligationProgress, progressPercent, stripSummary, type StripDay } from "@/lib/dashboard-view";
```

Widen the local `dana` cast:

```tsx
  const dana = data.dana as {
    accountId: string;
    openWeek: { periodStart: string; recognizedIncomeToDate: string } | null;
    week: { periodStart: string; normalEnd: string; days: StripDay[] } | null;
    latestCompleted: { settlementId: string; startDate: string; endDate: string; livingExpense: string; averagePerDay: string; hasCorrections: boolean } | null;
  } | null;
  const obligations = data.bca.currentCycle ? obligationProgress(data.bca.currentCycle.obligations) : null;
```

Add the strip above `BerandaPage` (server-safe, no hooks). Every marker is a square; the marker kind is told by fill, outline style, and icon, and named in the accessible label:

```tsx
const markerStyle: Record<StripDay["marker"], string> = {
  RECEIVED: "bg-primary text-primary-content",
  ADJUSTED: "border-2 border-plum text-plum",
  MISSED: "border-2 border-danger-fg text-danger-fg",
  INACTIVE: "bg-surface-subtle text-muted",
  UPCOMING: "border-2 border-dashed border-control",
};

const markerIcon: Partial<Record<StripDay["marker"], IconName>> = { RECEIVED: "check", ADJUSTED: "swap", MISSED: "close", INACTIVE: "minus" };

function WeekStrip({ days }: { days: StripDay[] }) {
  return (
    <div className="space-y-2">
      <ul aria-label="Income harian minggu berjalan" className="flex justify-between gap-1">
        {days.map((day) => {
          const icon = markerIcon[day.marker];
          return (
            <li key={day.date} aria-label={`${day.weekday} ${markerLabel[day.marker]}`} className="flex flex-1 flex-col items-center gap-1.5">
              <span className={`flex size-8 items-center justify-center ${markerStyle[day.marker]}`}>{icon ? <Icon name={icon} className="size-3.5" /> : null}</span>
              <span aria-hidden="true" className="text-xs text-muted">
                {day.weekday}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted">{stripSummary(days)}</p>
    </div>
  );
}
```

Headline: change the section's opening tag to a soft-primary panel and keep every child:

```tsx
      <section aria-labelledby="headline" className="space-y-3 bg-primary-soft p-5 md:p-6">
```

`Perlu dilakukan`: `<SectionTitle icon="checklist">`. In each `<li>`, after the `Link` and before the existing transfer warning paragraph:

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

Accounts: `<SectionTitle icon="wallet">`, `map((account, index) =>`, and the card header becomes:

```tsx
                <div className="flex items-center gap-3">
                  <AccountTile account={account} index={index} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{account.displayName}</p>
                    <p className="text-xs text-muted">{account.purposeLabel}</p>
                  </div>
                  <StatusBadge status={account.status} />
                </div>
```

DANA card: `<SectionTitle icon="calendar">DANA mingguan</SectionTitle>`, then directly under it:

```tsx
            {dana.week ? (
              <div className="mb-3">
                <WeekStrip days={dana.week.days} />
              </div>
            ) : null}
```

BCA card: `<SectionTitle icon="bars">BCA bulanan</SectionTitle>`. Inside `data.bca.currentCycle ? (`, wrap the existing `<dl>` in a fragment and put this before it:

```tsx
              {obligations && obligations.total > 0 ? (
                <div className="mb-3 space-y-1.5">
                  <p className="flex justify-between text-xs text-muted">
                    <span>Kewajiban {formatCycle(data.bca.currentCycle.cycleKey)}</span>
                    <span className="tabular">
                      {obligations.resolved}/{obligations.total} selesai
                    </span>
                  </p>
                  <SegmentBar done={obligations.resolved} total={obligations.total} label="Kewajiban bulan ini yang selesai" />
                </div>
              ) : null}
```

Reserve card: `<SectionTitle icon="arrowUp">`. External card: `<SectionTitle icon="user">`.

Chart eligibility card, the last child of the summary grid, shown only while the weekly trend is not yet eligible:

```tsx
        {!data.chart.weekly.eligible ? (
          <section aria-labelledby="trend-title" className="flex gap-3 border border-dashed border-control p-4 md:col-span-2 md:p-5">
            <span className="flex size-9 shrink-0 items-center justify-center bg-primary-soft text-primary">
              <Icon name="trend" className="size-4.5" />
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <div>
                <h2 id="trend-title" className="font-medium">
                  Tren mingguan
                </h2>
                <p className="text-sm text-muted">Muncul di Laporan setelah {data.chart.weekly.needed} settlement selesai.</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <ProgressBar percent={Math.floor((data.chart.weekly.count * 100) / data.chart.weekly.needed)} label="Kelayakan tren mingguan" />
                </div>
                <span className="text-xs text-muted tabular">
                  {data.chart.weekly.count}/{data.chart.weekly.needed} settlement
                </span>
              </div>
            </div>
          </section>
        ) : null}
```

`count` and `needed` are plain counts, not money, so `number` is correct here.

Empty state at the bottom: `<EmptyState icon="wallet" title="Belum ada akun aktif" />`.

- [ ] **Step 4: Update the Akun list and detail pages**

`src/app/(app)/akun/page.tsx`: import `AccountTile`, change `overview.accounts.map((account) =>` to `map((account, index) =>`, and replace the card's left header block:

```tsx
                  <div className="flex items-center gap-3">
                    <AccountTile account={account} index={index} />
                    <div>
                      <p className="font-medium">{account.displayName}</p>
                      <p className="text-xs text-muted">
                        {account.providerName} · {account.purposeLabel}
                      </p>
                    </div>
                  </div>
```

`src/app/(app)/akun/[id]/page.tsx`: import `AccountTile`, and pass the tile to the header with the account's position in `overview.accounts` so a monogram keeps the same tone as on Beranda:

```tsx
      <PageHeader
        leading={<AccountTile account={account} index={overview.accounts.indexOf(account)} />}
        title={account.displayName}
        description={`${account.providerName} · ${account.purposeLabel}`}
        action={<LinkButton href="/akun">Kembali</LinkButton>}
      />
```

- [ ] **Step 5: Match the skeleton geometry**

In `BerandaSkeleton`, wrap the headline block in the same panel:

```tsx
      <div className="space-y-3 bg-primary-soft p-5 md:p-6">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
```

- [ ] **Step 6: Run the e2e test, the full checks, and a visual pass**

Run: `pnpm test:e2e tests/e2e/beranda.spec.ts`
Expected: PASS.

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm build && pnpm test:e2e && pnpm test:e2e:prod`
Expected: all green.

Then capture Beranda at 390px and 1280px in light and dark with Playwright screenshots, and compare them with the preview's colors and layout. Check that the focus ring (`--primary`) is visible on the warm canvas and on `primary-soft`.

- [ ] **Step 7: Commit**

```bash
git add 'src/app/(app)/page.tsx' 'src/app/(app)/akun/page.tsx' 'src/app/(app)/akun/[id]/page.tsx' src/components/skeletons.tsx tests/e2e/beranda.spec.ts
git commit -m "feat(ui): denser Beranda and account tiles with provider icons"
```

---

### Task 8: Repaint check across the other pages, and docs

**Files:**
- Modify: any file found by the grep in Step 1
- Modify: `docs/implementation-plan.md` (S15 row), `PRD.md` (footer line)

- [ ] **Step 1: Find leftovers of the old palette**

Run: `grep -rniE "indigo|#4f46e5|#818cf8|#eef2ff|#1e1b4b|#f7f8fa|#0b0f14" src public --include='*.ts' --include='*.tsx' --include='*.css' --include='*.svg'`
Expected: no matches outside `src/lib/theme-tokens.test.ts`. Replace any match with the matching token class (`bg-primary`, `text-primary`, `bg-canvas`, and so on).

- [ ] **Step 2: Visual pass on every app route**

With the dev server, capture `/`, `/rutinitas`, `/rutinitas/settlement`, `/aktivitas`, `/akun`, an account detail page, `/catat/pengeluaran`, `/pengaturan`, and `/login` in light and dark at 390px. Check that disabled buttons, focus rings, inputs (`border-control`), checkboxes, and tags stay readable and square, and that the radio inputs are the only round shapes. List anything off in the ledger instead of fixing it outside this slice.

- [ ] **Step 3: Update the docs**

In `docs/implementation-plan.md`, start the S15 exit-criteria cell with `Selesai;`. In `PRD.md`, change the footer to `_FinTrack PRD v0.20 · Production active · Slices 0–15 implemented_`.

- [ ] **Step 4: Commit**

```bash
git add docs/implementation-plan.md PRD.md src public
git commit -m "docs: mark S15 complete"
```
