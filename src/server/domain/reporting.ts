// Calendar-month reporting (PRD: Calendar-month reporting). Pure functions.
import { addDays, cycleKeyOf } from "@/lib/business-time";
import type { MinorUnits } from "@/lib/money";

import { daysBetweenInclusive } from "./daily-income";
import { lastDayOfCycle } from "./monthly";

/**
 * CALENDAR_DAY_PRORATA_V1: splits a settlement's living expense across the
 * calendar months it touches by calendar days. Floors each share's magnitude
 * in minor units, hands out the remaining units by largest remainder (earlier
 * month wins ties), then restores the sign. The shares always sum exactly.
 */
export function prorataByMonth(living: MinorUnits, startDate: string, endDate: string): Map<string, MinorUnits> {
  const totalDays = BigInt(daysBetweenInclusive(startDate, endDate));
  const daysByMonth = new Map<string, bigint>();
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    const month = cycleKeyOf(date);
    daysByMonth.set(month, (daysByMonth.get(month) ?? 0n) + 1n);
  }

  const negative = living < 0n;
  const magnitude = negative ? -living : living;
  const shares = [...daysByMonth].map(([month, days]) => {
    const numerator = magnitude * days;
    return { month, floor: numerator / totalDays, remainder: numerator % totalDays };
  });
  let leftover = magnitude - shares.reduce((sum, share) => sum + share.floor, 0n);
  const order = [...shares].sort((a, b) => (a.remainder === b.remainder ? (a.month < b.month ? -1 : 1) : a.remainder > b.remainder ? -1 : 1));
  for (const share of order) {
    if (leftover === 0n) break;
    share.floor += 1n;
    leftover -= 1n;
  }
  return new Map(shares.map((share) => [share.month, negative ? -share.floor : share.floor]));
}

export type MonthCompleteness = "LENGKAP" | "SEMENTARA" | "PERIODE_PARSIAL";

/**
 * `Sementara` while any day of the month's coverage is not inside a settled
 * range; `Periode parsial` for the month in which coverage starts mid-month;
 * `Lengkap` once every covered day is settled. Missing coverage is never Rp0.
 */
export function monthCompleteness(
  month: string,
  coverageStart: string,
  settledRanges: readonly { startDate: string; endDate: string }[],
  today: string,
): { completeness: MonthCompleteness; coveredDays: number; expectedDays: number; gaps: string[]; overlaps: string[] } {
  const first = `${month}-01`;
  const last = `${month}-${String(lastDayOfCycle(month)).padStart(2, "0")}`;
  const from = coverageStart > first ? coverageStart : first;
  const to = today < last ? today : last;
  const coverage = new Map<string, number>();
  for (const range of settledRanges) {
    for (let date = range.startDate; date <= range.endDate; date = addDays(date, 1)) coverage.set(date, (coverage.get(date) ?? 0) + 1);
  }
  const gaps: string[] = [];
  const overlaps: string[] = [];
  let covered = 0;
  let expected = 0;
  for (let date = from; date <= to; date = addDays(date, 1)) {
    expected += 1;
    const count = coverage.get(date) ?? 0;
    if (count > 0) covered += 1;
    if (count > 1) overlaps.push(date);
  }
  // A gap is an uncovered day earlier than a covered one: the ranges are not contiguous.
  const lastCovered = [...coverage.keys()].filter((d) => d >= from && d <= to).sort().at(-1);
  for (let date = from; lastCovered && date < lastCovered; date = addDays(date, 1)) if (!coverage.has(date)) gaps.push(date);

  const complete = covered === expected && to === last;
  const partial = coverageStart > first && cycleKeyOf(coverageStart) === month;
  const completeness: MonthCompleteness = complete ? (partial ? "PERIODE_PARSIAL" : "LENGKAP") : "SEMENTARA";
  return { completeness, coveredDays: covered, expectedDays: expected, gaps, overlaps };
}
