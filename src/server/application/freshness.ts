// Derived balance-status labels (PRD: Freshness saldo). Never persisted.
import { and, desc, eq } from "drizzle-orm";

import { parseIdrDecimal, type MinorUnits } from "@/lib/money";
import type { OwnerTx } from "@/server/db/owner";
import { settlement } from "@/server/db/schema/settlement";
import { settlementPlan } from "@/server/domain/daily-income";

import type { BalanceStatus } from "./ledger";
import { authoritativeConfirmation } from "./settlement";

/**
 * DANA: a due or overdue settlement is `Perlu diperiksa`; an open week is
 * `Minggu berjalan` with the mandatory disclosure. The latest settlement
 * closing is the latest physical confirmation.
 */
export async function weeklyAccountFreshness(
  tx: OwnerTx,
  ownerId: string,
  accountId: string,
  ruleStart: string,
  settledEnd: string | null,
  today: string,
): Promise<{ status: BalanceStatus | null; openWeek: boolean; confirmed: { personal: MinorUnits; at: string } | null }> {
  const plan = settlementPlan(ruleStart, settledEnd, today);
  const openWeek = plan.periodStart <= today;
  const status: BalanceStatus | null = plan.status !== "INFORMATIONAL" ? "NEEDS_REVIEW" : openWeek ? "OPEN_WEEK" : null;

  const [latest] = await tx
    .select()
    .from(settlement)
    .where(and(eq(settlement.ownerId, ownerId), eq(settlement.accountId, accountId), eq(settlement.status, "SETTLED")))
    .orderBy(desc(settlement.endDate))
    .limit(1);
  if (!latest) return { status, openWeek, confirmed: null };
  const confirmation = await authoritativeConfirmation(tx, ownerId, latest.closingConfirmationId!);
  const closingExternal = parseIdrDecimal(String((latest.snapshot as { closingExternal: string }).closingExternal));
  return {
    status,
    openWeek,
    confirmed: { personal: confirmation.physicalBalanceMinor - closingExternal, at: confirmation.asOf.toISOString() },
  };
}
