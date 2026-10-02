// Laporan view helpers (PRD v0.20 P4, P5). Pure; money stays decimal strings and bigint.
import { formatCycle, formatDate, money } from "@/lib/format";
import { formatIdr, parseIdrDecimal, toIdrDecimal } from "@/lib/money";

/** current − previous, exact; a missing previous month counts as zero. */
export function signedDelta(current: string, previous: string | null): string {
  return toIdrDecimal(parseIdrDecimal(current) - (previous === null ? 0n : parseIdrDecimal(previous)));
}

/**
 * A month-over-month delta for display (PRD v0.20 P5). A whole-rupiah delta prints exactly
 * with its sign; a delta with sen comes from prorated living cost, so it is rounded to whole
 * rupiah (half away from zero) and marked `≈`.
 */
export function deltaLabel(delta: string): string {
  const minor = parseIdrDecimal(delta);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const exact = absolute % 100n === 0n;
  const rounded = exact ? absolute : ((absolute + 50n) / 100n) * 100n;
  const sign = rounded === 0n ? "" : negative ? "−" : "+";
  return `${exact ? "" : "≈ "}${sign}${formatIdr(rounded)}`;
}

/** Each category's share of the total, largest first; a zero total gives zero shares. */
export function categoryShares(categories: { name: string; amount: string }[]): { name: string; amount: string; percent: number }[] {
  const total = categories.reduce((sum, c) => sum + parseIdrDecimal(c.amount), 0n);
  return [...categories]
    .sort((a, b) => {
      const difference = parseIdrDecimal(b.amount) - parseIdrDecimal(a.amount);
      return difference > 0n ? 1 : difference < 0n ? -1 : 0;
    })
    .map((c) => ({ ...c, percent: total > 0n ? Number((parseIdrDecimal(c.amount) * 100n) / total) : 0 }));
}

const signed = (value: string) => (value.startsWith("-") ? `-${money(value.slice(1))}` : money(value));

/** Text summary of the weekly trend; it is also the chart's accessible name. */
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

/** Text summary of the monthly trend; it is also the chart's accessible name. */
export function monthlySummary(points: { month: string; reserveGrowth: string; outflow: string }[]): string {
  const last = points.at(-1);
  if (!last) return "Belum ada data bulanan.";
  return `${formatCycle(last.month)}: reserve ${signed(last.reserveGrowth)}, pengeluaran ${money(last.outflow)}.`;
}
