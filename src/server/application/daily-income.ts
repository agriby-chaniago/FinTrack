// Daily income rule state, pause/resume transitions, and per-date overrides.
// Income is evaluated lazily from the rule history; no cron creates rows.
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { businessDateOf } from "@/lib/business-time";
import { parseIdrDecimal, toIdrDecimal } from "@/lib/money";
import { ApiError } from "@/server/api/errors";
import { businessDate, nonNegativeAmount } from "@/server/api/schemas";
import type { OwnerTx } from "@/server/db/owner";
import { dailyIncomeRule } from "@/server/db/schema/onboarding";
import { dailyIncomeOverride, dailyIncomeStateTransition, settlement } from "@/server/db/schema/settlement";
import {
  dailyIncomeBetween,
  defaultTransitionDate,
  minimumTransitionDate,
  stateOn,
  transitionIssues,
  type DailyIncomeSummary,
  type RuleState,
  type Transition,
} from "@/server/domain/daily-income";

export type DailyRuleContext = {
  rule: typeof dailyIncomeRule.$inferSelect;
  transitions: (Transition & { createdAt: Date })[];
  overrides: { id: string; businessDate: string; amount: bigint | null; afterSettlement: boolean }[];
  lastSettledEnd: string | null;
};

export async function lastSettledEnd(tx: OwnerTx, ownerId: string, accountId: string): Promise<string | null> {
  const [row] = await tx
    .select({ endDate: settlement.endDate })
    .from(settlement)
    .where(and(eq(settlement.ownerId, ownerId), eq(settlement.accountId, accountId), eq(settlement.status, "SETTLED")))
    .orderBy(desc(settlement.endDate))
    .limit(1);
  return row?.endDate ?? null;
}

export async function dailyRuleFor(tx: OwnerTx, ownerId: string, accountId?: string): Promise<typeof dailyIncomeRule.$inferSelect | undefined> {
  const [rule] = await tx
    .select()
    .from(dailyIncomeRule)
    .where(accountId ? and(eq(dailyIncomeRule.ownerId, ownerId), eq(dailyIncomeRule.accountId, accountId)) : eq(dailyIncomeRule.ownerId, ownerId))
    .orderBy(asc(dailyIncomeRule.createdAt))
    .limit(1);
  return rule;
}

/** Active transitions and current overrides of a rule: the inputs of daily income. */
async function incomeInputs(tx: OwnerTx, ownerId: string, ruleId: string) {
  const transitions = await tx
    .select()
    .from(dailyIncomeStateTransition)
    .where(and(eq(dailyIncomeStateTransition.ownerId, ownerId), eq(dailyIncomeStateTransition.ruleId, ruleId), eq(dailyIncomeStateTransition.status, "ACTIVE")))
    .orderBy(asc(dailyIncomeStateTransition.effectiveDate));
  const overrides = await tx
    .select()
    .from(dailyIncomeOverride)
    .where(and(eq(dailyIncomeOverride.ownerId, ownerId), eq(dailyIncomeOverride.ruleId, ruleId), isNull(dailyIncomeOverride.supersededById)));
  return {
    transitions: transitions.map((t) => ({ id: t.id, toState: t.toState as RuleState, effectiveDate: t.effectiveDate, createdAt: t.createdAt })),
    overrides: overrides.map((o) => ({ id: o.id, businessDate: o.businessDate, amount: o.amountMinor, afterSettlement: o.afterSettlement })),
  };
}

export async function dailyRuleContext(tx: OwnerTx, ownerId: string, ruleId: string): Promise<DailyRuleContext> {
  const [rule] = await tx.select().from(dailyIncomeRule).where(and(eq(dailyIncomeRule.ownerId, ownerId), eq(dailyIncomeRule.id, ruleId)));
  if (!rule) throw new ApiError("NOT_FOUND");
  return { rule, ...(await incomeInputs(tx, ownerId, ruleId)), lastSettledEnd: await lastSettledEnd(tx, ownerId, rule.accountId) };
}

