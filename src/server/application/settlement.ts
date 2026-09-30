// Weekly DANA settlement (PRD: Weekly settlement DANA) and settled-history
// resynchronization (PRD: Derived settlement correction effect).
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { addDays, businessDateOf } from "@/lib/business-time";
import { parseIdrDecimal, toIdrDecimal, type MinorUnits } from "@/lib/money";
import { ApiError } from "@/server/api/errors";
import { businessDate, nonNegativeAmount } from "@/server/api/schemas";
import type { OwnerTx } from "@/server/db/owner";
import { account, accountActivationPosition } from "@/server/db/schema/onboarding";
import { balanceConfirmation, settlement } from "@/server/db/schema/settlement";
import { transferAllocation } from "@/server/db/schema/transfers";
import {
  classifyFlow,
  daysBetweenInclusive,
  reconstruct,
  settlementPlan,
  settlementRangeIssues,
  type CashPosition,
  type DailyIncomeSummary,
  type Reconstruction,
} from "@/server/domain/daily-income";

import { cashMemberOf, settlementAccountFor, type AccountRow } from "./accounts";
import { dailyRuleFor, lastSettledEnd, recognizedIncomeFor } from "./daily-income";
import { lockLedger, postLedgerEntry } from "./ledger";
import { createTargetVersion, currentVersion, ensureTarget, reserveAccountId, routeTargets, type Route } from "./transfers";

type Boundary = { date: string; recordedAt: Date };
const FAR_FUTURE = new Date("9999-12-31T00:00:00.000Z");

/** Entries counted in a position as of a boundary (PRD v0.18); a settlement's own living contribution always counts on its end date. */
function included(boundary: Boundary) {
  return sql`(e.effective_business_date < ${boundary.date}::date
    or (e.effective_business_date = ${boundary.date}::date
        and (e.recorded_at <= ${boundary.recordedAt.toISOString()}::timestamptz or e.event_class = 'LIVING')))`;
}

async function openingPosition(tx: OwnerTx, ownerId: string, accountId: string): Promise<{ physical: MinorUnits; external: MinorUnits }> {
  const [row] = await tx.execute<{ physical: string; external: string }>(sql`
    select coalesce(sum(p.physical_balance_minor), 0)::text as physical,
           coalesce((select sum(e.amount_minor) from fintrack.opening_external_position e
                     where e.snapshot_id = s.id and e.account_id = ${accountId}), 0)::text as external
    from fintrack.onboarding_snapshot s
    join fintrack.opening_account_position p on p.snapshot_id = s.id and p.account_id = ${accountId}
    where s.owner_id = ${ownerId} and s.status = 'CONFIRMED' and s.superseded_by_id is null
    group by s.id`);
  const [activation] = await tx.execute<{ physical: string }>(sql`
    select physical_balance_minor::text as physical from fintrack.account_activation_position
    where owner_id = ${ownerId} and account_id = ${accountId}`);
  return { physical: BigInt(row?.physical ?? "0") + BigInt(activation?.physical ?? "0"), external: BigInt(row?.external ?? "0") };
}

async function legTotals(tx: OwnerTx, ownerId: string, accountId: string, boundary: Boundary, excludeSettlementId?: string) {
  // IS DISTINCT FROM keeps rows whose source is NULL (three-valued logic).
  const exclude = excludeSettlementId
    ? sql`and (e.source_type is distinct from 'SETTLEMENT' or e.source_id is distinct from ${excludeSettlementId}::uuid)`
    : sql``;
  const [row] = await tx.execute<{ physical: string; external: string }>(sql`
    select coalesce(sum(l.physical_effect_minor), 0)::text as physical, coalesce(sum(l.external_effect_minor), 0)::text as external
    from fintrack.ledger_leg l join fintrack.ledger_entry e on e.id = l.entry_id
    where e.owner_id = ${ownerId} and l.owner_id = ${ownerId} and l.account_id = ${accountId} and ${included(boundary)} ${exclude}`);
  return { physical: BigInt(row.physical), external: BigInt(row.external) };
}

/**
 * Personal effect per entry on the settlement pool. Summing an entry across
 * DANA and Tunai makes an internal DANA ↔ Tunai transfer net to zero, so it is
 * neither a transfer in nor out (PRD v0.19).
 */
