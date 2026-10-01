// Ledger posting and balance queries. Runs inside withOwnerDb(); every query
// filters by owner_id explicitly in addition to RLS.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { businessDateOf, isBusinessDate } from "@/lib/business-time";
import { toIdrDecimal, type MinorUnits } from "@/lib/money";
import { ApiError } from "@/server/api/errors";
import type { OwnerTx } from "@/server/db/owner";
import { ledgerEntry, ledgerLeg } from "@/server/db/schema/ledger";
import { account, dailyIncomeRule, externalHolding } from "@/server/db/schema/onboarding";
import { settlement } from "@/server/db/schema/settlement";
import {
  cutoverRelation,
  ledgerIssues,
  negativeHoldingPositions,
  type LedgerEntryDraft,
} from "@/server/domain/ledger";
import { sqlRows } from "@/server/db/rows";

/** Serialises ledger writes per owner so invariant checks see a stable ledger. */
export async function lockLedger(tx: OwnerTx, ownerId: string): Promise<void> {
  await sqlRows(tx, sql`select pg_advisory_xact_lock(hashtextextended(${`fintrack.ledger:${ownerId}`}, 0))`);
}

/** Answer to "Sudah termasuk saldo awal?" for an event dated on the cutover day. */
export type CutoverDayAnswer = "ALREADY_IN_OPENING" | "NOT_IN_OPENING";

export type PostOptions = {
  readonly now: Date;
  readonly cutoverDayAnswer?: CutoverDayAnswer;
  readonly categoryId?: string | null;
  readonly note?: string | null;
  /**
   * Skip the external-holding replay; the caller must run
   * assertExternalHoldingsNonNegative() once after posting related entries
   * (for example a reversal and its replacement).
   */
  readonly deferHoldingCheck?: boolean;
  /** Set by settlement code itself; other posts into settled history trigger a resync. */
  readonly skipSettlementResync?: boolean;
};

/** Replays every external holding position and rejects any negative point in history. */
export async function assertExternalHoldingsNonNegative(tx: OwnerTx, ownerId: string): Promise<void> {
  const negative = negativeHoldingPositions(
    await effectiveOpeningExternals(tx, ownerId),
    await orderedExternalEffects(tx, ownerId),
  );
  // Throwing rolls back the whole transaction, including rows already inserted.
  if (negative.length > 0) throw new ApiError("INVARIANT_VIOLATION", { negativeHoldings: negative });
}

export type PostResult = { recorded: true; entryId: string } | { recorded: false; reason: "ALREADY_IN_OPENING" };

type OpeningExternal = { accountId: string; holdingId: string; amount: MinorUnits };
type ExternalEffect = { accountId: string; holdingId: string; externalEffect: MinorUnits };

export async function effectiveOpeningExternals(tx: OwnerTx, ownerId: string): Promise<OpeningExternal[]> {
  const rows = await sqlRows<{ account_id: string; holding_id: string; amount: string }>(tx, sql`
    select e.account_id, e.holding_id, e.amount_minor::text as amount
    from fintrack.opening_external_position e
    join fintrack.onboarding_snapshot s on s.id = e.snapshot_id
    where s.owner_id = ${ownerId} and e.owner_id = ${ownerId}
      and s.status = 'CONFIRMED' and s.superseded_by_id is null`);
  return rows.map((row) => ({ accountId: row.account_id, holdingId: row.holding_id, amount: BigInt(row.amount) }));
}

/** External effects in canonical ledger order: business date, recorded time, entry id. */
export async function orderedExternalEffects(tx: OwnerTx, ownerId: string): Promise<ExternalEffect[]> {
  const rows = await sqlRows<{ account_id: string; holding_id: string; effect: string }>(tx, sql`
    select l.account_id, l.holding_id, l.external_effect_minor::text as effect
    from fintrack.ledger_leg l
    join fintrack.ledger_entry e on e.id = l.entry_id
    where e.owner_id = ${ownerId} and l.owner_id = ${ownerId} and l.external_effect_minor <> 0
    order by e.effective_business_date, e.recorded_at, e.id`);
  return rows.map((row) => ({ accountId: row.account_id, holdingId: row.holding_id, externalEffect: BigInt(row.effect) }));
}

/**
 * Posts one confirmed, immutable ledger entry after checking every generic
 * invariant. Features call this; it is never exposed as a raw endpoint.
 */
