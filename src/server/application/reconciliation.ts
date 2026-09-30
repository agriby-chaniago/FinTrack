// Balance confirmation and reconciliation for accounts outside weekly settlement
// (PRD: Correction dan reconciliation, Cadence reconciliation). Physical-first:
// the confirmation stores only the provider balance; ownership comes from the ledger.
import { and, desc, eq, isNull, sql } from "drizzle-orm";
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

export type Position = { physical: MinorUnits; external: MinorUnits };

/**
 * Calculated position as of a confirmation (PRD v0.18 inclusion rule); a
 * BALANCE_ADJUSTMENT made for that confirmation always counts toward it.
 */
async function positionAtConfirmation(tx: OwnerTx, ownerId: string, confirmation: typeof balanceConfirmation.$inferSelect): Promise<Position> {
  const date = businessDateOf(confirmation.asOf);
  const [row] = await tx.execute<{ physical: string; external: string; opening_physical: string; opening_external: string }>(sql`
    select
      coalesce((select sum(l.physical_effect_minor) from fintrack.ledger_leg l join fintrack.ledger_entry e on e.id = l.entry_id
        where e.owner_id = ${ownerId} and l.account_id = ${confirmation.accountId}
          and (e.effective_business_date < ${date}::date
               or (e.effective_business_date = ${date}::date and e.recorded_at <= ${confirmation.recordedAt.toISOString()}::timestamptz)
               or (e.source_type = 'BALANCE_CONFIRMATION' and e.source_id = ${confirmation.id}::uuid))), 0)::text as physical,
      coalesce((select sum(l.external_effect_minor) from fintrack.ledger_leg l join fintrack.ledger_entry e on e.id = l.entry_id
        where e.owner_id = ${ownerId} and l.account_id = ${confirmation.accountId}
          and (e.effective_business_date < ${date}::date
               or (e.effective_business_date = ${date}::date and e.recorded_at <= ${confirmation.recordedAt.toISOString()}::timestamptz))), 0)::text as external,
      (coalesce((select sum(p.physical_balance_minor) from fintrack.opening_account_position p
        join fintrack.onboarding_snapshot s on s.id = p.snapshot_id
        where s.owner_id = ${ownerId} and s.status = 'CONFIRMED' and s.superseded_by_id is null and p.account_id = ${confirmation.accountId}), 0)
        + coalesce((select a.physical_balance_minor from fintrack.account_activation_position a
            where a.owner_id = ${ownerId} and a.account_id = ${confirmation.accountId}), 0))::text as opening_physical,
      coalesce((select sum(x.amount_minor) from fintrack.opening_external_position x
        join fintrack.onboarding_snapshot s on s.id = x.snapshot_id
        where s.owner_id = ${ownerId} and s.status = 'CONFIRMED' and s.superseded_by_id is null and x.account_id = ${confirmation.accountId}), 0)::text as opening_external`);
  return {
    physical: BigInt(row.opening_physical) + BigInt(row.physical),
    external: BigInt(row.opening_external) + BigInt(row.external),
  };
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

export async function latestConfirmation(tx: OwnerTx, ownerId: string, accountId: string) {
  const [row] = await tx
    .select()
    .from(balanceConfirmation)
    .where(and(eq(balanceConfirmation.ownerId, ownerId), eq(balanceConfirmation.accountId, accountId), isNull(balanceConfirmation.supersededById)))
    .orderBy(desc(balanceConfirmation.asOf), desc(balanceConfirmation.recordedAt))
    .limit(1);
  return row;
}

/** Reconciliation of the latest authoritative confirmation of an account. */
export async function reconciliationView(tx: OwnerTx, ownerId: string, accountId: string): Promise<ReconciliationView | null> {
  const confirmation = await latestConfirmation(tx, ownerId, accountId);
  if (!confirmation || confirmation.source !== "MANUAL") return null;
  const position = await positionAtConfirmation(tx, ownerId, confirmation);
  const discrepancy = confirmation.physicalBalanceMinor - position.physical;

  const adjustments = await tx.execute<{ id: string; amount: string; confirmation_id: string; note: string | null; superseded: boolean }>(sql`
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

/** Freshness from the latest manual confirmation of a non-weekly account, if any. */
export async function manualFreshness(tx: OwnerTx, ownerId: string, accountId: string): Promise<ManualFreshness | null> {
  const confirmation = await latestConfirmation(tx, ownerId, accountId);
  if (!confirmation || confirmation.source !== "MANUAL") return null;
  const position = await positionAtConfirmation(tx, ownerId, confirmation);
  const discrepancy = confirmation.physicalBalanceMinor - position.physical;
  const date = businessDateOf(confirmation.asOf);
  const [after] = await tx.execute<{ count: number }>(sql`
    select count(*)::int as count from fintrack.ledger_leg l join fintrack.ledger_entry e on e.id = l.entry_id
    where e.owner_id = ${ownerId} and l.account_id = ${accountId}
      and (e.source_type is distinct from 'BALANCE_CONFIRMATION' or e.source_id is distinct from ${confirmation.id}::uuid)
      and (e.effective_business_date > ${date}::date
           or (e.effective_business_date = ${date}::date and e.recorded_at > ${confirmation.recordedAt.toISOString()}::timestamptz))`);
  return {
    status: discrepancy !== 0n ? "DISCREPANCY" : after.count > 0 ? "CALCULATED_AFTER_CONFIRMATION" : "CONFIRMED",
    confirmedPersonal: confirmation.physicalBalanceMinor - position.external,
    lastConfirmedAt: confirmation.asOf.toISOString(),
  };
}