async function flowRows(tx: OwnerTx, ownerId: string, accountIds: string[], from: Boundary, to: Boundary) {
  const pool = sql.join(accountIds.map((id) => sql`${id}::uuid`), sql`, `);
  return tx.execute<{ kind: string; event_class: string; reporting_classification: string | null; correction_role: string | null; personal: string }>(sql`
    select e.kind, e.event_class, e.reporting_classification, e.correction_role,
           sum(l.physical_effect_minor - l.external_effect_minor)::text as personal
    from fintrack.ledger_leg l join fintrack.ledger_entry e on e.id = l.entry_id
    where e.owner_id = ${ownerId} and l.owner_id = ${ownerId} and l.account_id in (${pool})
      and e.event_class <> 'LIVING' and ${included(to)} and not ${included(from)}
    group by e.id, e.kind, e.event_class, e.reporting_classification, e.correction_role`);
}

/** Tunai joins the pool for periods that start after the settlement that activated it (PRD v0.19). */
async function poolCash(tx: OwnerTx, ownerId: string, accountId: string, openingDate: string): Promise<AccountRow | null> {
  const member = await cashMemberOf(tx, ownerId, accountId);
  return member && businessDateOf(member.activationCutoverAt) <= openingDate ? member : null;
}

export type ConfirmationRow = typeof balanceConfirmation.$inferSelect;

/** Latest non-superseded confirmation in a replacement chain. */
export async function authoritativeConfirmation(tx: OwnerTx, ownerId: string, confirmationId: string): Promise<ConfirmationRow> {
  let [row] = await tx.select().from(balanceConfirmation).where(and(eq(balanceConfirmation.ownerId, ownerId), eq(balanceConfirmation.id, confirmationId)));
  while (row?.supersededById) {
    [row] = await tx.select().from(balanceConfirmation).where(and(eq(balanceConfirmation.ownerId, ownerId), eq(balanceConfirmation.id, row.supersededById)));
  }
  if (!row) throw new ApiError("NOT_FOUND");
  return row;
}

type SettlementRow = typeof settlement.$inferSelect;

async function openingBoundary(tx: OwnerTx, ownerId: string, row: Pick<SettlementRow, "accountId" | "startDate">) {
  const [previous] = await tx
    .select()
    .from(settlement)
    .where(and(eq(settlement.ownerId, ownerId), eq(settlement.accountId, row.accountId), eq(settlement.status, "SETTLED"), eq(settlement.endDate, addDays(row.startDate, -1))));
  if (previous) {
    const [original] = await tx.select().from(balanceConfirmation).where(eq(balanceConfirmation.id, previous.closingConfirmationId!));
    return { boundary: { date: previous.endDate, recordedAt: original.recordedAt }, incomeThrough: previous.endDate };
  }
  const [acc] = await tx.select().from(account).where(and(eq(account.ownerId, ownerId), eq(account.id, row.accountId)));
  return {
    boundary: { date: businessDateOf(acc.activationCutoverAt), recordedAt: acc.activationCutoverAt },
    incomeThrough: addDays(row.startDate, -1),
  };
}

/** Tunai's part of the living contribution keeps its calculated balance equal to the wallet count. */
export type CashShare = { accountId: string; residual: MinorUnits };
export type SettlementComputation = { reconstruction: Reconstruction; income: DailyIncomeSummary; cash: CashShare | null };

/**
 * Reconstruction for a range. `closingRecordedAt` bounds same-day entries on
 * the end date: a transfer recorded after the closing belongs to the next period.
 */