export async function postLedgerEntry(
  tx: OwnerTx,
  ownerId: string,
  draft: LedgerEntryDraft,
  options: PostOptions,
): Promise<PostResult> {
  const issues: string[] = [...ledgerIssues(draft)];
  if ((draft.eventClass === "SPECIAL_EXPENSE") !== Boolean(options.categoryId)) issues.push("CATEGORY_MISMATCH");
  if (!isBusinessDate(draft.effectiveBusinessDate)) issues.push("INVALID_BUSINESS_DATE");
  else if (draft.effectiveBusinessDate > businessDateOf(options.now)) issues.push("BUSINESS_DATE_IN_FUTURE");
  if (issues.length > 0) throw new ApiError("VALIDATION_FAILED", { issues });

  await lockLedger(tx, ownerId);

  const accountIds = [...new Set(draft.legs.map((leg) => leg.accountId))];
  const accounts = await tx
    .select({ id: account.id, isActive: account.isActive, cutoverAt: account.activationCutoverAt })
    .from(account)
    .where(and(eq(account.ownerId, ownerId), inArray(account.id, accountIds)));
  if (accounts.length !== accountIds.length || accounts.some((row) => !row.isActive)) {
    throw new ApiError("VALIDATION_FAILED", { issues: ["ACCOUNT_NOT_ACTIVE"] });
  }

  const relations = accounts.map((row) => cutoverRelation(draft.effectiveBusinessDate, row.cutoverAt));
  if (relations.includes("BEFORE_CUTOVER")) {
    throw new ApiError("VALIDATION_FAILED", { issues: ["BUSINESS_DATE_BEFORE_CUTOVER"] });
  }
  if (relations.includes("CUTOVER_DAY")) {
    if (!options.cutoverDayAnswer) throw new ApiError("CUTOVER_DAY_CONFIRMATION_REQUIRED");
    // "Ya": the event is already part of the opening position, so nothing is booked.
    if (options.cutoverDayAnswer === "ALREADY_IN_OPENING") return { recorded: false, reason: "ALREADY_IN_OPENING" };
  }

  const holdingIds = [...new Set(draft.legs.flatMap((leg) => (leg.holdingId ? [leg.holdingId] : [])))];
  if (holdingIds.length > 0) {
    const holdings = await tx
      .select({ id: externalHolding.id })
      .from(externalHolding)
      .where(and(eq(externalHolding.ownerId, ownerId), inArray(externalHolding.id, holdingIds)));
    if (holdings.length !== holdingIds.length) throw new ApiError("VALIDATION_FAILED", { issues: ["HOLDING_NOT_FOUND"] });
  }

  const [entry] = await tx
    .insert(ledgerEntry)
    .values({
      ownerId,
      kind: draft.kind,
      eventClass: draft.eventClass,
      effectiveBusinessDate: draft.effectiveBusinessDate,
      reportingClassification: draft.reportingClassification,
      movementType: draft.movementType ?? null,
      correctionRole: draft.correctionRole ?? null,
      correctsEntryId: draft.correctsEntryId ?? null,
      correctedKind: draft.correctedKind ?? null,
      sourceType: draft.sourceType ?? null,
      sourceId: draft.sourceId ?? null,
      categoryId: options.categoryId ?? null,
      note: options.note ?? null,
    })
    .returning({ id: ledgerEntry.id });

  await tx.insert(ledgerLeg).values(
    draft.legs.map((leg) => ({
      ownerId,
      entryId: entry.id,
      accountId: leg.accountId,
      physicalEffectMinor: leg.physicalEffect,
      externalEffectMinor: leg.externalEffect,
      holdingId: leg.holdingId,
    })),
  );

  if (holdingIds.length > 0 && !options.deferHoldingCheck) await assertExternalHoldingsNonNegative(tx, ownerId);

  if (!options.skipSettlementResync) {
    // A record dated inside settled DANA history reclassifies that period's
    // corrected living expense instead of changing cash twice (PRD S8).
    const { lastSettledEnd } = await import("./daily-income");
    const { resyncSettlements } = await import("./settlement");
    const { settlementAccountFor } = await import("./accounts");
    // Tunai records belong to the DANA settlement pool (PRD v0.19).
    const pools = new Set<string>();
    for (const accountId of accountIds) {
      const pool = await settlementAccountFor(tx, ownerId, accountId);
      if (pool) pools.add(pool);
    }
    for (const pool of pools) {
      const settledEnd = await lastSettledEnd(tx, ownerId, pool);
      if (settledEnd && draft.effectiveBusinessDate <= settledEnd) {
        await resyncSettlements(tx, ownerId, pool, draft.effectiveBusinessDate, options.now);
      }
    }
  }

  return { recorded: true, entryId: entry.id };
}

