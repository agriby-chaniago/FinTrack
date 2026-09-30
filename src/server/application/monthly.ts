// BCA monthly cycles (PRD: Monthly flow BCA): lazy occurrences, append-only
// resolutions, chronological gating, readiness, and frozen transfer targets.
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { businessDateOf, cycleKeyOf, isCycleKey, nextCycleKey } from "@/lib/business-time";
import { parseIdrDecimal, toIdrDecimal, type MinorUnits } from "@/lib/money";
import { ApiError } from "@/server/api/errors";
import { businessDate, positiveAmount } from "@/server/api/schemas";
import type { OwnerTx } from "@/server/db/owner";
import { ledgerEntry } from "@/server/db/schema/ledger";
import { monthlyIncomeOccurrence, occurrenceResolution, recurringExpenseOccurrence } from "@/server/db/schema/monthly";
import { account, monthlyAccountSetting, monthlyIncomeRule, recurringExpenseRule, recurringExpenseRuleRevision } from "@/server/db/schema/onboarding";
import { transferTargetVersion } from "@/server/db/schema/transfers";
import type { LedgerEntryDraft } from "@/server/domain/ledger";
import {
  bcaTargetAmount,
  cycleState,
  cyclesBetween,
  expectedDateFor,
  incomeLabel,
  obligationLabel,
  type CycleNote,
  type CycleState,
  type IncomeStatus,
  type ObligationStatus,
} from "@/server/domain/monthly";
import { cleanDisplayName, normalizeName } from "@/server/domain/names";

import { accountBalances, lockLedger, postLedgerEntry } from "./ledger";
import {
  createTargetVersion,
  currentVersion,
  ensureTarget,
  linkedAmounts,
  progressOf,
  remainingOf,
  reserveAccountId,
  routeTargets,
  type Route,
} from "./transfers";

type OccurrenceType = "MONTHLY_INCOME" | "RECURRING_EXPENSE";

async function monthlyRoute(tx: OwnerTx, ownerId: string, accountId: string): Promise<Route> {
  return { sourceAccountId: accountId, destinationAccountId: await reserveAccountId(tx, ownerId) };
}

/** Creates missing occurrences for every rule through the current cycle (idempotent, no cron). */
export async function syncMonthlyOccurrences(tx: OwnerTx, ownerId: string, now: Date): Promise<void> {
  const current = cycleKeyOf(businessDateOf(now));
  // Occurrences are created contiguously, so a rule whose latest occurrence is
  // already its last due cycle needs no work (the common case on every page load).
  const latest = new Map(
    (
      await tx.execute<{ rule_id: string; last: string }>(sql`
        select rule_id, max(cycle_key) as last from fintrack.monthly_income_occurrence where owner_id = ${ownerId} group by rule_id
        union all
        select rule_id, max(cycle_key) from fintrack.recurring_expense_occurrence where owner_id = ${ownerId} group by rule_id`)
    ).map((row) => [row.rule_id, row.last]),
  );
  const upToDate = (ruleId: string, last: string) => (latest.get(ruleId) ?? "") >= last;
  for (const rule of await tx.select().from(monthlyIncomeRule).where(eq(monthlyIncomeRule.ownerId, ownerId))) {
    const last = rule.lastExpectedCycle && rule.lastExpectedCycle < current ? rule.lastExpectedCycle : current;
    const cycles = rule.firstExpectedCycle <= last && !upToDate(rule.id, last) ? cyclesBetween(rule.firstExpectedCycle, last) : [];
    if (cycles.length > 0) {
      await tx
        .insert(monthlyIncomeOccurrence)
        .values(cycles.map((cycleKey) => ({ ownerId, ruleId: rule.id, cycleKey, expectedAmountMinor: rule.expectedAmountMinor })))
        .onConflictDoNothing();
    }
  }
  for (const rule of await tx.select().from(recurringExpenseRule).where(eq(recurringExpenseRule.ownerId, ownerId))) {
    const last = rule.lastCycle && rule.lastCycle < current ? rule.lastCycle : current;
    if (rule.firstCycle > last || upToDate(rule.id, last)) continue;
    const revisions = await tx
      .select()
      .from(recurringExpenseRuleRevision)
      .where(and(eq(recurringExpenseRuleRevision.ownerId, ownerId), eq(recurringExpenseRuleRevision.ruleId, rule.id), isNull(recurringExpenseRuleRevision.supersededById)))
      .orderBy(asc(recurringExpenseRuleRevision.effectiveFromCycle));
    const values = cyclesBetween(rule.firstCycle, last).map((cycleKey) => {
      // The expected snapshot comes from the revision in force for that cycle.
      const revision = [...revisions].reverse().find((r) => r.effectiveFromCycle <= cycleKey);
      return { ownerId, ruleId: rule.id, cycleKey, expectedDay: revision?.expectedDay ?? null, expectedAmountMinor: revision?.expectedAmountMinor ?? null };
    });
    await tx.insert(recurringExpenseOccurrence).values(values).onConflictDoNothing();
  }
}