export async function computeSettlement(
  tx: OwnerTx,
  ownerId: string,
  row: { id?: string; accountId: string; startDate: string; endDate: string },
  closing: { physical: MinorUnits; recordedAt: Date | null; cashPhysical?: MinorUnits | null },
): Promise<SettlementComputation> {
  const rule = await dailyRuleFor(tx, ownerId, row.accountId);
  if (!rule) throw new ApiError("VALIDATION_FAILED", { issues: ["NOT_A_WEEKLY_ACCOUNT"] });
  const opening = await openingBoundary(tx, ownerId, row);
  const closingBoundary = { date: row.endDate, recordedAt: closing.recordedAt ?? FAR_FUTURE };

  const snapshot = await openingPosition(tx, ownerId, row.accountId);
  const before = await legTotals(tx, ownerId, row.accountId, opening.boundary);
  const incomeBefore = await recognizedIncomeFor(tx, ownerId, row.accountId, rule.effectiveStartDate, opening.incomeThrough, rule);
  const openingPersonal = snapshot.physical - snapshot.external + before.physical - before.external + incomeBefore.recognized;

  const cashMember = await poolCash(tx, ownerId, row.accountId, opening.boundary.date);
  const poolIds = cashMember ? [row.accountId, cashMember.id] : [row.accountId];
  const flows = (await flowRows(tx, ownerId, poolIds, opening.boundary, closingBoundary)).map((flow) =>
    classifyFlow(
      { kind: flow.kind, eventClass: flow.event_class, reportingClassification: flow.reporting_classification, correctionRole: flow.correction_role },
      BigInt(flow.personal),
    ),
  );
  const income = await recognizedIncomeFor(tx, ownerId, row.accountId, row.startDate, row.endDate, rule);
  const atClosing = await legTotals(tx, ownerId, row.accountId, closingBoundary, row.id);

  let cash: CashPosition | null = null;
  let cashShare: CashShare | null = null;
  if (cashMember) {
    if (closing.cashPhysical === null || closing.cashPhysical === undefined) {
      throw new ApiError("VALIDATION_FAILED", { issues: ["CASH_CLOSING_REQUIRED"] });
    }
    const cashOpening = await openingPosition(tx, ownerId, cashMember.id);
    const cashBefore = await legTotals(tx, ownerId, cashMember.id, opening.boundary);
    const cashAtClosing = await legTotals(tx, ownerId, cashMember.id, closingBoundary, row.id);
    cash = {
      openingPersonal: cashOpening.physical - cashOpening.external + cashBefore.physical - cashBefore.external,
      closingPhysical: closing.cashPhysical,
      closingExternal: cashOpening.external + cashAtClosing.external,
    };
    const calculatedPersonal = cashOpening.physical - cashOpening.external + cashAtClosing.physical - cashAtClosing.external;
    cashShare = { accountId: cashMember.id, residual: calculatedPersonal - (cash.closingPhysical - cash.closingExternal) };
  }

  const reconstruction = reconstruct({
    openingPersonal,
    income,
    flows,
    settlementDays: daysBetweenInclusive(row.startDate, row.endDate),
    closingPhysical: closing.physical,
    closingExternal: snapshot.external + atClosing.external,
    cash,
  });
  return { reconstruction, income, cash: cashShare };
}

const serialize = (value: Reconstruction) =>
  Object.fromEntries(Object.entries(value).map(([key, v]) => [key, typeof v === "bigint" ? toIdrDecimal(v) : v])) as Record<string, string | number | boolean>;

/** Living contribution per pool account; the parts always add up to the pool's living expense. */
function livingShares(accountId: string, livingExpense: MinorUnits, cash: CashShare | null): [string, MinorUnits][] {
  return cash ? [[accountId, livingExpense - cash.residual], [cash.accountId, cash.residual]] : [[accountId, livingExpense]];
}

async function postLivingDelta(tx: OwnerTx, ownerId: string, row: { id: string; endDate: string }, deltas: [string, MinorUnits][], now: Date) {
  const legs = deltas
    .filter(([, delta]) => delta !== 0n)
    .map(([accountId, delta]) => ({ accountId, physicalEffect: delta, externalEffect: 0n, holdingId: null }));
  if (legs.length === 0) return;
  await postLedgerEntry(
    tx,
    ownerId,
    {
      kind: "SETTLEMENT_LIVING_CONTRIBUTION",
      eventClass: "LIVING",
      effectiveBusinessDate: row.endDate,
      reportingClassification: null,
      sourceType: "SETTLEMENT",
      sourceId: row.id,
      legs,
    },
    { now, cutoverDayAnswer: "NOT_IN_OPENING", skipSettlementResync: true },
  );
}

async function weeklyRoute(tx: OwnerTx, ownerId: string, accountId: string): Promise<Route> {
  return { sourceAccountId: accountId, destinationAccountId: await reserveAccountId(tx, ownerId) };
}

/** Remaining of earlier actionable targets, counting only allocations recorded by `asOf`. */
async function priorOutstandingAt(tx: OwnerTx, ownerId: string, route: Route, beforeOrder: string, asOf: Date): Promise<MinorUnits> {
  let total = 0n;
  for (const target of await routeTargets(tx, ownerId, route)) {
    if (target.contextOrder >= beforeOrder || !target.version?.isActionable) continue;
    const [row] = await tx
      .select({ linked: sql<string>`coalesce(sum(${transferAllocation.sign} * ${transferAllocation.magnitudeMinor}), 0)::text` })
      .from(transferAllocation)
      .where(and(eq(transferAllocation.ownerId, ownerId), eq(transferAllocation.targetId, target.id), lte(transferAllocation.createdAt, asOf)));
    const linked = BigInt(row.linked) < 0n ? 0n : BigInt(row.linked);
    const remaining = target.version.amountMinor - linked;
    total += remaining > 0n ? remaining : 0n;
  }
  return total;
}

export type RouterMode = "NO_WEEKLY_ACCOUNT" | "DRAFT" | "NORMAL" | "OVERDUE" | "INFORMATIONAL";

