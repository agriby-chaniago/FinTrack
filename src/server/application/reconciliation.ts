// Balance confirmation and reconciliation for accounts outside weekly settlement
// (PRD: Correction dan reconciliation, Cadence reconciliation). Physical-first:
// the confirmation stores only the provider balance; ownership comes from the ledger.
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { addDays, businessDateOf, cycleKeyOf } from "@/lib/business-time";
import { parseIdrDecimal, toIdrDecimal, type MinorUnits } from "@/lib/money";
import { ApiError } from "@/server/api/errors";
import { nonNegativeAmount, note } from "@/server/api/schemas";
import type { OwnerTx } from "@/server/db/owner";
import { balanceConfirmation } from "@/server/db/schema/settlement";
import { lastDayOfCycle } from "@/server/domain/monthly";

import { requireActiveCashAccounts, weeklySettlementAccountIds } from "./accounts";
import { lockLedger, postLedgerEntry } from "./ledger";
import type { CycleView } from "./monthly";
import { sqlRows } from "@/server/db/rows";

export type Position = { physical: MinorUnits; external: MinorUnits };

type ConfirmationRow = typeof balanceConfirmation.$inferSelect;
type PositionAt = Position & { movedAfter: number };

/**
 * Calculated position as of each confirmation, in one query (PRD v0.18
 * inclusion rule): entries dated before the confirmation's business date, or
 * on it and recorded before the confirmation. A BALANCE_ADJUSTMENT made for a
 * confirmation always counts toward it. `movedAfter` counts later movements.
 */
async function positionsAtConfirmations(tx: OwnerTx, ownerId: string, confirmations: ConfirmationRow[]): Promise<Map<string, PositionAt>> {
  if (confirmations.length === 0) return new Map();
  const values = sql.join(
    confirmations.map(
      (c) => sql`(${c.id}::uuid, ${c.accountId}::uuid, ${businessDateOf(c.asOf)}::date, ${c.recordedAt.toISOString()}::timestamptz)`,
    ),
    sql`, `,
  );
  const rows = await sqlRows<{ id: string; physical: string; external: string; opening_physical: string; opening_external: string; moved_after: number }>(tx, sql`
    with c(id, account_id, day, recorded_at) as (values ${values}),
    snapshot as (
      select id from fintrack.onboarding_snapshot
      where owner_id = ${ownerId} and status = 'CONFIRMED' and superseded_by_id is null
    )
    select c.id,
      coalesce((select sum(l.physical_effect_minor) from fintrack.ledger_leg l join fintrack.ledger_entry e on e.id = l.entry_id
        where e.owner_id = ${ownerId} and l.account_id = c.account_id
          and (e.effective_business_date < c.day
               or (e.effective_business_date = c.day and e.recorded_at <= c.recorded_at)
               or (e.source_type = 'BALANCE_CONFIRMATION' and e.source_id = c.id))), 0)::text as physical,
      coalesce((select sum(l.external_effect_minor) from fintrack.ledger_leg l join fintrack.ledger_entry e on e.id = l.entry_id
        where e.owner_id = ${ownerId} and l.account_id = c.account_id
          and (e.effective_business_date < c.day
               or (e.effective_business_date = c.day and e.recorded_at <= c.recorded_at))), 0)::text as external,
      (coalesce((select sum(p.physical_balance_minor) from fintrack.opening_account_position p
          where p.snapshot_id = (select id from snapshot) and p.account_id = c.account_id), 0)
        + coalesce((select a.physical_balance_minor from fintrack.account_activation_position a
          where a.owner_id = ${ownerId} and a.account_id = c.account_id), 0))::text as opening_physical,
      coalesce((select sum(x.amount_minor) from fintrack.opening_external_position x
        where x.snapshot_id = (select id from snapshot) and x.account_id = c.account_id), 0)::text as opening_external,
      (select count(*)::int from fintrack.ledger_leg l join fintrack.ledger_entry e on e.id = l.entry_id
        where e.owner_id = ${ownerId} and l.account_id = c.account_id
          and (e.source_type is distinct from 'BALANCE_CONFIRMATION' or e.source_id is distinct from c.id)
          and (e.effective_business_date > c.day
               or (e.effective_business_date = c.day and e.recorded_at > c.recorded_at))) as moved_after
    from c`);
  return new Map(
    rows.map((row) => [
      row.id,
      {
        physical: BigInt(row.opening_physical) + BigInt(row.physical),
        external: BigInt(row.opening_external) + BigInt(row.external),
        movedAfter: row.moved_after,
      },
    ]),
  );
}