type Resolution = typeof occurrenceResolution.$inferSelect;

async function currentResolutions(tx: OwnerTx, ownerId: string, ids: string[]): Promise<Map<string, Resolution>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select()
    .from(occurrenceResolution)
    .where(and(eq(occurrenceResolution.ownerId, ownerId), inArray(occurrenceResolution.occurrenceId, ids), isNull(occurrenceResolution.supersededById)));
  return new Map(rows.map((row) => [row.occurrenceId, row]));
}

/** The record that currently represents a confirmed event: the last replacement not reversed. */
async function currentRecordInChain(tx: OwnerTx, ownerId: string, entryId: string): Promise<string | null> {
  let id = entryId;
  for (;;) {
    const links = await tx
      .select({ id: ledgerEntry.id, role: ledgerEntry.correctionRole })
      .from(ledgerEntry)
      .where(and(eq(ledgerEntry.ownerId, ownerId), eq(ledgerEntry.correctsEntryId, id)));
    const replacement = links.find((link) => link.role === "REPLACEMENT");
    if (replacement) {
      id = replacement.id;
      continue;
    }
    return links.some((link) => link.role === "REVERSAL") ? null : id;
  }
}

type Actual = { date: string; amount: string; entryId: string };

/**
 * Current actual event per confirmed resolution entry, in one query: follows
 * each replacement chain to its last record (as currentRecordInChain does)
 * and drops chains whose last record was reversed.
 */
async function actualsOf(tx: OwnerTx, ownerId: string, entryIds: string[]): Promise<Map<string, Actual>> {
  if (entryIds.length === 0) return new Map();
  const roots = sql.join(entryIds.map((id) => sql`${id}::uuid`), sql`, `);
  const rows = await tx.execute<{ root: string; current: string; date: string; amount: string; reversed: boolean }>(sql`
    with recursive chain(root, current, depth) as (
      select e.id, e.id, 0 from fintrack.ledger_entry e where e.owner_id = ${ownerId} and e.id in (${roots})
      union all
      select c.root, r.id, c.depth + 1 from chain c
      join fintrack.ledger_entry r on r.owner_id = ${ownerId} and r.corrects_entry_id = c.current and r.correction_role = 'REPLACEMENT'
    ),
    latest as (select distinct on (root) root, current from chain order by root, depth desc)
    select l.root, l.current, e.effective_business_date::text as date, abs(sum(g.physical_effect_minor))::text as amount,
           exists (select 1 from fintrack.ledger_entry v
                   where v.owner_id = ${ownerId} and v.corrects_entry_id = l.current and v.correction_role = 'REVERSAL') as reversed
    from latest l
    join fintrack.ledger_entry e on e.id = l.current
    join fintrack.ledger_leg g on g.entry_id = e.id
    group by l.root, l.current, e.effective_business_date`);
  return new Map(
    rows.filter((row) => !row.reversed).map((row) => [row.root, { date: row.date, amount: toIdrDecimal(BigInt(row.amount)), entryId: row.current }]),
  );
}

type CycleData = {
  cycleKey: string;
  accountId: string;
  income: { occurrence: typeof monthlyIncomeOccurrence.$inferSelect; status: IncomeStatus; resolution: Resolution | null } | null;
  obligations: {
    occurrence: typeof recurringExpenseOccurrence.$inferSelect;
    rule: typeof recurringExpenseRule.$inferSelect;
    status: ObligationStatus;
    resolution: Resolution | null;
  }[];
};

async function loadCycles(tx: OwnerTx, ownerId: string): Promise<CycleData[]> {
  const incomes = await tx
    .select({ occurrence: monthlyIncomeOccurrence, accountId: monthlyIncomeRule.accountId })
    .from(monthlyIncomeOccurrence)
    .innerJoin(monthlyIncomeRule, eq(monthlyIncomeRule.id, monthlyIncomeOccurrence.ruleId))
    .where(eq(monthlyIncomeOccurrence.ownerId, ownerId));
  const obligations = await tx
    .select({ occurrence: recurringExpenseOccurrence, rule: recurringExpenseRule })
    .from(recurringExpenseOccurrence)
    .innerJoin(recurringExpenseRule, eq(recurringExpenseRule.id, recurringExpenseOccurrence.ruleId))
    .where(eq(recurringExpenseOccurrence.ownerId, ownerId));
  const resolutions = await currentResolutions(tx, ownerId, [...incomes.map((i) => i.occurrence.id), ...obligations.map((o) => o.occurrence.id)]);

  const cycles = new Map<string, CycleData>();
  const cycleFor = (cycleKey: string, accountId: string) => {
    const key = `${accountId}|${cycleKey}`;
    const existing = cycles.get(key) ?? { cycleKey, accountId, income: null, obligations: [] };
    cycles.set(key, existing);
    return existing;
  };
  for (const { occurrence, accountId } of incomes) {
    const resolution = resolutions.get(occurrence.id) ?? null;
    cycleFor(occurrence.cycleKey, accountId).income = { occurrence, resolution, status: (resolution?.outcome as IncomeStatus) ?? "PENDING" };
  }
  for (const { occurrence, rule } of obligations) {
    const resolution = resolutions.get(occurrence.id) ?? null;
    cycleFor(occurrence.cycleKey, rule.accountId).obligations.push({ occurrence, rule, resolution, status: (resolution?.outcome as ObligationStatus) ?? "PENDING" });
  }
  return [...cycles.values()].sort((a, b) => (a.cycleKey < b.cycleKey ? -1 : a.cycleKey > b.cycleKey ? 1 : 0));
}