/** `Update saldo` for DANA always lands here (PRD: settlement router). */
export async function settlementRouter(tx: OwnerTx, ownerId: string, now: Date) {
  const rule = await dailyRuleFor(tx, ownerId);
  if (!rule) return { mode: "NO_WEEKLY_ACCOUNT" as const };
  const [draft] = await tx
    .select({ id: settlement.id })
    .from(settlement)
    .where(and(eq(settlement.ownerId, ownerId), eq(settlement.accountId, rule.accountId), eq(settlement.status, "DRAFT")));
  const today = businessDateOf(now);
  const plan = settlementPlan(rule.effectiveStartDate, await lastSettledEnd(tx, ownerId, rule.accountId), today);
  const mode: Exclude<RouterMode, "NO_WEEKLY_ACCOUNT"> = draft
    ? "DRAFT"
    : plan.status === "DUE"
      ? "NORMAL"
      : plan.status === "OVERDUE"
        ? "OVERDUE"
        : "INFORMATIONAL";
  return { mode, accountId: rule.accountId, draftId: draft?.id ?? null, ...plan, today };
}

const cashFields = {
  /** Wallet count at the same closing, once Tunai is tracked. */
  cashClosingBalance: nonNegativeAmount.optional(),
  /** `Mulai lacak uang tunai`: the wallet count that opens Tunai when this settlement is settled; null clears it. */
  startCashTracking: nonNegativeAmount.nullable().optional(),
};

export const createSettlementSchema = z.object({
  endDate: businessDate,
  closingPhysicalBalance: nonNegativeAmount.optional(),
  closingAt: z.iso.datetime({ offset: true }).optional(),
  ...cashFields,
});

export const updateSettlementSchema = z.object({
  closingPhysicalBalance: nonNegativeAmount,
  closingAt: z.iso.datetime({ offset: true }),
  ...cashFields,
});

function assertClosingTime(endDate: string, closingAt: Date, now: Date) {
  if (businessDateOf(closingAt) !== endDate) throw new ApiError("VALIDATION_FAILED", { issues: ["CLOSING_NOT_ON_END_DATE"] });
  if (closingAt.getTime() > now.getTime() + 60_000) throw new ApiError("VALIDATION_FAILED", { issues: ["CLOSING_IN_FUTURE"] });
}

export async function createSettlementDraft(tx: OwnerTx, ownerId: string, input: z.infer<typeof createSettlementSchema>, now: Date) {
  const router = await settlementRouter(tx, ownerId, now);
  if (router.mode === "NO_WEEKLY_ACCOUNT") throw new ApiError("ONBOARDING_NOT_CONFIRMED");
  if (router.mode === "DRAFT") throw new ApiError("VALIDATION_FAILED", { issues: ["DRAFT_EXISTS"] });
  const issues = settlementRangeIssues(router, input.endDate, router.today);
  if (issues.length > 0) throw new ApiError("VALIDATION_FAILED", { issues });
  const [row] = await tx
    .insert(settlement)
    .values({ ownerId, accountId: router.accountId, startDate: router.periodStart, endDate: input.endDate })
    .returning();
  if (input.closingPhysicalBalance !== undefined && input.closingAt) {
    return updateSettlementDraft(
      tx,
      ownerId,
      row.id,
      {
        closingPhysicalBalance: input.closingPhysicalBalance,
        closingAt: input.closingAt,
        cashClosingBalance: input.cashClosingBalance,
        startCashTracking: input.startCashTracking,
      },
      row.version,
      now,
    );
  }
  return row;
}

async function draftRow(tx: OwnerTx, ownerId: string, id: string, version?: number) {
  const [row] = await tx.select().from(settlement).where(and(eq(settlement.ownerId, ownerId), eq(settlement.id, id))).for("update");
  if (!row) throw new ApiError("NOT_FOUND");
  if (row.status !== "DRAFT") throw new ApiError("VALIDATION_FAILED", { issues: ["SETTLEMENT_IMMUTABLE"] });
  if (version !== undefined && row.version !== version) throw new ApiError("STALE_VERSION");
  return row;
}

export async function updateSettlementDraft(
  tx: OwnerTx,
  ownerId: string,
  id: string,
  input: z.infer<typeof updateSettlementSchema>,
  version: number,
  now: Date,
) {
  const row = await draftRow(tx, ownerId, id, version);
  const closingAt = new Date(input.closingAt);
  assertClosingTime(row.endDate, closingAt, now);
  const tracked = Boolean(await cashMemberOf(tx, ownerId, row.accountId));
  if (tracked && input.startCashTracking !== undefined && input.startCashTracking !== null) {
    throw new ApiError("VALIDATION_FAILED", { issues: ["CASH_ALREADY_TRACKED"] });
  }
  if (!tracked && input.cashClosingBalance !== undefined) throw new ApiError("VALIDATION_FAILED", { issues: ["CASH_NOT_TRACKED"] });
  const cash = {
    cashClosingPhysicalMinor: tracked && input.cashClosingBalance !== undefined ? parseIdrDecimal(input.cashClosingBalance) : row.cashClosingPhysicalMinor,
    cashActivationMinor:
      input.startCashTracking === undefined ? row.cashActivationMinor : input.startCashTracking === null ? null : parseIdrDecimal(input.startCashTracking),
  };
  const [updated] = await tx
    .update(settlement)
    .set({ closingPhysicalMinor: parseIdrDecimal(input.closingPhysicalBalance), closingAt, ...cash, version: row.version + 1, updatedAt: now })
    .where(and(eq(settlement.ownerId, ownerId), eq(settlement.id, id)))
    .returning();
  return updated;
}

