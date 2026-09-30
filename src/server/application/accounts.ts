import { and, eq, inArray } from "drizzle-orm";

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
 * income (initially DANA). Rules never depend on provider names.
 */
export async function weeklySettlementAccountIds(tx: OwnerTx, ownerId: string): Promise<Set<string>> {
  const rows = await tx
    .selectDistinct({ accountId: dailyIncomeRule.accountId })
    .from(dailyIncomeRule)
    .where(eq(dailyIncomeRule.ownerId, ownerId));
  return new Set(rows.map((row) => row.accountId));
}