const resolvedCycle = (cycle: CycleData) =>
  (cycle.income === null || cycle.income.status !== "PENDING") && cycle.obligations.every((o) => o.status !== "PENDING");

async function floorOf(tx: OwnerTx, ownerId: string, accountId: string): Promise<MinorUnits> {
  const [row] = await tx
    .select({ floor: monthlyAccountSetting.retainedBalanceFloorMinor })
    .from(monthlyAccountSetting)
    .where(and(eq(monthlyAccountSetting.ownerId, ownerId), eq(monthlyAccountSetting.accountId, accountId)));
  if (!row) throw new ApiError("VALIDATION_FAILED", { issues: ["RETAINED_FLOOR_REQUIRED"] });
  return row.floor;
}

/**
 * Freezes the target of every cycle that has entered the ready branch without
 * one (PRD: target created atomically at readiness), including a cycle whose
 * income was confirmed again after NOT_RECEIVED.
 */
type LoadedTargets = Map<string, Awaited<ReturnType<typeof routeTargets>>>;

export async function syncCycleTargets(tx: OwnerTx, ownerId: string, now: Date): Promise<{ cycles: CycleData[]; targets: LoadedTargets }> {
  await syncMonthlyOccurrences(tx, ownerId, now);
  const cycles = await loadCycles(tx, ownerId);
  const reserve = await reserveAccountId(tx, ownerId);
  // Current targets per monthly account, dropped when this sync freezes a new one.
  const frozen: LoadedTargets = new Map();
  const blocked = new Set<string>();
  for (const cycle of cycles) {
    const priorBlocked = blocked.has(cycle.accountId);
    if (!resolvedCycle(cycle)) blocked.add(cycle.accountId);
    if (priorBlocked || cycle.income?.status !== "CONFIRMED" || !resolvedCycle(cycle)) continue;

    const route = { sourceAccountId: cycle.accountId, destinationAccountId: reserve };
    // Targets already frozen for this route are read once; only a cycle without one does work.
    if (!frozen.has(cycle.accountId)) frozen.set(cycle.accountId, await routeTargets(tx, ownerId, route));
    const existing = frozen.get(cycle.accountId)!.find((t) => t.contextType === "BCA_CYCLE" && t.contextKey === cycle.cycleKey);
    if (existing?.version && existing.version.retirementReason !== "INCOME_NOT_RECEIVED") continue;

    const targetId = await ensureTarget(tx, ownerId, { contextType: "BCA_CYCLE", contextKey: cycle.cycleKey, contextOrder: cycle.cycleKey }, route);
    const version = await currentVersion(tx, ownerId, targetId);
    if (version && !(version.retirementReason === "INCOME_NOT_RECEIVED")) continue;
    frozen.delete(cycle.accountId);

    const { accounts } = await accountBalances(tx, ownerId);
    const personalBalance = parseIdrDecimal(accounts.find((row) => row.id === cycle.accountId)!.personal);
    const earlyFulfillment = (await linkedAmounts(tx, ownerId, [targetId])).get(targetId) ?? 0n;
    const floor = await floorOf(tx, ownerId, cycle.accountId);
    const priorOutstanding = (await routeTargets(tx, ownerId, route))
      .filter((target) => target.contextOrder < cycle.cycleKey)
      .reduce((sum, target) => sum + remainingOf(target), 0n);
    const amount = bcaTargetAmount({ personalBalance, earlyFulfillment, floor, priorOutstanding });
    await createTargetVersion(tx, ownerId, targetId, {
      amount,
      basis: {
        personalBalanceAtReadiness: toIdrDecimal(personalBalance),
        currentCycleEarlyFulfillment: toIdrDecimal(earlyFulfillment),
        priorOutstandingAtReadiness: toIdrDecimal(priorOutstanding),
        retainedFloorUsed: toIdrDecimal(floor),
        frozenOn: businessDateOf(now),
      },
      isActionable: true,
    });
  }
  return { cycles, targets: frozen };
}