export async function deleteSettlementDraft(tx: OwnerTx, ownerId: string, id: string): Promise<void> {
  await draftRow(tx, ownerId, id);
  await tx.delete(settlement).where(and(eq(settlement.ownerId, ownerId), eq(settlement.id, id)));
}

/**
 * Confirms closing and reconstruction: the settlement becomes SETTLED and
 * immutable, one aggregate living contribution is posted, the closing becomes
 * a balance confirmation, and a new DANA → reserve target is frozen after
 * subtracting prior outstanding. Transfer fulfillment is not required.
 */
export async function settle(tx: OwnerTx, ownerId: string, id: string, version: number, now: Date) {
  await lockLedger(tx, ownerId);
  const row = await draftRow(tx, ownerId, id, version);
  if (row.closingPhysicalMinor === null || !row.closingAt) throw new ApiError("VALIDATION_FAILED", { issues: ["CLOSING_REQUIRED"] });
  if (row.endDate > businessDateOf(now)) throw new ApiError("VALIDATION_FAILED", { issues: ["END_IN_FUTURE"] });

  const { reconstruction, income, cash } = await computeSettlement(tx, ownerId, row, {
    physical: row.closingPhysicalMinor,
    recordedAt: null,
    cashPhysical: row.cashClosingPhysicalMinor,
  });
  const [confirmation] = await tx
    .insert(balanceConfirmation)
    .values({ ownerId, accountId: row.accountId, physicalBalanceMinor: row.closingPhysicalMinor, asOf: row.closingAt, source: "SETTLEMENT" })
    .returning();
  const [cashConfirmation] = cash
    ? await tx
        .insert(balanceConfirmation)
        .values({ ownerId, accountId: cash.accountId, physicalBalanceMinor: row.cashClosingPhysicalMinor!, asOf: row.closingAt, source: "SETTLEMENT" })
        .returning()
    : [];

  await postLivingDelta(tx, ownerId, row, livingShares(row.accountId, reconstruction.livingExpense, cash).map(([accountId, share]) => [accountId, -share]), now);

  // `Mulai lacak uang tunai`: Tunai opens at this closing and joins the pool from the next period.
  let cashAccountId: string | null = null;
  if (row.cashActivationMinor !== null) {
    if (await cashMemberOf(tx, ownerId, row.accountId)) throw new ApiError("VALIDATION_FAILED", { issues: ["CASH_ALREADY_TRACKED"] });
    const [{ next }] = await tx.execute<{ next: number }>(sql`
      select coalesce(max(sort_order), 0) + 1 as next from fintrack.account where owner_id = ${ownerId}`);
    const [created] = await tx
      .insert(account)
      .values({
        ownerId,
        displayName: "Tunai",
        providerName: "Tunai",
        accountType: "CASH",
        purposeLabel: "Daily",
        isCashAccount: true,
        sortOrder: Number(next),
        activationCutoverAt: row.closingAt,
        settlementAccountId: row.accountId,
      })
      .returning({ id: account.id });
    await tx.insert(accountActivationPosition).values({ ownerId, accountId: created.id, physicalBalanceMinor: row.cashActivationMinor });
    cashAccountId = created.id;
  }

  const route = await weeklyRoute(tx, ownerId, row.accountId);
  const prior = await priorOutstandingAt(tx, ownerId, route, row.endDate, FAR_FUTURE);
  const targetAmount = reconstruction.closingPersonal - prior > 0n ? reconstruction.closingPersonal - prior : 0n;
  const targetId = await ensureTarget(tx, ownerId, { contextType: "DANA_SETTLEMENT", contextKey: row.id, contextOrder: row.endDate }, route);
  await createTargetVersion(tx, ownerId, targetId, {
    amount: targetAmount,
    basis: { closingPersonal: toIdrDecimal(reconstruction.closingPersonal), priorOutstanding: toIdrDecimal(prior), settlementId: row.id },
    isActionable: true,
  });

  const snapshot = {
    ...serialize(reconstruction),
    priorOutstanding: toIdrDecimal(prior),
    initialTarget: toIdrDecimal(targetAmount),
    days: income.days.map((day) => ({ date: day.date, state: day.state, amount: toIdrDecimal(day.amount), overridden: day.overridden })),
    closingAt: row.closingAt.toISOString(),
    ...(cashAccountId ? { cashActivated: toIdrDecimal(row.cashActivationMinor!) } : {}),
  };
  await tx
    .update(settlement)
    .set({
      status: "SETTLED",
      closingConfirmationId: confirmation.id,
      cashClosingConfirmationId: cashConfirmation?.id ?? null,
      livingExpenseMinor: reconstruction.livingExpense,
      snapshot,
      settledAt: now,
      updatedAt: now,
    })
    .where(and(eq(settlement.ownerId, ownerId), eq(settlement.id, id)));
  return { id, targetId, snapshot };
}