async function positionAtConfirmation(tx: OwnerTx, ownerId: string, confirmation: ConfirmationRow): Promise<Position> {
  return (await positionsAtConfirmations(tx, ownerId, [confirmation])).get(confirmation.id)!;
}

export type ReconciliationStatus = "MATCHED" | "DISCREPANCY" | "NEEDS_REVIEW";

export type ReconciliationView = {
  confirmationId: string;
  accountId: string;
  asOf: string;
  confirmedPhysical: string;
  calculatedPhysical: string;
  /** Confirmed physical − calculated physical at the same confirmation time. */
  discrepancy: string;
  externalOutstanding: string;
  confirmedPersonal: string;
  status: ReconciliationStatus;
  adjustments: { entryId: string; amount: string; confirmationId: string; reason: string | null; fromSupersededConfirmation: boolean }[];
};

/** Latest authoritative (not superseded) confirmation per account, in one query. */
export async function latestConfirmations(tx: OwnerTx, ownerId: string, accountIds: string[]): Promise<Map<string, ConfirmationRow>> {
  if (accountIds.length === 0) return new Map();
  const rows = await tx
    .selectDistinctOn([balanceConfirmation.accountId])
    .from(balanceConfirmation)
    .where(and(eq(balanceConfirmation.ownerId, ownerId), inArray(balanceConfirmation.accountId, accountIds), isNull(balanceConfirmation.supersededById)))
    .orderBy(balanceConfirmation.accountId, desc(balanceConfirmation.asOf), desc(balanceConfirmation.recordedAt));
  return new Map(rows.map((row) => [row.accountId, row]));
}

export async function latestConfirmation(tx: OwnerTx, ownerId: string, accountId: string) {
  return (await latestConfirmations(tx, ownerId, [accountId])).get(accountId);
}

/** Reconciliation of the latest authoritative confirmation of an account. */
export async function reconciliationView(tx: OwnerTx, ownerId: string, accountId: string): Promise<ReconciliationView | null> {
  const confirmation = await latestConfirmation(tx, ownerId, accountId);
  if (!confirmation || confirmation.source !== "MANUAL") return null;
  const position = await positionAtConfirmation(tx, ownerId, confirmation);
  const discrepancy = confirmation.physicalBalanceMinor - position.physical;

  const adjustments = await sqlRows<{ id: string; amount: string; confirmation_id: string; note: string | null; superseded: boolean }>(tx, sql`
    select e.id, sum(l.physical_effect_minor)::text as amount, e.source_id as confirmation_id, e.note,
           c.superseded_by_id is not null as superseded
    from fintrack.ledger_entry e join fintrack.ledger_leg l on l.entry_id = e.id
    join fintrack.balance_confirmation c on c.id = e.source_id
    where e.owner_id = ${ownerId} and e.kind = 'BALANCE_ADJUSTMENT' and l.account_id = ${accountId}
    group by e.id, c.superseded_by_id order by e.recorded_at`);

  // An adjustment made for a confirmation that was later replaced needs review (PRD).
  const needsReview = adjustments.some((row) => row.superseded);
  return {
    confirmationId: confirmation.id,
    accountId,
    asOf: confirmation.asOf.toISOString(),
    confirmedPhysical: toIdrDecimal(confirmation.physicalBalanceMinor),
    calculatedPhysical: toIdrDecimal(position.physical),
    discrepancy: toIdrDecimal(discrepancy),
    externalOutstanding: toIdrDecimal(position.external),
    confirmedPersonal: toIdrDecimal(confirmation.physicalBalanceMinor - position.external),
    status: discrepancy !== 0n ? "DISCREPANCY" : needsReview ? "NEEDS_REVIEW" : "MATCHED",
    adjustments: adjustments.map((row) => ({
      entryId: row.id,
      amount: toIdrDecimal(BigInt(row.amount)),
      confirmationId: row.confirmation_id,
      reason: row.note,
      fromSupersededConfirmation: row.superseded,
    })),
  };
}

export const confirmationSchema = z.object({
  accountId: z.uuid(),
  physicalBalance: nonNegativeAmount,
  asOf: z.iso.datetime({ offset: true }).optional(),
});

async function assertNotWeekly(tx: OwnerTx, ownerId: string, accountId: string) {
  // DANA is confirmed only through weekly settlement (PRD: settlement router).
  if ((await weeklySettlementAccountIds(tx, ownerId)).has(accountId)) {
    throw new ApiError("VALIDATION_FAILED", { issues: ["USE_SETTLEMENT_FOR_WEEKLY_ACCOUNT"] });
  }
}