type Basis = {
  personalBalanceAtReadiness: string;
  currentCycleEarlyFulfillment: string;
  priorOutstandingAtReadiness: string;
  retainedFloorUsed: string;
  frozenOn: string;
};

/**
 * Recalculation chain for BCA targets (PRD v0.18): chronological per route;
 * each basis absorbs corrections recorded after its first freeze that are
 * effective on or before it; allocations are never moved.
 */
export async function recalculateBcaChain(tx: OwnerTx, ownerId: string, accountId: string): Promise<void> {
  const route = await monthlyRoute(tx, ownerId, accountId);
  for (const target of await routeTargets(tx, ownerId, route)) {
    if (target.contextType !== "BCA_CYCLE" || !target.version?.isActionable) continue;
    const [first] = await tx
      .select({ createdAt: transferTargetVersion.createdAt, basis: transferTargetVersion.basis })
      .from(transferTargetVersion)
      .where(and(eq(transferTargetVersion.ownerId, ownerId), eq(transferTargetVersion.targetId, target.id)))
      .orderBy(asc(transferTargetVersion.createdAt))
      .limit(1);
    const basis = first.basis as Basis;
    if (!basis.frozenOn) continue;
    const [delta] = await tx.execute<{ total: string }>(sql`
      select coalesce(sum(l.physical_effect_minor - l.external_effect_minor), 0)::text as total
      from fintrack.ledger_leg l join fintrack.ledger_entry e on e.id = l.entry_id
      where e.owner_id = ${ownerId} and l.account_id = ${accountId}
        and e.recorded_at > ${first.createdAt.toISOString()}::timestamptz
        and e.effective_business_date <= ${basis.frozenOn}::date
        and (e.correction_role is not null or e.kind = 'CORRECTION_POSTING')`);
    const earlier = (await routeTargets(tx, ownerId, route)).filter((t) => t.contextOrder < target.contextOrder);
    let prior = 0n;
    for (const t of earlier) {
      if (!t.version?.isActionable) continue;
      const [linked] = await tx.execute<{ total: string }>(sql`
        select coalesce(sum(sign * magnitude_minor), 0)::text as total from fintrack.transfer_allocation
        where owner_id = ${ownerId} and target_id = ${t.id}::uuid and created_at <= ${first.createdAt.toISOString()}::timestamptz`);
      const remaining = t.version.amountMinor - (BigInt(linked.total) < 0n ? 0n : BigInt(linked.total));
      prior += remaining > 0n ? remaining : 0n;
    }
    const personalBalance = parseIdrDecimal(basis.personalBalanceAtReadiness) + BigInt(delta.total);
    const amount = bcaTargetAmount({
      personalBalance,
      earlyFulfillment: parseIdrDecimal(basis.currentCycleEarlyFulfillment),
      floor: parseIdrDecimal(basis.retainedFloorUsed),
      priorOutstanding: prior,
    });
    if (amount !== target.version.amountMinor) {
      await createTargetVersion(tx, ownerId, target.id, {
        amount,
        basis: { ...basis, personalBalanceAtReadiness: toIdrDecimal(personalBalance), priorOutstandingAtReadiness: toIdrDecimal(prior), recalculated: true },
        isActionable: true,
      });
    }
  }
}

export const resolutionSchema = z.object({
  outcome: z.enum(["CONFIRMED", "NOT_RECEIVED", "NOT_CHARGED"]),
  actualDate: businessDate.optional(),
  actualAmount: positiveAmount.optional(),
});

/**
 * Appends a resolution: confirm (creating the actual income/expense), mark
 * NOT_RECEIVED / NOT_CHARGED, confirm late after a no-event outcome, or
 * correct an event to no-event with a reversal-only void. History is never edited.
 */