async function ownLivingEffect(tx: OwnerTx, ownerId: string, settlementId: string, accountId: string): Promise<MinorUnits> {
  const [row] = await tx.execute<{ total: string }>(sql`
    select coalesce(sum(l.physical_effect_minor), 0)::text as total
    from fintrack.ledger_leg l join fintrack.ledger_entry e on e.id = l.entry_id
    where e.owner_id = ${ownerId} and e.source_type = 'SETTLEMENT' and e.source_id = ${settlementId}::uuid
      and l.account_id = ${accountId}::uuid`);
  return BigInt(row.total);
}

/**
 * Corrected living expense of settled settlements in one query. Every change to
 * settled history resynchronizes the posted living contributions (see
 * resyncSettlements), so their sum always equals the corrected reconstruction.
 */
export async function correctedLivingExpenses(tx: OwnerTx, ownerId: string): Promise<Map<string, MinorUnits>> {
  const rows = await tx.execute<{ settlement_id: string; living: string }>(sql`
    select e.source_id as settlement_id, (-coalesce(sum(l.physical_effect_minor), 0))::text as living
    from fintrack.ledger_entry e join fintrack.ledger_leg l on l.entry_id = e.id
    where e.owner_id = ${ownerId} and e.source_type = 'SETTLEMENT' and e.event_class = 'LIVING'
    group by e.source_id`);
  return new Map(rows.map((row) => [row.settlement_id, BigInt(row.living)]));
}

/** Corrected view of a settled settlement: same range and days, corrected ledger, authoritative closing. */
export async function correctedComputation(tx: OwnerTx, ownerId: string, row: SettlementRow): Promise<SettlementComputation> {
  const [original] = await tx.select().from(balanceConfirmation).where(eq(balanceConfirmation.id, row.closingConfirmationId!));
  const authoritative = await authoritativeConfirmation(tx, ownerId, original.id);
  const cash = row.cashClosingConfirmationId ? await authoritativeConfirmation(tx, ownerId, row.cashClosingConfirmationId) : null;
  return computeSettlement(tx, ownerId, row, {
    physical: authoritative.physicalBalanceMinor,
    recordedAt: original.recordedAt,
    cashPhysical: cash?.physicalBalanceMinor ?? null,
  });
}

/**
 * Keeps each settled period anchored to its authoritative closing after any
 * change to settled history: the difference between the corrected and the
 * posted living contribution is posted as a derived settlement correction
 * effect, and DANA targets are re-versioned chronologically when their basis
 * changes. As-settled snapshots are never touched.
 */
export async function resyncSettlements(tx: OwnerTx, ownerId: string, poolAccountId: string, fromDate: string, now: Date): Promise<void> {
  // A Tunai record resynchronizes the DANA settlements that cover it.
  const accountId = (await settlementAccountFor(tx, ownerId, poolAccountId)) ?? poolAccountId;
  const rows = await tx
    .select()
    .from(settlement)
    .where(and(eq(settlement.ownerId, ownerId), eq(settlement.accountId, accountId), eq(settlement.status, "SETTLED"), gte(settlement.endDate, fromDate)))
    .orderBy(asc(settlement.startDate));
  if (rows.length === 0) return;
  const route = await weeklyRoute(tx, ownerId, accountId);

  for (const row of rows) {
    const { reconstruction, cash } = await correctedComputation(tx, ownerId, row);
    const deltas: [string, MinorUnits][] = [];
    for (const [shareAccountId, share] of livingShares(accountId, reconstruction.livingExpense, cash)) {
      deltas.push([shareAccountId, -share - (await ownLivingEffect(tx, ownerId, row.id, shareAccountId))]);
    }
    await postLivingDelta(tx, ownerId, row, deltas, now);

    const targetId = await ensureTarget(tx, ownerId, { contextType: "DANA_SETTLEMENT", contextKey: row.id, contextOrder: row.endDate }, route);
    const version = await currentVersion(tx, ownerId, targetId);
    if (!version?.isActionable) continue;
    const firstFrozen = (await firstVersionTime(tx, ownerId, targetId)) ?? FAR_FUTURE;
    const prior = await priorOutstandingAt(tx, ownerId, route, row.endDate, firstFrozen);
    const amount = reconstruction.closingPersonal - prior > 0n ? reconstruction.closingPersonal - prior : 0n;
    if (amount !== version.amountMinor) {
      await createTargetVersion(tx, ownerId, targetId, {
        amount,
        basis: { closingPersonal: toIdrDecimal(reconstruction.closingPersonal), priorOutstanding: toIdrDecimal(prior), settlementId: row.id, recalculated: true },
        isActionable: true,
      });
    }
  }
}