/** Records the provider's physical balance; it never overwrites history or creates an adjustment. */
export async function confirmBalance(tx: OwnerTx, ownerId: string, input: z.infer<typeof confirmationSchema>, now: Date) {
  await requireActiveCashAccounts(tx, ownerId, [input.accountId]);
  await assertNotWeekly(tx, ownerId, input.accountId);
  const asOf = input.asOf ? new Date(input.asOf) : now;
  if (asOf.getTime() > now.getTime() + 60_000) throw new ApiError("VALIDATION_FAILED", { issues: ["AS_OF_IN_FUTURE"] });
  await lockLedger(tx, ownerId);
  await tx.insert(balanceConfirmation).values({
    ownerId,
    accountId: input.accountId,
    physicalBalanceMinor: parseIdrDecimal(input.physicalBalance),
    asOf,
    source: "MANUAL",
  });
  return reconciliationView(tx, ownerId, input.accountId);
}

export const replacementSchema = z.object({ physicalBalance: nonNegativeAmount });

/** Typo fix: a replacement confirmation supersedes the old one, which stays for audit. */
export async function replaceConfirmation(tx: OwnerTx, ownerId: string, confirmationId: string, input: z.infer<typeof replacementSchema>) {
  await lockLedger(tx, ownerId);
  const [current] = await tx
    .select()
    .from(balanceConfirmation)
    .where(and(eq(balanceConfirmation.ownerId, ownerId), eq(balanceConfirmation.id, confirmationId), isNull(balanceConfirmation.supersededById)));
  if (!current || current.source !== "MANUAL") throw new ApiError("NOT_FOUND");
  const physical = parseIdrDecimal(input.physicalBalance);
  if (physical === current.physicalBalanceMinor) throw new ApiError("VALIDATION_FAILED", { issues: ["NO_CHANGE"] });
  const id = crypto.randomUUID();
  await tx.update(balanceConfirmation).set({ supersededById: id }).where(eq(balanceConfirmation.id, current.id));
  await tx.insert(balanceConfirmation).values({
    id,
    ownerId,
    accountId: current.accountId,
    physicalBalanceMinor: physical,
    asOf: current.asOf,
    source: "MANUAL",
    supersedesId: current.id,
  });
  return reconciliationView(tx, ownerId, current.accountId);
}

export const adjustmentSchema = z.object({
  balanceConfirmationId: z.uuid(),
  reason: z.literal("UNKNOWN_DISCREPANCY"),
  note,
});

/**
 * Explicit `BALANCE_ADJUSTMENT` for an unknown discrepancy: equal to the
 * confirmed physical discrepancy, personal only, referencing the confirmation,
 * and never income, expense, transfer, or ownership.
 */
export async function adjustBalance(tx: OwnerTx, ownerId: string, input: z.infer<typeof adjustmentSchema>, now: Date) {
  await lockLedger(tx, ownerId);
  const [confirmation] = await tx
    .select()
    .from(balanceConfirmation)
    .where(and(eq(balanceConfirmation.ownerId, ownerId), eq(balanceConfirmation.id, input.balanceConfirmationId), isNull(balanceConfirmation.supersededById)));
  if (!confirmation || confirmation.source !== "MANUAL") throw new ApiError("NOT_FOUND");
  await assertNotWeekly(tx, ownerId, confirmation.accountId);
  const position = await positionAtConfirmation(tx, ownerId, confirmation);
  const discrepancy = confirmation.physicalBalanceMinor - position.physical;
  if (discrepancy === 0n) throw new ApiError("VALIDATION_FAILED", { issues: ["NO_DISCREPANCY"] });

  const posted = await postLedgerEntry(
    tx,
    ownerId,
    {
      kind: "BALANCE_ADJUSTMENT",
      eventClass: "ADJUSTMENT",
      effectiveBusinessDate: businessDateOf(confirmation.asOf),
      reportingClassification: null,
      sourceType: "BALANCE_CONFIRMATION",
      sourceId: confirmation.id,
      legs: [{ accountId: confirmation.accountId, physicalEffect: discrepancy, externalEffect: 0n, holdingId: null }],
    },
    { now, note: input.note ? `${input.reason}: ${input.note}` : input.reason, cutoverDayAnswer: "NOT_IN_OPENING" },
  );
  return { entry: posted, reconciliation: await reconciliationView(tx, ownerId, confirmation.accountId) };
}

