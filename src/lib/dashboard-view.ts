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
