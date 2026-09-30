// BCA monthly cycle rules (PRD: Monthly flow BCA). Pure functions only.
import { addDays, nextCycleKey } from "@/lib/business-time";
import type { MinorUnits } from "@/lib/money";

/** Last calendar day of a `YYYY-MM` cycle. */
export function lastDayOfCycle(cycle: string): number {
  const [year, month] = cycle.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Expected day 29–31 falls back to the last day of shorter months without changing the configured day. */
export function expectedDateFor(cycle: string, day: number | null): string | null {
  if (day === null) return null;
  const actual = Math.min(day, lastDayOfCycle(cycle));
  return `${cycle}-${String(actual).padStart(2, "0")}`;
}

export function cyclesBetween(from: string, to: string): string[] {
  const cycles: string[] = [];
  for (let cycle = from; cycle <= to; cycle = nextCycleKey(cycle)) cycles.push(cycle);
  return cycles;
}

export type IncomeStatus = "PENDING" | "CONFIRMED" | "NOT_RECEIVED";
export type ObligationStatus = "PENDING" | "CONFIRMED" | "NOT_CHARGED";

export type CycleState =
  | "WAITING_FOR_PRIOR_CYCLE"
  | "WAITING_FOR_INCOME"
  | "WAITING_FOR_OBLIGATIONS"
  | "CLOSED_NO_INCOME"
  | "READY_TO_TRANSFER"
  | "PARTIALLY_TRANSFERRED"
  | "COMPLETE";

export type CycleNote = "NO_TRANSFER_NEEDED" | "EXCEEDS_SUGGESTION" | "NO_AUTOMATIC_SUGGESTION" | "TARGET_CLOSED" | null;

/**
 * Deterministic, mutually exclusive cycle state (PRD precedence table,
 * evaluated top to bottom). `income` is null for an obligation-only cycle.
 */
export function cycleState(input: {
  priorBlocked: boolean;
  income: IncomeStatus | null;
  obligations: readonly ObligationStatus[];
  target: { amount: MinorUnits; isActionable: boolean; retirementReason: string | null } | null;
  linked: MinorUnits;
}): { state: CycleState; note: CycleNote; ready: boolean } {
  if (input.priorBlocked) return { state: "WAITING_FOR_PRIOR_CYCLE", note: null, ready: false };
  if (input.income === "PENDING") return { state: "WAITING_FOR_INCOME", note: null, ready: false };
  if (input.obligations.includes("PENDING")) return { state: "WAITING_FOR_OBLIGATIONS", note: null, ready: false };
  if (input.income === "NOT_RECEIVED") return { state: "CLOSED_NO_INCOME", note: null, ready: false };
  if (input.income === null) return { state: "COMPLETE", note: "NO_AUTOMATIC_SUGGESTION", ready: false };

  // Ready branch: income CONFIRMED, every obligation resolved, no prior blocker.
  const target = input.target;
  if (!target) return { state: "READY_TO_TRANSFER", note: null, ready: true }; // frozen atomically by the caller
  if (!target.isActionable) {
    return target.retirementReason === "LIQUIDITY_WRITE_OFF"
      ? { state: "COMPLETE", note: "TARGET_CLOSED", ready: true }
      : { state: "CLOSED_NO_INCOME", note: null, ready: true };
  }
  if (target.amount === 0n) return { state: "COMPLETE", note: input.linked > 0n ? "EXCEEDS_SUGGESTION" : "NO_TRANSFER_NEEDED", ready: true };
  if (input.linked === 0n) return { state: "READY_TO_TRANSFER", note: null, ready: true };
  if (input.linked < target.amount) return { state: "PARTIALLY_TRANSFERRED", note: null, ready: true };
  return { state: "COMPLETE", note: input.linked > target.amount ? "EXCEEDS_SUGGESTION" : null, ready: true };
}

/**
 * Suggested BCA → reserve target (PRD): balance basis at readiness (personal
 * balance plus early fulfillment) minus the retained floor and prior outstanding.
 */
export function bcaTargetAmount(input: { personalBalance: MinorUnits; earlyFulfillment: MinorUnits; floor: MinorUnits; priorOutstanding: MinorUnits }): MinorUnits {
  const amount = input.personalBalance + input.earlyFulfillment - input.floor - input.priorOutstanding;
  return amount > 0n ? amount : 0n;
}

export type OccurrenceLabel = "OVERDUE" | "LATE" | "DUE_SOON" | "NEEDS_REVIEW" | null;

/** Income is expected on days 1–7: pending after the window is OVERDUE, confirmed after it LATE. */
export function incomeLabel(cycle: string, status: IncomeStatus, actualDate: string | null, today: string): OccurrenceLabel {
  const windowEnd = `${cycle}-07`;
  if (status === "PENDING") return today > windowEnd ? "OVERDUE" : null;
  if (status === "CONFIRMED" && actualDate && actualDate > windowEnd) return "LATE";
  return null;
}

/** Derived obligation labels; a pending occurrence without an expected date is reviewed near month end. */
export function obligationLabel(cycle: string, status: ObligationStatus, expectedDate: string | null, today: string): OccurrenceLabel {
  if (status !== "PENDING") return null;
  if (!expectedDate) return today >= `${cycle}-${String(lastDayOfCycle(cycle) - 4).padStart(2, "0")}` ? "NEEDS_REVIEW" : null;
  if (today > expectedDate) return "OVERDUE";
  return today >= addDays(expectedDate, -3) ? "DUE_SOON" : null;
}
