# S17 Laporan Page and Trend Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Laporan sub-view of Aktivitas with a calendar-month report, month-to-month deltas, and two trend charts that appear only after the history threshold and only on screens `md` and wider.

**Architecture:** The month report becomes a batch: `monthReports(months)` loads every input once (one ledger query grouped by month, settlements, daily income) and builds each month in TypeScript, and `monthReport` wraps it. A new `reportPage` loader reads six trailing months, the settlement series, and the cycle count for eligibility, all with a fixed number of queries. Pure helpers in `src/lib/report-view.ts` compute deltas, category shares, and the text summaries every chart carries. Charts are client components: `TrendChart` renders nothing below `md`, and above it loads `chart-canvas.tsx` (the only module that imports Chart.js) through `next/dynamic` with `ssr: false`.

**Tech Stack:** Next.js 16 App Router, Drizzle on node-postgres, Chart.js 4.5 (tree-shaken registration), Vitest (unit and db), Playwright.

**Spec:** `PRD.md` → `Visual refresh dan fitur pasca-MVP (v0.20)` → P4 and P5 (LOCKED), plus `Chart` and `Calendar-month reporting`.

## Global Constraints

- Route `/aktivitas/laporan`, reached through a `Riwayat | Laporan` segmented control in Aktivitas; the four primary destinations do not change.
- Month from `?bulan=YYYY-MM`; default and maximum is the current business month (`Asia/Jakarta`).
- Weekly trend eligible after 4 completed DANA settlements; monthly trend after 3 completed BCA cycles. Before that, an eligibility card shows `n/4` or `n/3`.
- Charts: line for average daily living cost per settlement; bars for reserve growth and outflow per month; at most two series; bars begin at zero; no pie, doughnut, gauge, or 3D; points are squares; the second series is told apart by outline as well as color.
- Every chart has a visible unit, exact-IDR tooltips, a text summary (also its `aria-label`), and an adjacent data list.
- Below `md` no chart renders and Chart.js is never imported; Chart.js registers only `LineController`, `LineElement`, `PointElement`, `BarController`, `BarElement`, `CategoryScale`, `LinearScale`, `Tooltip`.
- `prefers-reduced-motion: reduce` turns chart animation off.
- Money stays decimal strings or `bigint`; Chart.js receives numbers only as plot coordinates, and every amount shown to a person is formatted from the decimal string.
- Page loads only read (listing cycles may create a newly started month's occurrences, the existing exception). The Laporan loader joins the query budget test with a budget that does not grow with history.
- Radius 0 (P7); square-geometry guard stays green.

## Review Focus

1. A month with no previous-month data (the first month) must show deltas against zero, not crash. Pinned in Task 1 (`signedDelta` tests) and Task 3 (`reportPage` first-month test).
2. `?bulan=` with garbage or a future month must fall back to the current month. Pinned in Task 4 (`an invalid month falls back to the current month`).
3. The batch month report must equal the single-month report for each month. Pinned in Task 2 (`monthReports matches monthReport for every month`).
4. With fewer settlements than the threshold, no canvas may render even on desktop. Pinned in Task 5 (`desktop shows charts only when eligible`).
5. A special-expense category list with a zero total must not divide by zero. Pinned in Task 1 (`categoryShares` zero test).

---

### Task 1: Pure helpers for months, deltas, shares, and summaries

**Files:**
- Modify: `src/lib/business-time.ts`, `src/lib/business-time.test.ts` (`previousCycleKey`, `trailingCycleKeys`)
- Create: `src/lib/report-view.ts`, `src/lib/report-view.test.ts`

**Interfaces:**
- Produces: `previousCycleKey(cycle: string): string`; `trailingCycleKeys(cycle: string, count: number): string[]` (oldest first, ending at `cycle`); `signedDelta(current: string, previous: string | null): string`; `categoryShares(categories: { name: string; amount: string }[]): { name: string; amount: string; percent: number }[]` (sorted by amount, largest first); `weeklySummary(points: { endDate: string; averagePerDay: string }[]): string`; `monthlySummary(points: { month: string; reserveGrowth: string; outflow: string }[]): string`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/business-time.test.ts` (add the two names to its import):

```ts
describe("previousCycleKey and trailingCycleKeys", () => {
  it("steps back across a year boundary", () => {
    expect(previousCycleKey("2026-01")).toBe("2025-12");
    expect(previousCycleKey("2026-10")).toBe("2026-09");
  });
  it("lists trailing months oldest first, ending at the given month", () => {
    expect(trailingCycleKeys("2026-02", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
  it("rejects an invalid cycle key", () => {
    expect(() => previousCycleKey("2026-13")).toThrow();
  });
});
```

`src/lib/report-view.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { categoryShares, monthlySummary, signedDelta, weeklySummary } from "./report-view";

describe("signedDelta", () => {
  it("subtracts exactly in minor units", () => expect(signedDelta("1000000.50", "999999.75")).toBe("0.75"));
  it("goes negative", () => expect(signedDelta("100", "250")).toBe("-150"));
  it("treats a missing previous month as zero", () => expect(signedDelta("400000", null)).toBe("400000"));
});

describe("categoryShares", () => {
  it("orders by amount and floors each share", () => {
    expect(categoryShares([{ name: "Vape", amount: "100000" }, { name: "Buku", amount: "200000" }])).toEqual([
      { name: "Buku", amount: "200000", percent: 66 },
      { name: "Vape", amount: "100000", percent: 33 },
    ]);
  });
  it("gives zero shares when the total is zero", () => {
    expect(categoryShares([{ name: "Vape", amount: "0" }])).toEqual([{ name: "Vape", amount: "0", percent: 0 }]);
  });
});

describe("weeklySummary", () => {
  it("names the latest average and the change from the settlement before", () => {
    expect(weeklySummary([
      { endDate: "2026-09-20", averagePerDay: "61000" },
      { endDate: "2026-09-27", averagePerDay: "58000" },
    ])).toBe("Rata-rata biaya hidup terakhir Rp58.000 per hari (settlement sampai 27 Sep 2026), turun Rp3.000 dari settlement sebelumnya.");
  });
  it("handles a single point", () => {
    expect(weeklySummary([{ endDate: "2026-09-27", averagePerDay: "58000" }])).toBe("Rata-rata biaya hidup terakhir Rp58.000 per hari (settlement sampai 27 Sep 2026).");
  });
});

describe("monthlySummary", () => {
  it("names the latest month's reserve growth and outflow", () => {
    expect(monthlySummary([
      { month: "2026-08", reserveGrowth: "500000", outflow: "2000000" },
      { month: "2026-09", reserveGrowth: "-100000", outflow: "2300000" },
    ])).toBe("September 2026: reserve -Rp100.000, pengeluaran Rp2.300.000.");
  });
});
```

Before relying on the exact strings, check `formatDate("2026-09-27")` and `formatCycle("2026-09")` in `src/lib/format.ts`; if they render differently (for example `27 Sep 2026`), adjust the expected strings to what those functions return and record a ruling.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run --project unit src/lib/business-time.test.ts src/lib/report-view.test.ts`
Expected: FAIL (`previousCycleKey` not exported; `./report-view` not found).

- [ ] **Step 3: Implement**

`src/lib/business-time.ts`, after `nextCycleKey`:

```ts
export function previousCycleKey(cycle: string): string {
  if (!isCycleKey(cycle)) throw new Error(`Invalid cycle key: ${cycle}`);
  const [year, month] = cycle.split("-").map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

/** `count` months ending at `cycle`, oldest first. */
export function trailingCycleKeys(cycle: string, count: number): string[] {
  const months = [cycle];
  while (months.length < count) months.unshift(previousCycleKey(months[0]));
  return months;
}
```

`src/lib/report-view.ts`:

```ts
// Laporan view helpers (PRD v0.20 P4, P5). Pure; money stays decimal strings and bigint.
import { formatCycle, formatDate, money } from "@/lib/format";
import { parseIdrDecimal, toIdrDecimal } from "@/lib/money";

/** current − previous, exact; a missing previous month counts as zero. */
export function signedDelta(current: string, previous: string | null): string {
  return toIdrDecimal(parseIdrDecimal(current) - (previous === null ? 0n : parseIdrDecimal(previous)));
}

export function categoryShares(categories: { name: string; amount: string }[]): { name: string; amount: string; percent: number }[] {
  const total = categories.reduce((sum, c) => sum + parseIdrDecimal(c.amount), 0n);
  return [...categories]
    .sort((a, b) => (parseIdrDecimal(b.amount) > parseIdrDecimal(a.amount) ? 1 : parseIdrDecimal(b.amount) < parseIdrDecimal(a.amount) ? -1 : 0))
    .map((c) => ({ ...c, percent: total > 0n ? Number((parseIdrDecimal(c.amount) * 100n) / total) : 0 }));
}

const signed = (value: string) => (value.startsWith("-") ? `-${money(value.slice(1))}` : money(value));

export function weeklySummary(points: { endDate: string; averagePerDay: string }[]): string {
  const last = points.at(-1);
  if (!last) return "Belum ada settlement.";
  const head = `Rata-rata biaya hidup terakhir ${money(last.averagePerDay)} per hari (settlement sampai ${formatDate(last.endDate)})`;
  const before = points.at(-2);
  if (!before) return `${head}.`;
  const change = parseIdrDecimal(last.averagePerDay) - parseIdrDecimal(before.averagePerDay);
  if (change === 0n) return `${head}, sama dengan settlement sebelumnya.`;
  return `${head}, ${change > 0n ? "naik" : "turun"} ${money(toIdrDecimal(change > 0n ? change : -change))} dari settlement sebelumnya.`;
}

export function monthlySummary(points: { month: string; reserveGrowth: string; outflow: string }[]): string {
  const last = points.at(-1);
  if (!last) return "Belum ada data bulanan.";
  return `${formatCycle(last.month)}: reserve ${signed(last.reserveGrowth)}, pengeluaran ${money(last.outflow)}.`;
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run --project unit src/lib/business-time.test.ts src/lib/report-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/business-time.ts src/lib/business-time.test.ts src/lib/report-view.ts src/lib/report-view.test.ts
git commit -m "feat(reports): pure helpers for months, deltas, shares, and summaries"
```

---

### Task 2: Batch month reports with one ledger query

**Files:**
- Modify: `src/server/application/reports.ts` (`ledgerTotals` → `ledgerTotalsByMonth`; `monthReports`; `monthReport` wraps it; `monthLedgerSummary` uses the batch)
- Test: `tests/reports/reports.integration.test.ts`

**Interfaces:**
- Produces: `monthReports(tx: OwnerTx, ownerId: string, months: string[], view: ReportView, now: Date): Promise<Map<string, MonthReport>>`; `type MonthReport = Awaited<ReturnType<typeof monthReport>>` (unchanged shape).
- Internal: `loadMonthReports(...)` returns `{ reports, rule, settledRows, correctedLiving }` for Task 3.

- [ ] **Step 1: Write the failing integration test**

In `tests/reports/reports.integration.test.ts`, inside the describe that holds the full-month fixture, add (import `monthReport`, `monthReports`, and `withOwnerDb`/runtime as the file already does for direct calls; if the file only calls route handlers, call `monthReports` through `withOwnerDb(clients.runtime, { sub: user.id }, …)`):

```ts
  it("monthReports matches monthReport for every month", async () => {
    const months = ["2021-01", "2021-02", "2021-03"];
    const now = new Date();
    const [batch, singles] = await withOwnerDb(clients.runtime, { sub: user.id }, async (tx, principal) => {
      const all = await monthReports(tx, principal.ownerId, months, "corrected", now);
      const each = [];
      for (const month of months) each.push(await monthReport(tx, principal.ownerId, month, "corrected", now));
      return [all, each] as const;
    });
    expect([...batch.keys()]).toEqual(months);
    expect(months.map((m) => batch.get(m))).toEqual(singles);
  });
```

Use the fixture's real month (the file's full-month fixture is February 2021) and its neighbours; adjust if the fixture month differs.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run --project db tests/reports/reports.integration.test.ts -t "monthReports matches"`
Expected: FAIL (`monthReports` is not exported).

- [ ] **Step 3: Implement**

In `reports.ts`:

1. Extract the per-leg classification loop of `ledgerTotals` into `function addLeg(bucket: LedgerTotals, leg: LegRow, reserve: string)` and an `emptyTotals()` factory, keeping every branch as it is.
2. Replace `ledgerTotals(tx, ownerId, first, last, reserve, view)` with `ledgerTotalsByMonth(tx, ownerId, months, reserve, view)`: the same SQL over `[first day of the earliest month, last day of the latest month]`, plus `to_char(e.effective_business_date, 'YYYY-MM') as month` in the select; bucket each leg into its month with `addLeg`; return a `Map` holding every requested month (zero totals when a month has no legs).
3. `monthLedgerSummary` uses `(await ledgerTotalsByMonth(tx, ownerId, [month], reserve, "corrected")).get(month)!`.
4. Move the body of `monthReport` into `loadMonthReports(tx, ownerId, months, view, now)`: validate every month, load `reserve`, `rule`, `settledRows`, ledger totals by month, the daily-income context once for the whole range (bucket each day's amount into `cycleKeyOf(day.date)`; the as-settled snapshot override stays per date), and `correctedLiving` once; then build each month's object exactly as before (living from `prorataByMonth` per settlement, `monthCompleteness` per month). Return `{ reports, rule, settledRows, correctedLiving }`.
5. `export async function monthReports(...) { return (await loadMonthReports(...)).reports; }` and `monthReport(...)` validates, then returns `(await monthReports(tx, ownerId, [month], view, now)).get(month)!`.

- [ ] **Step 4: Run the report tests and the budget**

Run: `pnpm vitest run --project db tests/reports/reports.integration.test.ts tests/perf/query-budget.integration.test.ts`
Expected: PASS, including every existing month-report assertion (they pin the old behavior) and Beranda still within 44.

- [ ] **Step 5: Commit**

```bash
git add src/server/application/reports.ts tests/reports/reports.integration.test.ts
git commit -m "refactor(reports): batch month reports with one ledger query"
```

---

### Task 3: The Laporan loader with a fixed query count

**Files:**
- Modify: `src/server/application/reports.ts` (`settlementPoints`, `reportPage`; `settlementHistory` uses `settlementPoints`)
- Test: `tests/reports/reports.integration.test.ts`, `tests/perf/query-budget.integration.test.ts`

**Interfaces:**
- Consumes from Task 1: `trailingCycleKeys`, `signedDelta`, `weeklySummary`, `monthlySummary`. From Task 2: `loadMonthReports`.
- Produces: `reportPage(tx, ownerId, month, now)` returning:

```ts
{
  month: string;
  previousMonth: string;
  firstMonth: string; // earliest month with data (daily-income start), never after `month`
  report: MonthReport;
  previous: MonthReport;
  deltas: { income: string; outflow: string; reserve: string };
  weekly: { eligibility: Eligibility; points: { settlementId: string; startDate: string; endDate: string; averagePerDay: string; livingExpense: string }[]; summary: string };
  monthly: { eligibility: Eligibility; points: { month: string; reserveGrowth: string; outflow: string }[]; summary: string };
}
```

- [ ] **Step 1: Write the failing tests**

In `tests/reports/reports.integration.test.ts`, with the full-month fixture:

```ts
  it("builds the Laporan page for a month with its previous month and trends", async () => {
    const page = await withOwnerDb(clients.runtime, { sub: user.id }, (tx, principal) => reportPage(tx, principal.ownerId, "2021-02", new Date()));
    expect(page.month).toBe("2021-02");
    expect(page.previousMonth).toBe("2021-01");
    expect(page.monthly.points.map((p) => p.month)).toEqual(["2020-09", "2020-10", "2020-11", "2020-12", "2021-01", "2021-02"]);
    expect(page.deltas.income).toBe(signedDelta(page.report.income.total, page.previous.income.total));
    expect(page.weekly.points.length).toBeGreaterThan(0);
    expect(page.weekly.eligibility.needed).toBe(4);
    expect(page.monthly.eligibility.needed).toBe(3);
    expect(page.weekly.summary).toContain("per hari");
  });

  it("treats the first month's previous month as empty", async () => {
    const page = await withOwnerDb(clients.runtime, { sub: user.id }, (tx, principal) => reportPage(tx, principal.ownerId, page0Month, new Date()));
    expect(page.firstMonth <= page.month).toBe(true);
    expect(page.deltas.outflow).toBe(page.report.outflow.actualTotal);
  });
```

Set `page0Month` to the fixture's first month with daily income (read it from the fixture setup in the file). If that month's previous month has recorded outflow, assert against `signedDelta(report, previous)` instead and record a ruling.

In `tests/perf/query-budget.integration.test.ts`, import `reportPage` and add to `pages`:

```ts
    ["Laporan", 22, (tx, o) => reportPage(tx, o, cycleKeyOf(businessDateOf(now)), now)],
```

(import `businessDateOf` and `cycleKeyOf` from `@/lib/business-time`). After the first green run, set the budget to the measured count rounded up to the next even number and record it in the ledger.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run --project db tests/reports/reports.integration.test.ts -t "Laporan|first month"`
Expected: FAIL (`reportPage` is not exported).

- [ ] **Step 3: Implement**

In `reports.ts`:

```ts
/** One point per completed settlement, oldest first (shared by Rutinitas history and Laporan). */
function settlementPoints(rows: (typeof settlement.$inferSelect)[], living: Map<string, MinorUnits>) {
  return rows.map((row) => {
    const livingExpense = living.get(row.id) ?? 0n;
    return {
      settlementId: row.id,
      startDate: row.startDate,
      endDate: row.endDate,
      livingExpense: amount(livingExpense),
      averagePerDay: amount(roundedAverage(livingExpense, daysBetweenInclusive(row.startDate, row.endDate))),
    };
  });
}
```

`settlementHistory` keeps its two queries and returns `settlementPoints(rows, living)`.

```ts
/** Laporan (PRD v0.20 P5): one month, its previous month, and six months of trends. */
export async function reportPage(tx: OwnerTx, ownerId: string, month: string, now: Date) {
  const months = trailingCycleKeys(month, 6);
  const { reports, rule, settledRows, correctedLiving } = await loadMonthReports(tx, ownerId, months, "corrected", now);
  const cycles = await listMonthlyCycles(tx, ownerId, now);
  const report = reports.get(month)!;
  const previousMonth = months.at(-2)!;
  const previous = reports.get(previousMonth)!;
  const startMonth = rule ? cycleKeyOf(rule.effectiveStartDate) : month;
  const weeklyPoints = settlementPoints(settledRows, correctedLiving ?? new Map()).slice(-12);
  const monthlyPoints = months.map((m) => ({ month: m, reserveGrowth: reports.get(m)!.reserve.netGrowth, outflow: reports.get(m)!.outflow.actualTotal }));
  const eligibility = chartEligibility({
    settlements: settledRows.length,
    cycles: cycles.filter((c) => c.state === "COMPLETE" || c.state === "CLOSED_NO_INCOME").length,
  });
  return {
    month,
    previousMonth,
    firstMonth: startMonth < month ? startMonth : month,
    report,
    previous,
    deltas: {
      income: signedDelta(report.income.total, startMonth <= previousMonth ? previous.income.total : null),
      outflow: signedDelta(report.outflow.actualTotal, startMonth <= previousMonth ? previous.outflow.actualTotal : null),
      reserve: signedDelta(report.reserve.netGrowth, startMonth <= previousMonth ? previous.reserve.netGrowth : null),
    },
    weekly: { eligibility: eligibility.weekly, points: weeklyPoints, summary: weeklySummary(weeklyPoints) },
    monthly: { eligibility: eligibility.monthly, points: monthlyPoints, summary: monthlySummary(monthlyPoints) },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run --project db tests/reports/reports.integration.test.ts tests/perf/query-budget.integration.test.ts`
Expected: PASS; note `query budget Laporan: N/24` and tighten the budget as Step 1 says.

- [ ] **Step 5: Commit**

```bash
git add src/server/application/reports.ts tests/reports/reports.integration.test.ts tests/perf/query-budget.integration.test.ts
git commit -m "feat(reports): Laporan loader with month deltas and trend series"
```

---

### Task 4: Aktivitas tabs and the Laporan page

**Files:**
- Create: `src/app/(app)/aktivitas/tabs.tsx`
- Modify: `src/app/(app)/aktivitas/page.tsx`
- Create: `src/app/(app)/aktivitas/laporan/page.tsx`, `src/app/(app)/aktivitas/laporan/loading.tsx`
- Create: `tests/e2e/laporan.spec.ts`

**Interfaces:**
- Consumes from Task 1: `categoryShares`. From Task 3: `reportPage`.
- Produces: `AktivitasTabs({ active }: { active: "riwayat" | "laporan" })`.

- [ ] **Step 1: Write the failing e2e tests**

`tests/e2e/laporan.spec.ts` (header, fixture, and `signIn` as in `tests/e2e/motion.spec.ts`, user label `e2e-laporan`, cutover three days ago):

```ts
test("Aktivitas switches to Laporan and shows the month", async ({ page }) => {
  await signIn(page);
  await page.goto("/aktivitas");
  await page.getByRole("link", { name: "Laporan" }).click();
  await expect(page).toHaveURL(/\/aktivitas\/laporan$/);
  await expect(page.getByRole("link", { name: "Laporan" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: currentMonthLabel() })).toBeVisible();
  await expect(page.getByText("Pemasukan").first()).toBeVisible();
  await expect(page.getByText("0/4 settlement")).toBeVisible();
});

test("the previous-month link opens that month", async ({ page }) => {
  await signIn(page);
  await page.goto("/aktivitas/laporan");
  await page.getByRole("link", { name: /Bulan sebelumnya/ }).click();
  await expect(page.getByRole("heading", { name: previousMonthLabel() })).toBeVisible();
});

test("an invalid month falls back to the current month", async ({ page }) => {
  await signIn(page);
  await page.goto("/aktivitas/laporan?bulan=2099-01");
  await expect(page.getByRole("heading", { name: currentMonthLabel() })).toBeVisible();
  await page.goto("/aktivitas/laporan?bulan=garbage");
  await expect(page.getByRole("heading", { name: currentMonthLabel() })).toBeVisible();
});
```

with helpers in the file:

```ts
const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
function jakartaMonth(offset: number): string {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date()).split("-").map(Number);
  const index = y * 12 + (m - 1) + offset;
  return `${monthNames[index % 12]} ${Math.floor(index / 12)}`;
}
const currentMonthLabel = () => jakartaMonth(0);
const previousMonthLabel = () => jakartaMonth(-1);
```

Check `formatCycle` renders `Oktober 2026`-style labels; if not, build the labels the same way it does.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test:e2e tests/e2e/laporan.spec.ts`
Expected: FAIL (no `Laporan` link).

- [ ] **Step 3: Tabs**

`src/app/(app)/aktivitas/tabs.tsx`:

```tsx
import Link from "next/link";

/** Riwayat | Laporan (PRD v0.20 P5): two views of Aktivitas, not new destinations. */
export function AktivitasTabs({ active }: { active: "riwayat" | "laporan" }) {
  const tab = (key: "riwayat" | "laporan", href: string, label: string) => (
    <Link
      href={href}
      aria-current={active === key ? "page" : undefined}
      className="flex min-h-11 flex-1 items-center justify-center border border-control px-4 text-sm font-medium aria-[current=page]:border-primary aria-[current=page]:bg-primary aria-[current=page]:text-primary-content md:flex-none"
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Tampilan aktivitas" className="mb-6 flex">
      {tab("riwayat", "/aktivitas", "Riwayat")}
      {tab("laporan", "/aktivitas/laporan", "Laporan")}
    </nav>
  );
}
```

In `aktivitas/page.tsx`, render `<AktivitasTabs active="riwayat" />` directly under `PageHeader`.

- [ ] **Step 4: Laporan page and skeleton**

`src/app/(app)/aktivitas/laporan/page.tsx` renders, in order:

1. `PageHeader` title `Aktivitas` with the description `Laporan bulan kalender: pemasukan, pengeluaran, dan reserve.`, then `<AktivitasTabs active="laporan" />`.
2. A month bar: `<nav aria-label="Pilih bulan">` with `‹ Bulan sebelumnya (<previous month>)` linking to `?bulan=<previousMonth>` when `month > firstMonth`, the `<h2>` month label (`formatCycle(month)`) with a `Tag` of `completenessLabel[report.completeness]` (tone `success` for `LENGKAP`, else `info`), and `Bulan berikutnya (<next>) ›` when `month < current`.
3. Three stat blocks in a `grid gap-3 md:grid-cols-3`: Pemasukan (`report.income.total`), Pengeluaran (`report.outflow.actualTotal`), Pertumbuhan reserve (`report.reserve.netGrowth`, signed); each shows `<Money signed value={deltas.x} /> dari {formatCycle(previousMonth)}` under the amount.
4. `Card` Pemasukan rows: income harian, income bulanan, lainnya, hadiah.
5. `Card` Pengeluaran rows: biaya hidup (with `approx`), kewajiban bulanan, pengeluaran khusus, lainnya, dana titipan dipakai; then, if `report.outflow.specialByCategory` is not empty, a `Pengeluaran khusus per kategori` list from `categoryShares`, each row a name, `Money`, and a `ProgressBar` with `label={`Bagian ${name}`}` plus the percent as text.
6. `Tren` section with two cards (`md:grid-cols-2`). Each card: the summary text, then either the chart (Task 5) plus the data list, or, when not eligible, the eligibility card text `Muncul setelah {needed} settlement selesai.` / `… {needed} siklus BCA selesai.` with a `ProgressBar` and `n/needed settlement` / `n/needed siklus`.

Month resolution at the top of the page:

```tsx
  const { bulan } = await searchParams;
  const current = cycleKeyOf(businessDateOf(new Date()));
  const month = bulan && isCycleKey(bulan) && bulan <= current ? bulan : current;
```

`loading.tsx`: `export default function Loading() { return <CardsSkeleton title="Aktivitas" cards={4} />; }` (import from `@/components/skeletons`).

- [ ] **Step 5: Run the tests**

Run: `pnpm test:e2e tests/e2e/laporan.spec.ts && pnpm lint && pnpm typecheck && pnpm vitest run --project unit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add 'src/app/(app)/aktivitas' tests/e2e/laporan.spec.ts
git commit -m "feat(ui): Laporan sub-view with month report and deltas"
```

---

### Task 5: Trend charts, lazy and desktop-only

**Files:**
- Create: `src/app/(app)/aktivitas/laporan/trend-chart.tsx`, `src/app/(app)/aktivitas/laporan/chart-canvas.tsx`
- Modify: `src/app/(app)/aktivitas/laporan/page.tsx` (use `TrendChart` in eligible cards)
- Modify: `package.json`, `pnpm-lock.yaml` (`chart.js`)
- Test: `tests/e2e/laporan.spec.ts`

**Interfaces:**
- Produces: `type TrendChartProps = { kind: "line" | "bar"; labels: string[]; series: { label: string; values: string[]; style: "solid" | "outline" }[]; summary: string; unit: string }`; `TrendChart(props)`.

- [ ] **Step 1: Write the failing e2e test**

Add to `tests/e2e/laporan.spec.ts` a second `describe` with its own fixture: cutover on a Sunday at least five weeks ago, four settlements seeded through the API with the test user's Bearer token:

```ts
test.describe("with four settled weeks", () => {
  let seeded: Awaited<ReturnType<typeof createAuthUser>>;
  test.beforeAll(async ({ request }) => {
    seeded = await createAuthUser(clients.authAdmin, "e2e-laporan-trend");
    const cutover = sundayWeeksAgo(5);
    await resetWithConfirmedFixture(clients, seeded.id, `${cutover}T20:00:00+07:00`);
    const headers = (ifMatch?: number) => ({ authorization: `Bearer ${seeded.accessToken}`, "idempotency-key": crypto.randomUUID(), ...(ifMatch === undefined ? {} : { "if-match": `"${ifMatch}"` }) });
    for (let week = 1; week <= 4; week++) {
      const endDate = addDaysIso(cutover, week * 7);
      const created = (await (await request.post("/api/v1/settlements", { headers: headers(), data: { endDate } })).json()).data;
      const patched = (await (await request.patch(`/api/v1/settlements/${created.id}`, { headers: headers(created.version), data: { closingPhysicalBalance: "100000", closingAt: `${endDate}T21:00:00+07:00` } })).json()).data;
      await request.post(`/api/v1/settlements/${created.id}/settle`, { headers: headers(patched.version), data: {} });
    }
  });

  test("desktop shows charts only when eligible, mobile shows the data list", async ({ page }) => {
    await signInAs(page, seeded);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/aktivitas/laporan");
    await expect(page.locator("canvas[role='img']")).toHaveCount(1); // weekly eligible, monthly not
    await expect(page.locator("canvas[role='img']")).toHaveAttribute("aria-label", /per hari/);
    await page.setViewportSize({ width: 412, height: 915 });
    await page.reload();
    await expect(page.locator("canvas")).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Data tren mingguan" })).toBeVisible();
  });
});
```

Generalize `signIn(page)` into `signInAs(page, user)`. Add `sundayWeeksAgo(weeks)` (the Sunday at least `weeks` weeks before today in Jakarta) and `addDaysIso(date, days)` helpers. The first describe keeps its fixture by resetting in its own `beforeAll`; because both fixtures truncate `app_owner`, the second describe must run after the first (Playwright runs a file top to bottom with one worker).

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test:e2e tests/e2e/laporan.spec.ts -g "desktop shows charts"`
Expected: FAIL (no canvas).

- [ ] **Step 3: Install Chart.js**

Run: `pnpm add chart.js`

- [ ] **Step 4: The client components**

`trend-chart.tsx`:

```tsx
"use client";

// Trend chart wrapper (PRD v0.20 P4). Below md nothing renders and Chart.js is
// never imported; above it, chart-canvas loads on demand without SSR.
import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";

import { Skeleton } from "@/components/skeletons";

export type TrendChartProps = { kind: "line" | "bar"; labels: string[]; series: { label: string; values: string[]; style: "solid" | "outline" }[]; summary: string; unit: string };

const ChartCanvas = dynamic(() => import("./chart-canvas"), { ssr: false, loading: () => <Skeleton className="h-64" /> });

const wide = "(min-width: 48rem)";
function subscribe(onChange: () => void) {
  const query = matchMedia(wide);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function TrendChart(props: TrendChartProps) {
  const isWide = useSyncExternalStore(subscribe, () => matchMedia(wide).matches, () => false);
  if (!isWide) return null;
  return (
    <div className="space-y-2">
      <ChartCanvas {...props} />
      {props.series.length > 1 ? (
        <ul aria-hidden="true" className="flex gap-4 text-xs text-muted">
          {props.series.map((s, i) => (
            <li key={s.label} className="flex items-center gap-1.5">
              <span className={`size-3 ${s.style === "solid" ? (i === 0 ? "bg-primary" : "bg-plum") : `border-2 ${i === 0 ? "border-primary" : "border-plum"}`}`} />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
```

`chart-canvas.tsx`:

```tsx
"use client";

// The only module that imports Chart.js, and only the parts these charts use.
import { BarController, BarElement, CategoryScale, Chart, LinearScale, LineController, LineElement, PointElement, Tooltip, type ChartConfiguration } from "chart.js";
import { useEffect, useRef } from "react";

import { money } from "@/lib/format";

import type { TrendChartProps } from "./trend-chart";

Chart.register(LineController, LineElement, PointElement, BarController, BarElement, CategoryScale, LinearScale, Tooltip);

const compact = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", notation: "compact", maximumFractionDigits: 1 });
const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function config({ kind, labels, series, unit }: TrendChartProps): ChartConfiguration {
  const colors = [token("--primary"), token("--plum")];
  const muted = token("--muted");
  const line = token("--line");
  return {
    type: kind,
    data: {
      labels,
      datasets: series.map((s, i) => ({
        label: s.label,
        // Numbers are plot coordinates only; every amount a person reads comes from the decimal strings.
        data: s.values.map(Number),
        borderColor: colors[i],
        backgroundColor: s.style === "solid" ? colors[i] : "transparent",
        borderWidth: 2,
        ...(kind === "line" ? { pointStyle: "rect", pointRadius: 4, pointBackgroundColor: colors[i], tension: 0 } : {}),
      })),
    },
    options: {
      animation: matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 200 },
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false }, ticks: { color: muted }, border: { color: line } },
        y: { beginAtZero: true, grid: { color: line }, border: { color: line }, ticks: { color: muted, callback: (value) => compact.format(Number(value)) }, title: { display: true, text: unit, color: muted } },
      },
      plugins: { tooltip: { callbacks: { label: (item) => `${item.dataset.label}: ${money(series[item.datasetIndex].values[item.dataIndex])}` } } },
    },
  } as ChartConfiguration;
}

export default function ChartCanvas(props: TrendChartProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const chart = new Chart(canvas.current!, config(props));
    // A theme switch recolors the chart.
    const recolor = () => {
      const next = config(props);
      chart.data = next.data;
      chart.options = next.options ?? {};
      chart.update();
    };
    const observer = new MutationObserver(recolor);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", recolor);
    return () => {
      observer.disconnect();
      scheme.removeEventListener("change", recolor);
      chart.destroy();
    };
  }, [props]);
  return (
    <div className="relative h-64">
      <canvas ref={canvas} role="img" aria-label={props.summary} />
    </div>
  );
}
```

- [ ] **Step 5: Use it on the page**

In the eligible weekly card: `<TrendChart kind="line" labels={points.map((p) => formatDate(p.endDate))} series={[{ label: "Rata-rata biaya hidup per hari", values: points.map((p) => p.averagePerDay), style: "solid" }]} summary={weekly.summary} unit="Rupiah per hari" />`, followed by `<ul aria-label="Data tren mingguan">` with one row per point (`formatDate(start)–formatDate(end)` and `Money`). In the eligible monthly card: `kind="bar"`, labels `formatCycle(month)`, series `Pertumbuhan reserve` (solid) and `Pengeluaran` (outline), unit `Rupiah`, followed by `<ul aria-label="Data tren bulanan">`. Show the data list in both cases and on every screen size.

- [ ] **Step 6: Run the tests and checks**

Run: `pnpm test:e2e tests/e2e/laporan.spec.ts && pnpm lint && pnpm typecheck && pnpm vitest run --project unit && pnpm build`
Expected: PASS; the build succeeds with Chart.js only in the Laporan client chunk.

- [ ] **Step 7: Commit**

```bash
git add 'src/app/(app)/aktivitas/laporan' tests/e2e/laporan.spec.ts package.json pnpm-lock.yaml
git commit -m "feat(ui): lazy desktop-only trend charts on Laporan"
```

---

### Task 6: Full suite, visual pass, and docs

- [ ] **Step 1:** `pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm build && pnpm test:e2e && pnpm test:e2e:prod` → all green.
- [ ] **Step 2:** Screenshots of Laporan at 390px (light, dark) and 1280px with the seeded trend fixture; check the charts' squares, colors, axis unit, and tooltip format.
- [ ] **Step 3:** `docs/implementation-plan.md` S17 row starts `Selesai;`; `PRD.md` footer `Slices 0–17 implemented`; note in P5 that the month comes from `?bulan=` and that the trailing six months feed the monthly bars.
- [ ] **Step 4:** Commit `docs: mark S17 complete`.