export async function resolveOccurrence(
  tx: OwnerTx,
  ownerId: string,
  type: OccurrenceType,
  occurrenceId: string,
  input: z.infer<typeof resolutionSchema>,
  now: Date,
): Promise<{ resolutionId: string; entryId: string | null }> {
  await lockLedger(tx, ownerId);
  const allowed = type === "MONTHLY_INCOME" ? ["CONFIRMED", "NOT_RECEIVED"] : ["CONFIRMED", "NOT_CHARGED"];
  if (!allowed.includes(input.outcome)) throw new ApiError("VALIDATION_FAILED", { issues: ["OUTCOME_NOT_ALLOWED"] });

  const occurrence =
    type === "MONTHLY_INCOME"
      ? (
          await tx
            .select({ id: monthlyIncomeOccurrence.id, cycleKey: monthlyIncomeOccurrence.cycleKey, accountId: monthlyIncomeRule.accountId })
            .from(monthlyIncomeOccurrence)
            .innerJoin(monthlyIncomeRule, eq(monthlyIncomeRule.id, monthlyIncomeOccurrence.ruleId))
            .where(and(eq(monthlyIncomeOccurrence.ownerId, ownerId), eq(monthlyIncomeOccurrence.id, occurrenceId)))
        )[0]
      : (
          await tx
            .select({ id: recurringExpenseOccurrence.id, cycleKey: recurringExpenseOccurrence.cycleKey, accountId: recurringExpenseRule.accountId })
            .from(recurringExpenseOccurrence)
            .innerJoin(recurringExpenseRule, eq(recurringExpenseRule.id, recurringExpenseOccurrence.ruleId))
            .where(and(eq(recurringExpenseOccurrence.ownerId, ownerId), eq(recurringExpenseOccurrence.id, occurrenceId)))
        )[0];
  if (!occurrence) throw new ApiError("NOT_FOUND");

  const current = (await currentResolutions(tx, ownerId, [occurrenceId])).get(occurrenceId) ?? null;
  if (current?.outcome === input.outcome) {
    throw new ApiError("VALIDATION_FAILED", { issues: [input.outcome === "CONFIRMED" ? "USE_KOREKSI_FOR_VALUES" : "NO_CHANGE"] });
  }

  const resolutionId = crypto.randomUUID();
  let entryId: string | null = null;

  if (input.outcome === "CONFIRMED") {
    if (!input.actualDate || !input.actualAmount) throw new ApiError("VALIDATION_FAILED", { issues: ["ACTUAL_DATE_AND_AMOUNT_REQUIRED"] });
    const amount = parseIdrDecimal(input.actualAmount);
    const draft: LedgerEntryDraft =
      type === "MONTHLY_INCOME"
        ? { kind: "INCOME", eventClass: "MONTHLY_INCOME", effectiveBusinessDate: input.actualDate, reportingClassification: null, legs: [{ accountId: occurrence.accountId, physicalEffect: amount, externalEffect: 0n, holdingId: null }] }
        : { kind: "EXPENSE", eventClass: "RECURRING_EXPENSE", effectiveBusinessDate: input.actualDate, reportingClassification: null, legs: [{ accountId: occurrence.accountId, physicalEffect: -amount, externalEffect: 0n, holdingId: null }] };
    // Occurrences never ask the cutover-day question: their boundary was chosen at onboarding.
    const posted = await postLedgerEntry(tx, ownerId, { ...draft, sourceType: "OCCURRENCE_RESOLUTION", sourceId: resolutionId }, { now, cutoverDayAnswer: "NOT_IN_OPENING" });
    if (!posted.recorded) throw new ApiError("INTERNAL_ERROR");
    entryId = posted.entryId;
  } else if (current?.outcome === "CONFIRMED" && current.entryId) {
    // Event → no-event: reversal-only void of the record that currently represents the event.
    const recordId = await currentRecordInChain(tx, ownerId, current.entryId);
    if (recordId) {
      const { correctEntry } = await import("./corrections");
      await correctEntry(tx, ownerId, recordId, { action: "VOID" }, now, { allowOccurrenceVoid: true });
    }
  }

  if (current) {
    await tx.update(occurrenceResolution).set({ supersededById: resolutionId }).where(and(eq(occurrenceResolution.ownerId, ownerId), eq(occurrenceResolution.id, current.id)));
  }
  await tx.insert(occurrenceResolution).values({
    id: resolutionId,
    ownerId,
    occurrenceType: type,
    occurrenceId,
    outcome: input.outcome,
    entryId,
    supersedesId: current?.id ?? null,
  });

  if (type === "MONTHLY_INCOME" && input.outcome === "NOT_RECEIVED") {
    // Income corrected to NOT_RECEIVED makes the cycle target non-actionable atomically.
    const route = await monthlyRoute(tx, ownerId, occurrence.accountId);
    const targetId = await ensureTarget(tx, ownerId, { contextType: "BCA_CYCLE", contextKey: occurrence.cycleKey, contextOrder: occurrence.cycleKey }, route);
    const version = await currentVersion(tx, ownerId, targetId);
    if (version) {
      await createTargetVersion(tx, ownerId, targetId, { amount: 0n, basis: version.basis as Record<string, unknown>, isActionable: false, retirementReason: "INCOME_NOT_RECEIVED" });
    }
  }

  await recalculateBcaChain(tx, ownerId, occurrence.accountId);
  await syncCycleTargets(tx, ownerId, now);
  return { resolutionId, entryId };
}