async function firstVersionTime(tx: OwnerTx, ownerId: string, targetId: string): Promise<Date | null> {
  const [row] = await tx.execute<{ created_at: string | null }>(sql`
    select to_char(min(created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
    from fintrack.transfer_target_version where owner_id = ${ownerId} and target_id = ${targetId}::uuid`);
  return row?.created_at ? new Date(row.created_at) : null;
}

export const replaceClosingSchema = z
  .object({ closingPhysicalBalance: nonNegativeAmount.optional(), closingCashBalance: nonNegativeAmount.optional() })
  .refine((value) => value.closingPhysicalBalance !== undefined || value.closingCashBalance !== undefined, "nothing to replace");

async function replaceConfirmationValue(tx: OwnerTx, ownerId: string, confirmationId: string, physical: MinorUnits): Promise<string | null> {
  const current = await authoritativeConfirmation(tx, ownerId, confirmationId);
  if (physical === current.physicalBalanceMinor) return null;
  const replacementId = crypto.randomUUID();
  await tx.update(balanceConfirmation).set({ supersededById: replacementId }).where(eq(balanceConfirmation.id, current.id));
  await tx.insert(balanceConfirmation).values({
    id: replacementId,
    ownerId,
    accountId: current.accountId,
    physicalBalanceMinor: physical,
    asOf: current.asOf,
    source: "SETTLEMENT",
    supersedesId: current.id,
  });
  return replacementId;
}

/**
 * Corrects a mistyped closing balance with a replacement confirmation. The
 * settlement and its as-settled snapshot stay; corrected views follow the new
 * authoritative closing, and later periods are resynchronized.
 */
export async function replaceSettlementClosing(tx: OwnerTx, ownerId: string, id: string, input: z.infer<typeof replaceClosingSchema>, now: Date) {
  await lockLedger(tx, ownerId);
  const [row] = await tx.select().from(settlement).where(and(eq(settlement.ownerId, ownerId), eq(settlement.id, id)));
  if (!row || row.status !== "SETTLED") throw new ApiError("NOT_FOUND");
  if (input.closingCashBalance !== undefined && !row.cashClosingConfirmationId) throw new ApiError("VALIDATION_FAILED", { issues: ["CASH_NOT_TRACKED"] });
  const replaced = [
    input.closingPhysicalBalance === undefined
      ? null
      : await replaceConfirmationValue(tx, ownerId, row.closingConfirmationId!, parseIdrDecimal(input.closingPhysicalBalance)),
    input.closingCashBalance === undefined
      ? null
      : await replaceConfirmationValue(tx, ownerId, row.cashClosingConfirmationId!, parseIdrDecimal(input.closingCashBalance)),
  ];
  if (replaced.every((value) => value === null)) throw new ApiError("VALIDATION_FAILED", { issues: ["NO_CHANGE"] });
  await resyncSettlements(tx, ownerId, row.accountId, row.endDate, now);
  return { confirmationId: replaced[0], cashConfirmationId: replaced[1] };
}

export type SettlementView = {
  id: string;
  accountId: string;
  startDate: string;
  endDate: string;
  status: string;
  version: number;
  closingPhysicalBalance: string | null;
  closingAt: string | null;
  nonstandard: boolean;
  /** Tunai in this settlement: tracked (wallet count required), or offered for activation. */
  cash: { tracked: boolean; canStart: boolean; closingPhysicalBalance: string | null; startTracking: string | null };
  preview: Record<string, string | number | boolean> | null;
  asSettled: Record<string, unknown> | null;
  corrected: Record<string, string | number | boolean> | null;
  hasCorrections: boolean;
  warnings: string[];
};

function warningsOf(reconstruction: Reconstruction): string[] {
  const warnings: string[] = [];
  // PRD OD-6: negative living expense is allowed but always explained.
  if (reconstruction.livingExpense < 0n) warnings.push("UNRECORDED_INCOME");
  if (reconstruction.closingPersonal < 0n || reconstruction.cashClosingPersonal < 0n) warnings.push("EXTERNAL_FUND_SHORTFALL");
  return warnings;
}

