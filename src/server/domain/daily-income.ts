// Daily income and weekly settlement rules (PRD: Daily income DANA, Weekly
// settlement DANA). Pure functions over business dates and bigint amounts.
import { addDays } from "@/lib/business-time";
import type { MinorUnits } from "@/lib/money";

export type RuleState = "ACTIVE" | "PAUSED";
export type Transition = { id: string; toState: RuleState; effectiveDate: string };
export type OverrideAmount = { businessDate: string; amount: MinorUnits | null };

const sortTransitions = (transitions: readonly Transition[]) =>
  [...transitions].sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : a.effectiveDate > b.effectiveDate ? 1 : 0));

/** State on a date: the rule starts ACTIVE; transitions are inclusive from their effective date. */
export function stateOn(date: string, startDate: string, transitions: readonly Transition[]): RuleState | "NOT_STARTED" {
  if (date < startDate) return "NOT_STARTED";
  let state: RuleState = "ACTIVE";
  for (const transition of sortTransitions(transitions)) {
    if (transition.effectiveDate > date) break;
    state = transition.toState;
  }
  return state;
}

export type DailyIncomeDay = { date: string; state: RuleState | "NOT_STARTED"; amount: MinorUnits; overridden: boolean };

export type DailyIncomeSummary = {
  days: DailyIncomeDay[];
  scheduled: MinorUnits;
  recognized: MinorUnits;
  eligibleDays: number;
  receivedDays: number;
};

/**
 * Scheduled income = ACTIVE days × default amount; recognized income applies
 * sparse per-date overrides (PRD formula). Overrides on PAUSED dates are ignored.
 */
export function dailyIncomeBetween(
  rule: { amount: MinorUnits; startDate: string },
  transitions: readonly Transition[],
  overrides: readonly OverrideAmount[],
  from: string,
  to: string,
): DailyIncomeSummary {
  const summary: DailyIncomeSummary = { days: [], scheduled: 0n, recognized: 0n, eligibleDays: 0, receivedDays: 0 };
  const byDate = new Map(overrides.filter((o) => o.amount !== null).map((o) => [o.businessDate, o.amount!]));
  for (let date = from < rule.startDate ? rule.startDate : from; date <= to; date = addDays(date, 1)) {
    const state = stateOn(date, rule.startDate, transitions);
    if (state !== "ACTIVE") {
      summary.days.push({ date, state, amount: 0n, overridden: false });
      continue;
    }
    const override = byDate.get(date);
    const amount = override ?? rule.amount;
    summary.days.push({ date, state, amount, overridden: override !== undefined });
    summary.eligibleDays += 1;
    summary.scheduled += rule.amount;
    summary.recognized += amount;
    if (amount > 0n) summary.receivedDays += 1;
  }
  return summary;
}