export type ReconciliationPrompt = { accountId: string; reason: "BCA_CYCLE_COMPLETE" | "MONTH_END"; cycleKey: string | null; dueSince: string };

/**
 * Soft monthly prompts for the reserve and monthly accounts (PRD): after the
 * latest BCA cycle and its transfer context finish (or once the next cycle
 * opens with the target still incomplete), and at month end when no BCA
 * cycle is active. A later manual confirmation satisfies the prompt.
 */
export async function reconciliationPrompts(
  tx: OwnerTx,
  ownerId: string,
  now: Date,
  loaded: { cycles?: CycleView[] } = {},
): Promise<ReconciliationPrompt[]> {
  const today = businessDateOf(now);
  const { reserveAccountId } = await import("./transfers");
  const { listMonthlyCycles } = await import("./monthly");
  let reserve: string;
  try {
    reserve = await reserveAccountId(tx, ownerId);
  } catch {
    return [];
  }
  const cycles = loaded.cycles ?? (await listMonthlyCycles(tx, ownerId, now));
  const prompts: ReconciliationPrompt[] = [];

  let due: { reason: ReconciliationPrompt["reason"]; cycleKey: string | null; since: string; accounts: string[] } | null = null;
  const currentCycle = cycleKeyOf(today);
  // Cycles are newest first: the first finished (or superseded by an opened month) one is the latest context.
  for (const cycle of cycles) {
    const finished = cycle.state === "COMPLETE" || cycle.state === "CLOSED_NO_INCOME";
    const nextOpened = cycle.cycleKey < currentCycle;
    if (!finished && !nextOpened) continue;
    const actualDates = [cycle.income?.actual?.date, ...cycle.obligations.map((o) => o.actual?.date)].filter((d): d is string => Boolean(d));
    const monthAfter = addDays(`${cycle.cycleKey}-${String(lastDayOfCycle(cycle.cycleKey)).padStart(2, "0")}`, 1);
    const since = finished ? (actualDates.sort().at(-1) ?? `${cycle.cycleKey}-01`) : monthAfter;
    due = { reason: "BCA_CYCLE_COMPLETE", cycleKey: cycle.cycleKey, since, accounts: [reserve, cycle.accountId] };
    break;
  }
  if (!due && !cycles.some((cycle) => cycle.cycleKey === currentCycle)) {
    const monthEnd = `${currentCycle}-${String(lastDayOfCycle(currentCycle)).padStart(2, "0")}`;
    if (today >= monthEnd) due = { reason: "MONTH_END", cycleKey: null, since: monthEnd, accounts: [reserve] };
  }
  if (!due) return prompts;

  for (const accountId of new Set(due.accounts)) {
    const confirmation = await latestConfirmation(tx, ownerId, accountId);
    if (confirmation && businessDateOf(confirmation.asOf) >= due.since) continue;
    prompts.push({ accountId, reason: due.reason, cycleKey: due.cycleKey, dueSince: due.since });
  }
  return prompts;
}

export type ManualFreshness = {
  status: "DISCREPANCY" | "CALCULATED_AFTER_CONFIRMATION" | "CONFIRMED";
  confirmedPersonal: MinorUnits;
  lastConfirmedAt: string;
};

/** Freshness from the latest manual confirmation of each non-weekly account, in two queries. */
export async function manualFreshnessFor(tx: OwnerTx, ownerId: string, accountIds: string[]): Promise<Map<string, ManualFreshness>> {
  const manual = [...(await latestConfirmations(tx, ownerId, accountIds)).values()].filter((c) => c.source === "MANUAL");
  const positions = await positionsAtConfirmations(tx, ownerId, manual);
  const result = new Map<string, ManualFreshness>();
  for (const confirmation of manual) {
    const position = positions.get(confirmation.id)!;
    const discrepancy = confirmation.physicalBalanceMinor - position.physical;
    result.set(confirmation.accountId, {
      status: discrepancy !== 0n ? "DISCREPANCY" : position.movedAfter > 0 ? "CALCULATED_AFTER_CONFIRMATION" : "CONFIRMED",
      confirmedPersonal: confirmation.physicalBalanceMinor - position.external,
      lastConfirmedAt: confirmation.asOf.toISOString(),
    });
  }
  return result;
}

/** Freshness from the latest manual confirmation of a non-weekly account, if any. */
export async function manualFreshness(tx: OwnerTx, ownerId: string, accountId: string): Promise<ManualFreshness | null> {
  return (await manualFreshnessFor(tx, ownerId, [accountId])).get(accountId) ?? null;
}