/** Recognized daily income for an account between two business dates (inclusive). */
export async function recognizedIncomeFor(
  tx: OwnerTx,
  ownerId: string,
  accountId: string,
  from: string,
  to: string,
  knownRule?: typeof dailyIncomeRule.$inferSelect,
): Promise<DailyIncomeSummary> {
  const rule = knownRule ?? (await dailyRuleFor(tx, ownerId, accountId));
  if (!rule || from > to) return { days: [], scheduled: 0n, recognized: 0n, eligibleDays: 0, receivedDays: 0 };
  const inputs = await incomeInputs(tx, ownerId, rule.id);
  return dailyIncomeBetween({ amount: rule.amountMinor, startDate: rule.effectiveStartDate }, inputs.transitions, inputs.overrides, from, to);
}

export type DailyIncomeView = {
  ruleId: string;
  accountId: string;
  amount: string;
  effectiveStartDate: string;
  currentState: RuleState | "NOT_STARTED";
  upcomingTransition: { id: string; toState: RuleState; effectiveDate: string } | null;
  transitions: { id: string; toState: RuleState; effectiveDate: string }[];
  overrides: { businessDate: string; amount: string | null; afterSettlement: boolean }[];
  minimumTransitionDate: string;
  defaultTransitionDate: string;
  lastSettledEnd: string | null;
};

export async function dailyIncomeView(tx: OwnerTx, ownerId: string, now: Date): Promise<DailyIncomeView | null> {
  const rule = await dailyRuleFor(tx, ownerId);
  if (!rule) return null;
  const context = await dailyRuleContext(tx, ownerId, rule.id);
  const today = businessDateOf(now);
  const upcoming = context.transitions.find((t) => t.effectiveDate > today) ?? null;
  return {
    ruleId: rule.id,
    accountId: rule.accountId,
    amount: toIdrDecimal(rule.amountMinor),
    effectiveStartDate: rule.effectiveStartDate,
    currentState: stateOn(today, rule.effectiveStartDate, context.transitions),
    upcomingTransition: upcoming && { id: upcoming.id, toState: upcoming.toState, effectiveDate: upcoming.effectiveDate },
    transitions: context.transitions.map(({ id, toState, effectiveDate }) => ({ id, toState, effectiveDate })),
    overrides: context.overrides.map((o) => ({ businessDate: o.businessDate, amount: o.amount === null ? null : toIdrDecimal(o.amount), afterSettlement: o.afterSettlement })),
    minimumTransitionDate: minimumTransitionDate(rule.effectiveStartDate, context.lastSettledEnd),
    defaultTransitionDate: defaultTransitionDate(rule.effectiveStartDate, context.lastSettledEnd, today),
    lastSettledEnd: context.lastSettledEnd,
  };
}

export const transitionSchema = z.object({ toState: z.enum(["ACTIVE", "PAUSED"]), effectiveDate: businessDate.optional() });

/**
 * Pause or resume from an inclusive effective date. Backdating stays inside
 * the unsettled period; at most one upcoming transition exists per rule.
 */
export async function scheduleTransition(
  tx: OwnerTx,
  ownerId: string,
  ruleId: string,
  input: z.infer<typeof transitionSchema>,
  now: Date,
): Promise<{ id: string; effectiveDate: string }> {
  const context = await dailyRuleContext(tx, ownerId, ruleId);
  const today = businessDateOf(now);
  const effectiveDate = input.effectiveDate ?? defaultTransitionDate(context.rule.effectiveStartDate, context.lastSettledEnd, today);
  const issues = transitionIssues({
    startDate: context.rule.effectiveStartDate,
    lastSettledEnd: context.lastSettledEnd,
    today,
    transitions: context.transitions,
    toState: input.toState,
    effectiveDate,
  });
  if (issues.length > 0) throw new ApiError("VALIDATION_FAILED", { issues });
  const [row] = await tx
    .insert(dailyIncomeStateTransition)
    .values({ ownerId, ruleId, toState: input.toState, effectiveDate })
    .returning({ id: dailyIncomeStateTransition.id });
  return { id: row.id, effectiveDate };
}