/** 0 = Sunday … 6 = Saturday, independent of any time zone. */
export function dayOfWeek(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** The Sunday that ends the Monday–Sunday week containing `date`. */
export function weekEndOn(date: string): string {
  return addDays(date, (7 - dayOfWeek(date)) % 7);
}

export const daysBetweenInclusive = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

export type SettlementPlan = {
  periodStart: string;
  normalEnd: string;
  /** Derived label, never stored: not yet due, due today (Sunday), or overdue. */
  status: "INFORMATIONAL" | "DUE" | "OVERDUE";
};

/** Next contiguous period: from the day after the last settlement (or the rule start) to that week's Sunday. */
export function settlementPlan(ruleStart: string, lastSettledEnd: string | null, today: string): SettlementPlan {
  const periodStart = lastSettledEnd ? addDays(lastSettledEnd, 1) : ruleStart;
  const normalEnd = weekEndOn(periodStart);
  const status = normalEnd > today ? "INFORMATIONAL" : normalEnd === today ? "DUE" : "OVERDUE";
  return { periodStart, normalEnd, status };
}

export type RangeIssue = "END_BEFORE_START" | "END_IN_FUTURE" | "NONSTANDARD_RANGE";

/**
 * A period normally ends on its week's Sunday; a longer catch-up range to the
 * date of a known balance is allowed only once the normal period is overdue.
 */
export function settlementRangeIssues(plan: SettlementPlan, endDate: string, today: string): RangeIssue[] {
  if (endDate < plan.periodStart) return ["END_BEFORE_START"];
  if (endDate > today) return ["END_IN_FUTURE"];
  if (endDate === plan.normalEnd) return [];
  return plan.status === "OVERDUE" && endDate > plan.normalEnd ? [] : ["NONSTANDARD_RANGE"];
}

export type TransitionIssue =
  | "BEFORE_OPEN_PERIOD"
  | "DUPLICATE_DATE"
  | "UPCOMING_EXISTS"
  | "NO_OP"
  | "CONFLICTS_WITH_LATER_TRANSITION";

/** First date whose state may still change: after the rule start and after the last settlement. */
export function minimumTransitionDate(startDate: string, lastSettledEnd: string | null): string {
  const afterSettlement = lastSettledEnd ? addDays(lastSettledEnd, 1) : startDate;
  return afterSettlement > startDate ? afterSettlement : startDate;
}

/** Default effective date: today if still open, otherwise the first date after the last settlement. */
export function defaultTransitionDate(startDate: string, lastSettledEnd: string | null, today: string): string {
  const minimum = minimumTransitionDate(startDate, lastSettledEnd);
  return today >= minimum ? today : minimum;
}

export function transitionIssues(input: {
  startDate: string;
  lastSettledEnd: string | null;
  today: string;
  transitions: readonly Transition[];
  toState: RuleState;
  effectiveDate: string;
}): TransitionIssue[] {
  const issues: TransitionIssue[] = [];
  if (input.effectiveDate < minimumTransitionDate(input.startDate, input.lastSettledEnd)) issues.push("BEFORE_OPEN_PERIOD");
  if (input.transitions.some((t) => t.effectiveDate === input.effectiveDate)) issues.push("DUPLICATE_DATE");
  if (input.effectiveDate > input.today && input.transitions.some((t) => t.effectiveDate > input.today)) issues.push("UPCOMING_EXISTS");

  const before = input.transitions.filter((t) => t.effectiveDate < input.effectiveDate);
  const prior = input.effectiveDate <= input.startDate ? "ACTIVE" : stateOn(addDays(input.effectiveDate, -1), input.startDate, before);
  if (prior === input.toState) issues.push("NO_OP");

  const next = sortTransitions(input.transitions).find((t) => t.effectiveDate > input.effectiveDate);
  if (next && next.toState === input.toState) issues.push("CONFLICTS_WITH_LATER_TRANSITION");
  return issues;
}

/** Nearest whole rupiah, half away from zero, in minor units (display only; PRD: `≈`). */
export function roundedAverage(total: MinorUnits, days: number): MinorUnits {
  if (days <= 0) return 0n;
  const divisor = BigInt(days) * 100n;
  const negative = total < 0n;
  const magnitude = negative ? -total : total;
  const rupiah = (magnitude * 2n + divisor) / (divisor * 2n);
  return (negative ? -rupiah : rupiah) * 100n;
}

export type FlowBucket = "INFLOW" | "TRANSFER_IN" | "TRANSFER_OUT" | "DEDUCTION" | "NONE";

const inflowClasses = new Set(["OTHER_INCOME", "MONTHLY_INCOME"]);
const deductionClasses = new Set(["SPECIAL_EXPENSE", "OTHER_EXPENSE", "RECURRING_EXPENSE"]);

/**
 * Formula component of one personal effect on the weekly account (PRD LOCKED
 * classification). Reversals subtract from the bucket of what they reverse.
 */
export function classifyFlow(
  entry: { kind: string; eventClass: string; reportingClassification: string | null; correctionRole: string | null },
  personal: MinorUnits,
): { bucket: FlowBucket; amount: MinorUnits } {
  if (entry.eventClass === "LIVING" || personal === 0n) return { bucket: "NONE", amount: 0n };
  if (entry.eventClass === "PERSONAL_TRANSFER") {
    if (entry.kind === "CORRECTION_POSTING") return { bucket: "TRANSFER_OUT", amount: -personal };
    const reversal = entry.correctionRole === "REVERSAL";
    const base = reversal ? -personal : personal;
    const magnitude = base < 0n ? -base : base;
    return { bucket: base > 0n ? "TRANSFER_IN" : "TRANSFER_OUT", amount: reversal ? -magnitude : magnitude };
  }
  if (inflowClasses.has(entry.eventClass) || entry.reportingClassification === "OTHER_GIFT_INCOME") {
    return { bucket: "INFLOW", amount: personal };
  }
  if (deductionClasses.has(entry.eventClass) || entry.reportingClassification === "OWNERSHIP_OUTFLOW") {
    return { bucket: "DEDUCTION", amount: -personal };
  }
  return personal > 0n ? { bucket: "INFLOW", amount: personal } : { bucket: "DEDUCTION", amount: -personal };
}

export type Reconstruction = {
  openingPersonal: MinorUnits;
  scheduledIncome: MinorUnits;
  recognizedIncome: MinorUnits;
  eligibleDays: number;
  receivedDays: number;
  settlementDays: number;
  otherInflows: MinorUnits;
  transfersIn: MinorUnits;
  transfersOut: MinorUnits;
  nonLivingDeductions: MinorUnits;
  closingPhysical: MinorUnits;
  closingExternal: MinorUnits;
  closingPersonal: MinorUnits;
  livingExpense: MinorUnits;
  averagePerDay: MinorUnits;
  availableRemainder: MinorUnits;
};

/**
 * Ordinary living expense = opening personal + recognized income + other
 * inflows + transfers in − transfers out − non-living deductions − closing
 * personal. It may be negative (PRD OD-6) and is never clamped.
 */
export function reconstruct(input: {
  openingPersonal: MinorUnits;
  income: DailyIncomeSummary;
  flows: readonly { bucket: FlowBucket; amount: MinorUnits }[];
  settlementDays: number;
  closingPhysical: MinorUnits;
  closingExternal: MinorUnits;
}): Reconstruction {
  const total = (bucket: FlowBucket) => input.flows.filter((flow) => flow.bucket === bucket).reduce((sum, flow) => sum + flow.amount, 0n);
  const otherInflows = total("INFLOW");
  const transfersIn = total("TRANSFER_IN");
  const transfersOut = total("TRANSFER_OUT");
  const nonLivingDeductions = total("DEDUCTION");
  const closingPersonal = input.closingPhysical - input.closingExternal;
  const livingExpense =
    input.openingPersonal + input.income.recognized + otherInflows + transfersIn - transfersOut - nonLivingDeductions - closingPersonal;
  return {
    openingPersonal: input.openingPersonal,
    scheduledIncome: input.income.scheduled,
    recognizedIncome: input.income.recognized,
    eligibleDays: input.income.eligibleDays,
    receivedDays: input.income.receivedDays,
    settlementDays: input.settlementDays,
    otherInflows,
    transfersIn,
    transfersOut,
    nonLivingDeductions,
    closingPhysical: input.closingPhysical,
    closingExternal: input.closingExternal,
    closingPersonal,
    livingExpense,
    averagePerDay: roundedAverage(livingExpense, input.settlementDays),
    availableRemainder: closingPersonal,
  };
}