export async function settlementView(tx: OwnerTx, ownerId: string, id: string): Promise<SettlementView> {
  const [row] = await tx.select().from(settlement).where(and(eq(settlement.ownerId, ownerId), eq(settlement.id, id)));
  if (!row) throw new ApiError("NOT_FOUND");
  const base = {
    id: row.id,
    accountId: row.accountId,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status,
    version: row.version,
    closingAt: row.closingAt?.toISOString() ?? null,
    nonstandard: daysBetweenInclusive(row.startDate, row.endDate) !== 7,
  };
  const amount = (value: MinorUnits | null) => (value === null ? null : toIdrDecimal(value));
  if (row.status === "DRAFT") {
    const member = await cashMemberOf(tx, ownerId, row.accountId);
    const waitingForCash = Boolean(member) && row.cashClosingPhysicalMinor === null;
    const preview =
      row.closingPhysicalMinor === null || waitingForCash
        ? null
        : (await computeSettlement(tx, ownerId, row, { physical: row.closingPhysicalMinor, recordedAt: null, cashPhysical: row.cashClosingPhysicalMinor }))
            .reconstruction;
    return {
      ...base,
      closingPhysicalBalance: amount(row.closingPhysicalMinor),
      cash: { tracked: Boolean(member), canStart: !member, closingPhysicalBalance: amount(row.cashClosingPhysicalMinor), startTracking: amount(row.cashActivationMinor) },
      preview: preview && serialize(preview),
      asSettled: null,
      corrected: null,
      hasCorrections: false,
      warnings: preview ? warningsOf(preview) : [],
    };
  }
  const corrected = (await correctedComputation(tx, ownerId, row)).reconstruction;
  const asSettled = row.snapshot as Record<string, unknown>;
  return {
    ...base,
    closingPhysicalBalance: toIdrDecimal(row.closingPhysicalMinor!),
    cash: {
      tracked: corrected.cashTracked,
      canStart: false,
      closingPhysicalBalance: corrected.cashTracked ? toIdrDecimal(corrected.cashClosingPhysical) : null,
      startTracking: amount(row.cashActivationMinor),
    },
    preview: null,
    asSettled,
    corrected: serialize(corrected),
    hasCorrections:
      toIdrDecimal(corrected.livingExpense) !== asSettled.livingExpense ||
      toIdrDecimal(corrected.closingPhysical) !== asSettled.closingPhysical ||
      (corrected.cashTracked && toIdrDecimal(corrected.cashClosingPhysical) !== asSettled.cashClosingPhysical),
    warnings: warningsOf(corrected),
  };
}

export async function listSettlements(tx: OwnerTx, ownerId: string) {
  const rows = await tx.select().from(settlement).where(eq(settlement.ownerId, ownerId)).orderBy(asc(settlement.startDate));
  return rows.map((row) => ({
    id: row.id,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status,
    livingExpense: row.livingExpenseMinor === null ? null : toIdrDecimal(row.livingExpenseMinor),
    averagePerDay: (row.snapshot as { averagePerDay?: string } | null)?.averagePerDay ?? null,
    settlementDays: daysBetweenInclusive(row.startDate, row.endDate),
  }));
}

/**
 * A record is settled history when it is included as of the latest settled
 * closing of its weekly account: dated before that closing's end date, or on
 * it and recorded before the closing. A transfer recorded after a Sunday
 * closing therefore belongs to the next period until that one is settled.
 */
export async function settledSettlementForRecord(
  tx: OwnerTx,
  ownerId: string,
  accountIds: string[],
  date: string,
  recordedAt: Date,
): Promise<{ id: string; accountId: string } | null> {
  const settlementAccounts = new Set<string>();
  for (const id of accountIds) settlementAccounts.add((await settlementAccountFor(tx, ownerId, id)) ?? id);
  for (const accountId of settlementAccounts) {
    const [latest] = await tx
      .select()
      .from(settlement)
      .where(and(eq(settlement.ownerId, ownerId), eq(settlement.accountId, accountId), eq(settlement.status, "SETTLED")))
      .orderBy(sql`${settlement.endDate} desc`)
      .limit(1);
    if (!latest) continue;
    const [original] = await tx.select().from(balanceConfirmation).where(eq(balanceConfirmation.id, latest.closingConfirmationId!));
    if (date < latest.endDate || (date === latest.endDate && recordedAt.getTime() <= original.recordedAt.getTime())) {
      return { id: latest.id, accountId };
    }
  }
  return null;
}