export type CycleView = {
  cycleKey: string;
  accountId: string;
  accountName: string;
  state: CycleState;
  note: CycleNote;
  income: {
    occurrenceId: string;
    expectedAmount: string;
    status: IncomeStatus;
    label: string | null;
    actual: { date: string; amount: string; entryId: string } | null;
  } | null;
  obligations: {
    occurrenceId: string;
    ruleId: string;
    kind: string;
    name: string;
    expectedDate: string | null;
    expectedAmount: string | null;
    status: ObligationStatus;
    label: string | null;
    actual: { date: string; amount: string; entryId: string } | null;
    suggestedAmount: string | null;
  }[];
  target: { id: string; amount: string; linked: string; remaining: string; progress: string; retirementReason: string | null } | null;
};

/** Cycles newest first with derived states and labels; freezes due targets first. */
export async function listMonthlyCycles(tx: OwnerTx, ownerId: string, now: Date): Promise<CycleView[]> {
  const { cycles, targets: targetsByAccount } = await syncCycleTargets(tx, ownerId, now);
  const today = businessDateOf(now);
  const names = new Map((await tx.select({ id: account.id, name: account.displayName }).from(account).where(eq(account.ownerId, ownerId))).map((a) => [a.id, a.name]));
  const missing = [...new Set(cycles.map((cycle) => cycle.accountId))].filter((accountId) => !targetsByAccount.has(accountId));
  if (missing.length > 0) {
    const reserve = await reserveAccountId(tx, ownerId);
    for (const accountId of missing) targetsByAccount.set(accountId, await routeTargets(tx, ownerId, { sourceAccountId: accountId, destinationAccountId: reserve }));
  }
  const actuals = await actualsOf(
    tx,
    ownerId,
    cycles.flatMap((cycle) => [cycle.income?.resolution?.entryId, ...cycle.obligations.map((o) => o.resolution?.entryId)]).filter((id): id is string => Boolean(id)),
  );
  // Confirmed amount per obligation rule and cycle: the latest earlier one suggests the next amount.
  const confirmedByRule = new Map<string, { cycleKey: string; amount: string }[]>();
  for (const row of await tx.execute<{ rule_id: string; cycle_key: string; amount: string }>(sql`
    select o.rule_id, o.cycle_key, abs(sum(l.physical_effect_minor))::text as amount
    from fintrack.occurrence_resolution r
    join fintrack.recurring_expense_occurrence o on o.id = r.occurrence_id
    join fintrack.ledger_leg l on l.entry_id = r.entry_id
    where r.owner_id = ${ownerId} and r.outcome = 'CONFIRMED' and r.superseded_by_id is null
    group by o.rule_id, o.cycle_key order by o.cycle_key`)) {
    confirmedByRule.set(row.rule_id, [...(confirmedByRule.get(row.rule_id) ?? []), { cycleKey: row.cycle_key, amount: row.amount }]);
  }
  const actualOf = (entryId: string | null | undefined) => (entryId ? (actuals.get(entryId) ?? null) : null);
  const views: CycleView[] = [];
  const blocked = new Set<string>();

  for (const cycle of cycles) {
    const priorBlocked = blocked.has(cycle.accountId);
    if (!resolvedCycle(cycle)) blocked.add(cycle.accountId);
    const target = targetsByAccount.get(cycle.accountId)!.find((t) => t.contextType === "BCA_CYCLE" && t.contextKey === cycle.cycleKey);
    const version = target?.version ?? null;
    const { state, note } = cycleState({
      priorBlocked,
      income: cycle.income?.status ?? null,
      obligations: cycle.obligations.map((o) => o.status),
      target: version && { amount: version.amountMinor, isActionable: version.isActionable, retirementReason: version.retirementReason },
      linked: target?.linked ?? 0n,
    });

    const income = cycle.income && {
      occurrenceId: cycle.income.occurrence.id,
      expectedAmount: toIdrDecimal(cycle.income.occurrence.expectedAmountMinor),
      status: cycle.income.status,
      actual: actualOf(cycle.income.resolution?.entryId),
      label: null as string | null,
    };
    if (income) income.label = incomeLabel(cycle.cycleKey, income.status, income.actual?.date ?? null, today);

    const obligations = [];
    for (const o of cycle.obligations) {
      const expectedDate = expectedDateFor(cycle.cycleKey, o.occurrence.expectedDay);
      // The latest actual amount is only a suggestion for the next cycle.
      const previous = (confirmedByRule.get(o.rule.id) ?? []).filter((row) => row.cycleKey < cycle.cycleKey).at(-1);
      obligations.push({
        occurrenceId: o.occurrence.id,
        ruleId: o.rule.id,
        kind: o.rule.kind,
        name: o.rule.displayName,
        expectedDate,
        expectedAmount: o.occurrence.expectedAmountMinor === null ? null : toIdrDecimal(o.occurrence.expectedAmountMinor),
        status: o.status,
        label: obligationLabel(cycle.cycleKey, o.status, expectedDate, today),
        actual: actualOf(o.resolution?.entryId),
        suggestedAmount: previous ? toIdrDecimal(BigInt(previous.amount)) : o.occurrence.expectedAmountMinor === null ? null : toIdrDecimal(o.occurrence.expectedAmountMinor),
      });
    }

    views.push({
      cycleKey: cycle.cycleKey,
      accountId: cycle.accountId,
      accountName: names.get(cycle.accountId) ?? "",
      state,
      note,
      income,
      obligations,
      target:
        target && version
          ? {
              id: target.id,
              amount: toIdrDecimal(version.amountMinor),
              linked: toIdrDecimal(target.linked),
              remaining: toIdrDecimal(remainingOf(target)),
              progress: progressOf(target),
              retirementReason: version.retirementReason,
            }
          : null,
    });
  }
  return views.reverse();
}

