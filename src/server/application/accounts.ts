import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { ApiError } from "@/server/api/errors";
import type { OwnerTx } from "@/server/db/owner";
import { account, dailyIncomeRule } from "@/server/db/schema/onboarding";

export type AccountRow = typeof account.$inferSelect;

/** Loads active cash accounts by id; any missing or inactive id is a validation error. */
export async function requireActiveCashAccounts(tx: OwnerTx, ownerId: string, ids: string[]): Promise<Map<string, AccountRow>> {
  const unique = [...new Set(ids)];
  const rows = await tx
    .select()
    .from(account)
    .where(and(eq(account.ownerId, ownerId), inArray(account.id, unique)));
  if (rows.length !== unique.length || rows.some((row) => !row.isActive || !row.isCashAccount)) {
    throw new ApiError("VALIDATION_FAILED", { issues: ["ACCOUNT_NOT_ACTIVE"] });
  }
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Accounts reconciled through weekly settlement: the ones that receive daily
 * income (initially DANA) and the accounts settled together with them (Tunai,
 * PRD v0.19). Rules never depend on provider names.
 */
export async function weeklySettlementAccountIds(tx: OwnerTx, ownerId: string): Promise<Set<string>> {
  const rows = await tx
    .selectDistinct({ accountId: dailyIncomeRule.accountId })
    .from(dailyIncomeRule)
    .where(eq(dailyIncomeRule.ownerId, ownerId));
  const members = await tx
    .select({ accountId: account.id })
    .from(account)
    .where(and(eq(account.ownerId, ownerId), isNotNull(account.settlementAccountId)));
  return new Set([...rows, ...members].map((row) => row.accountId));
}

/** The weekly account whose settlement covers `accountId` (itself for DANA, DANA for Tunai), or null. */
export async function settlementAccountFor(tx: OwnerTx, ownerId: string, accountId: string): Promise<string | null> {
  const [rule] = await tx
    .select({ accountId: dailyIncomeRule.accountId })
    .from(dailyIncomeRule)
    .where(and(eq(dailyIncomeRule.ownerId, ownerId), eq(dailyIncomeRule.accountId, accountId)))
    .limit(1);
  if (rule) return rule.accountId;
  const [member] = await tx
    .select({ settlementAccountId: account.settlementAccountId })
    .from(account)
    .where(and(eq(account.ownerId, ownerId), eq(account.id, accountId)));
  return member?.settlementAccountId ?? null;
}

/** The cash account settled together with a weekly account (Tunai), if it was activated. */
export async function cashMemberOf(tx: OwnerTx, ownerId: string, settlementAccountId: string): Promise<AccountRow | null> {
  const [row] = await tx
    .select()
    .from(account)
    .where(and(eq(account.ownerId, ownerId), eq(account.settlementAccountId, settlementAccountId), eq(account.isActive, true)));
  return row ?? null;
}