export type BalanceStatus = "CONFIRMED" | "CALCULATED_AFTER_CONFIRMATION" | "OPEN_WEEK" | "NEEDS_REVIEW" | "DISCREPANCY";

export type AccountBalanceView = {
  id: string;
  displayName: string;
  providerName: string;
  /** `BANK`, `E_WALLET`, or `CASH` (account table check). */
  accountType: string;
  purposeLabel: string;
  physical: string;
  external: string;
  personal: string;
  shortfall: string;
  confirmedPersonal: string;
  lastConfirmedAt: string;
  status: BalanceStatus;
  /** DANA open week: living expense is not reconstructed yet (PRD: Freshness saldo). */
  openWeekDisclosure: boolean;
};

/**
 * Calculated balances for every active cash account. Without `asOf` every
 * confirmed entry counts (future business dates are rejected at posting), so
 * the result never depends on clock differences between app and database.
 * With `asOf`, `recordedAt` must come from a database record (for example a
 * balance confirmation) so both sides of the comparison use the same clock.
 * The opening snapshot acts as the latest physical confirmation until
 * balance confirmations exist.
 */
export async function accountBalances(
  tx: OwnerTx,
  ownerId: string,
  asOf?: { instant: Date; recordedAt: Date },
): Promise<{ accounts: AccountBalanceView[]; personalCashRecorded: string }> {
  const inclusion = asOf
    ? sql`and (e.effective_business_date < ${businessDateOf(asOf.instant)}::date
               or (e.effective_business_date = ${businessDateOf(asOf.instant)}::date
                   and e.recorded_at <= ${asOf.recordedAt.toISOString()}::timestamptz))`
    : sql``;
  const rows = await sqlRows<{
    id: string;
    display_name: string;
    provider_name: string;
    account_type: string;
    purpose_label: string;
    cutover_at: string;
    opening_physical: string;
    opening_external: string;
    moved_physical: string;
    moved_external: string;
    movement_count: number;
    has_daily_income: boolean;
    settlement_account_id: string | null;
  }>(tx, sql`
    with snapshot as (
      select id, cutover_at from fintrack.onboarding_snapshot
      where owner_id = ${ownerId} and status = 'CONFIRMED' and superseded_by_id is null
    ),
    opening as (
      select p.account_id, p.physical_balance_minor as physical,
             coalesce((select sum(e.amount_minor) from fintrack.opening_external_position e
                       where e.snapshot_id = p.snapshot_id and e.account_id = p.account_id), 0) as external
      from fintrack.opening_account_position p join snapshot s on s.id = p.snapshot_id
      where p.owner_id = ${ownerId}
      union all
      -- Accounts activated after onboarding (Tunai) open with their activation position.
      select a.account_id, a.physical_balance_minor, 0
      from fintrack.account_activation_position a
      where a.owner_id = ${ownerId}
    ),
    moved as (
      select l.account_id, sum(l.physical_effect_minor) as physical, sum(l.external_effect_minor) as external,
             count(*)::int as movement_count
      from fintrack.ledger_leg l join fintrack.ledger_entry e on e.id = l.entry_id
      where e.owner_id = ${ownerId} and l.owner_id = ${ownerId} ${inclusion}
      group by l.account_id
    )
    select a.id, a.display_name, a.provider_name, a.account_type, a.purpose_label,
           a.activation_cutover_at::text as cutover_at,
           coalesce(o.physical, 0)::text as opening_physical,
           coalesce(o.external, 0)::text as opening_external,
           coalesce(m.physical, 0)::text as moved_physical,
           coalesce(m.external, 0)::text as moved_external,
           coalesce(m.movement_count, 0) as movement_count,
           exists (select 1 from fintrack.daily_income_rule r where r.account_id = a.id and r.owner_id = ${ownerId}) as has_daily_income,
           a.settlement_account_id
    from fintrack.account a
    left join opening o on o.account_id = a.id
    left join moved m on m.account_id = a.id
    where a.owner_id = ${ownerId} and a.is_active and a.is_cash_account
    order by a.sort_order, a.id`);

  const { recognizedIncomeFor } = await import("./daily-income");
  const { weeklyAccountFreshness } = await import("./freshness");
  const { manualFreshnessFor } = await import("./reconciliation");
  const today = businessDateOf(asOf?.instant ?? new Date());

  // Loaded once for every account (set-based), then combined per account below.
  const rules = new Map<string, typeof dailyIncomeRule.$inferSelect>();
  for (const rule of await tx.select().from(dailyIncomeRule).where(eq(dailyIncomeRule.ownerId, ownerId)).orderBy(asc(dailyIncomeRule.createdAt))) {
    if (!rules.has(rule.accountId)) rules.set(rule.accountId, rule);
  }
  const latestSettled = new Map(
    (
      await tx
        .selectDistinctOn([settlement.accountId])
        .from(settlement)
        .where(and(eq(settlement.ownerId, ownerId), eq(settlement.status, "SETTLED")))
        .orderBy(settlement.accountId, desc(settlement.endDate))
    ).map((row) => [row.accountId, row]),
  );
  const manual = await manualFreshnessFor(
    tx,
    ownerId,
    rows.filter((row) => !row.has_daily_income && !row.settlement_account_id).map((row) => row.id),
  );

  let personalCash = 0n;
  const accounts: AccountBalanceView[] = [];
  for (const row of rows) {
    let physical = BigInt(row.opening_physical) + BigInt(row.moved_physical);
    const external = BigInt(row.opening_external) + BigInt(row.moved_external);
    let status: BalanceStatus = row.movement_count > 0 ? "CALCULATED_AFTER_CONFIRMATION" : "CONFIRMED";
    let confirmedPersonal = BigInt(row.opening_physical) - BigInt(row.opening_external);
    let lastConfirmedAt = new Date(row.cutover_at).toISOString();
    let openWeekDisclosure = false;

    const rule = row.has_daily_income ? rules.get(row.id) : undefined;
    // Tunai is confirmed only by the DANA settlement it belongs to (PRD v0.19).
    const poolRule = row.settlement_account_id ? rules.get(row.settlement_account_id) : undefined;
    if (poolRule) {
      const pool = poolRule.accountId;
      const freshness = await weeklyAccountFreshness(tx, ownerId, pool, poolRule.effectiveStartDate, latestSettled.get(pool)?.endDate ?? null, today, {
        cashAccountId: row.id,
      });
      status = freshness.status ?? status;
      openWeekDisclosure = freshness.openWeek;
      if (freshness.confirmed) {
        confirmedPersonal = freshness.confirmed.personal;
        lastConfirmedAt = freshness.confirmed.at;
      }
    } else if (!rule) {
      const confirmed = manual.get(row.id);
      if (confirmed) {
        status = confirmed.status;
        confirmedPersonal = confirmed.confirmedPersonal;
        lastConfirmedAt = confirmed.lastConfirmedAt;
      }
    }
    if (rule) {
      // Daily income is evaluated lazily through the as-of date (PRD: no cron).
      physical += (await recognizedIncomeFor(tx, ownerId, row.id, rule.effectiveStartDate, today, rule)).recognized;
      const latest = latestSettled.get(row.id) ?? null;
      const freshness = await weeklyAccountFreshness(tx, ownerId, row.id, rule.effectiveStartDate, latest?.endDate ?? null, today, { latest });
      status = freshness.status ?? status;
      openWeekDisclosure = freshness.openWeek;
      if (freshness.confirmed) {
        confirmedPersonal = freshness.confirmed.personal;
        lastConfirmedAt = freshness.confirmed.at;
      }
    }

    const personal = physical - external;
    personalCash += personal;
    accounts.push({
      id: row.id,
      displayName: row.display_name,
      providerName: row.provider_name,
      accountType: row.account_type,
      purposeLabel: row.purpose_label,
      physical: toIdrDecimal(physical),
      external: toIdrDecimal(external),
      personal: toIdrDecimal(personal),
      shortfall: toIdrDecimal(personal < 0n ? -personal : 0n),
      confirmedPersonal: toIdrDecimal(confirmedPersonal),
      lastConfirmedAt,
      status,
      openWeekDisclosure,
    });
  }

  return { accounts, personalCashRecorded: toIdrDecimal(personalCash) };
}