/** Cancels a transition that has not entered a settled period; the revision stays in history. */
export async function cancelTransition(tx: OwnerTx, ownerId: string, ruleId: string, transitionId: string, now: Date): Promise<void> {
  const context = await dailyRuleContext(tx, ownerId, ruleId);
  const transition = context.transitions.find((t) => t.id === transitionId);
  if (!transition) throw new ApiError("NOT_FOUND");
  if (context.lastSettledEnd && transition.effectiveDate <= context.lastSettledEnd) {
    throw new ApiError("VALIDATION_FAILED", { issues: ["SETTLED_PERIOD"] });
  }
  // Removing it must not turn a later transition into a no-op.
  const remaining = context.transitions.filter((t) => t.id !== transitionId);
  const next = remaining.find((t) => t.effectiveDate > transition.effectiveDate);
  if (next) {
    const prior = remaining.filter((t) => t.effectiveDate < next.effectiveDate);
    const stateBefore = stateOn(next.effectiveDate, context.rule.effectiveStartDate, prior);
    if (stateBefore === next.toState) throw new ApiError("VALIDATION_FAILED", { issues: ["CONFLICTS_WITH_LATER_TRANSITION"] });
  }
  await tx
    .update(dailyIncomeStateTransition)
    .set({ status: "CANCELLED", cancelledAt: now })
    .where(and(eq(dailyIncomeStateTransition.ownerId, ownerId), eq(dailyIncomeStateTransition.id, transitionId)));
}

export const overrideSchema = z.object({ businessDate, amount: nonNegativeAmount.nullable() });

/**
 * Sets the actual amount of an ACTIVE date (Rp0 = not received) or restores the
 * default with null. A settled date is corrected after settlement: the change
 * is flagged and the settlement's corrected living expense is resynchronized.
 */
export async function setOverride(
  tx: OwnerTx,
  ownerId: string,
  ruleId: string,
  input: z.infer<typeof overrideSchema>,
  now: Date,
): Promise<{ afterSettlement: boolean }> {
  const context = await dailyRuleContext(tx, ownerId, ruleId);
  if (input.businessDate > businessDateOf(now)) throw new ApiError("VALIDATION_FAILED", { issues: ["BUSINESS_DATE_IN_FUTURE"] });
  if (stateOn(input.businessDate, context.rule.effectiveStartDate, context.transitions) !== "ACTIVE") {
    throw new ApiError("VALIDATION_FAILED", { issues: ["DATE_NOT_ACTIVE"] });
  }
  const amount = input.amount === null ? null : parseIdrDecimal(input.amount);
  const current = context.overrides.find((o) => o.businessDate === input.businessDate);
  if ((current?.amount ?? null) === amount) throw new ApiError("VALIDATION_FAILED", { issues: ["NO_CHANGE"] });

  const afterSettlement = Boolean(context.lastSettledEnd && input.businessDate <= context.lastSettledEnd);
  const id = crypto.randomUUID();
  if (current) {
    await tx.update(dailyIncomeOverride).set({ supersededById: id }).where(and(eq(dailyIncomeOverride.ownerId, ownerId), eq(dailyIncomeOverride.id, current.id)));
  }
  await tx.insert(dailyIncomeOverride).values({
    id,
    ownerId,
    ruleId,
    businessDate: input.businessDate,
    amountMinor: amount,
    afterSettlement,
    supersedesId: current?.id ?? null,
  });
  if (afterSettlement) {
    const { resyncSettlements } = await import("./settlement");
    await resyncSettlements(tx, ownerId, context.rule.accountId, input.businessDate, now);
  }
  return { afterSettlement };
}