async function monthlyAccountId(tx: OwnerTx, ownerId: string): Promise<string> {
  const [rule] = await tx.select({ accountId: monthlyIncomeRule.accountId }).from(monthlyIncomeRule).where(eq(monthlyIncomeRule.ownerId, ownerId)).limit(1);
  if (!rule) throw new ApiError("ONBOARDING_NOT_CONFIRMED");
  return rule.accountId;
}

export const subscriptionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  expectedDay: z.number().int().min(1).max(31),
  expectedAmount: positiveAmount,
  includeCurrentCycle: z.boolean().default(false),
});

/** New subscription on the monthly account; first cycle is next month unless the current one is opted in (PRD OD-3). */
export async function createSubscription(tx: OwnerTx, ownerId: string, input: z.infer<typeof subscriptionSchema>, now: Date) {
  const accountId = await monthlyAccountId(tx, ownerId);
  const existing = await tx
    .select({ name: recurringExpenseRule.displayName, lastCycle: recurringExpenseRule.lastCycle })
    .from(recurringExpenseRule)
    .where(and(eq(recurringExpenseRule.ownerId, ownerId), eq(recurringExpenseRule.kind, "SUBSCRIPTION")));
  const current = cycleKeyOf(businessDateOf(now));
  if (existing.some((row) => normalizeName(row.name) === normalizeName(input.name) && (!row.lastCycle || row.lastCycle >= current))) {
    throw new ApiError("VALIDATION_FAILED", { issues: ["DUPLICATE_NAME"] });
  }
  const firstCycle = input.includeCurrentCycle ? current : nextCycleKey(current);
  const ruleId = crypto.randomUUID();
  await tx.insert(recurringExpenseRule).values({ id: ruleId, ownerId, accountId, kind: "SUBSCRIPTION", displayName: cleanDisplayName(input.name), firstCycle });
  await tx.insert(recurringExpenseRuleRevision).values({
    ownerId,
    ruleId,
    effectiveFromCycle: firstCycle,
    expectedDay: input.expectedDay,
    expectedAmountMinor: parseIdrDecimal(input.expectedAmount),
  });
  await syncCycleTargets(tx, ownerId, now);
  return { ruleId, firstCycle };
}

export const revisionSchema = z.object({
  effectiveFromCycle: z.string().refine(isCycleKey, "must be YYYY-MM"),
  expectedDay: z.number().int().min(1).max(31).nullable(),
  expectedAmount: positiveAmount.nullable(),
});

/**
 * Explicit, prospective schedule change (PRD): effective from the next cycle
 * at the earliest; a newer decision for the same cycle supersedes the pending one.
 */
export async function reviseRecurringRule(tx: OwnerTx, ownerId: string, ruleId: string, input: z.infer<typeof revisionSchema>, now: Date) {
  const [rule] = await tx.select().from(recurringExpenseRule).where(and(eq(recurringExpenseRule.ownerId, ownerId), eq(recurringExpenseRule.id, ruleId)));
  if (!rule) throw new ApiError("NOT_FOUND");
  const earliest = nextCycleKey(cycleKeyOf(businessDateOf(now)));
  if (input.effectiveFromCycle < earliest) throw new ApiError("VALIDATION_FAILED", { issues: ["REVISION_MUST_BE_PROSPECTIVE"] });
  if (rule.kind === "SUBSCRIPTION" && (input.expectedDay === null || input.expectedAmount === null)) {
    throw new ApiError("VALIDATION_FAILED", { issues: ["SUBSCRIPTION_NEEDS_DAY_AND_AMOUNT"] });
  }
  const [pending] = await tx
    .select()
    .from(recurringExpenseRuleRevision)
    .where(and(eq(recurringExpenseRuleRevision.ownerId, ownerId), eq(recurringExpenseRuleRevision.ruleId, ruleId), eq(recurringExpenseRuleRevision.effectiveFromCycle, input.effectiveFromCycle), isNull(recurringExpenseRuleRevision.supersededById)));
  const id = crypto.randomUUID();
  if (pending) await tx.update(recurringExpenseRuleRevision).set({ supersededById: id }).where(eq(recurringExpenseRuleRevision.id, pending.id));
  await tx.insert(recurringExpenseRuleRevision).values({
    id,
    ownerId,
    ruleId,
    effectiveFromCycle: input.effectiveFromCycle,
    expectedDay: input.expectedDay,
    expectedAmountMinor: input.expectedAmount === null ? null : parseIdrDecimal(input.expectedAmount),
    supersedesId: pending?.id ?? null,
  });
  return { revisionId: id };
}

export const endRuleSchema = z.object({ lastCycle: z.string().refine(isCycleKey, "must be YYYY-MM") });

/** Ends a rule after `lastCycle`; history and existing occurrences stay. */
export async function endRule(tx: OwnerTx, ownerId: string, kind: "MONTHLY_INCOME" | "RECURRING_EXPENSE", ruleId: string, input: z.infer<typeof endRuleSchema>, now: Date) {
  const current = cycleKeyOf(businessDateOf(now));
  if (input.lastCycle < current) throw new ApiError("VALIDATION_FAILED", { issues: ["LAST_CYCLE_IN_PAST"] });
  if (kind === "MONTHLY_INCOME") {
    const [rule] = await tx.select().from(monthlyIncomeRule).where(and(eq(monthlyIncomeRule.ownerId, ownerId), eq(monthlyIncomeRule.id, ruleId)));
    if (!rule) throw new ApiError("NOT_FOUND");
    if (input.lastCycle < rule.firstExpectedCycle) throw new ApiError("VALIDATION_FAILED", { issues: ["LAST_BEFORE_FIRST"] });
    await tx.update(monthlyIncomeRule).set({ lastExpectedCycle: input.lastCycle }).where(eq(monthlyIncomeRule.id, ruleId));
  } else {
    const [rule] = await tx.select().from(recurringExpenseRule).where(and(eq(recurringExpenseRule.ownerId, ownerId), eq(recurringExpenseRule.id, ruleId)));
    if (!rule) throw new ApiError("NOT_FOUND");
    if (input.lastCycle < rule.firstCycle) throw new ApiError("VALIDATION_FAILED", { issues: ["LAST_BEFORE_FIRST"] });
    await tx.update(recurringExpenseRule).set({ lastCycle: input.lastCycle }).where(eq(recurringExpenseRule.id, ruleId));
  }
}

/** Monthly income and recurring expense rules with their current expectations and derived status. */
export async function listRecurringRules(tx: OwnerTx, ownerId: string, now: Date) {
  const current = cycleKeyOf(businessDateOf(now));
  const status = (first: string, last: string | null) => (first > current ? "SCHEDULED" : last && last < current ? "ENDED" : "ACTIVE");
  const incomes = await tx.select().from(monthlyIncomeRule).where(eq(monthlyIncomeRule.ownerId, ownerId));
  const expenses = await tx.select().from(recurringExpenseRule).where(eq(recurringExpenseRule.ownerId, ownerId)).orderBy(asc(recurringExpenseRule.createdAt));
  const revisions = await tx
    .select()
    .from(recurringExpenseRuleRevision)
    .where(and(eq(recurringExpenseRuleRevision.ownerId, ownerId), isNull(recurringExpenseRuleRevision.supersededById)))
    .orderBy(desc(recurringExpenseRuleRevision.effectiveFromCycle));
  return {
    monthlyIncome: incomes.map((rule) => ({
      id: rule.id,
      accountId: rule.accountId,
      expectedAmount: toIdrDecimal(rule.expectedAmountMinor),
      firstExpectedCycle: rule.firstExpectedCycle,
      lastExpectedCycle: rule.lastExpectedCycle,
      status: status(rule.firstExpectedCycle, rule.lastExpectedCycle),
    })),
    recurringExpenses: expenses.map((rule) => {
      const ruleRevisions = revisions.filter((r) => r.ruleId === rule.id);
      const inForce = ruleRevisions.find((r) => r.effectiveFromCycle <= current) ?? ruleRevisions.at(-1);
      const upcoming = ruleRevisions.filter((r) => r.effectiveFromCycle > current).map((r) => ({
        effectiveFromCycle: r.effectiveFromCycle,
        expectedDay: r.expectedDay,
        expectedAmount: r.expectedAmountMinor === null ? null : toIdrDecimal(r.expectedAmountMinor),
      }));
      return {
        id: rule.id,
        accountId: rule.accountId,
        kind: rule.kind,
        name: rule.displayName,
        firstCycle: rule.firstCycle,
        lastCycle: rule.lastCycle,
        status: status(rule.firstCycle, rule.lastCycle),
        expectedDay: inForce?.expectedDay ?? null,
        expectedAmount: inForce?.expectedAmountMinor == null ? null : toIdrDecimal(inForce.expectedAmountMinor),
        upcomingRevisions: upcoming,
      };
    }),
  };
}

