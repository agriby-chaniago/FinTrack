// Pengaturan: workflow settings that are data, never provider-name rules.
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { parseIdrDecimal, toIdrDecimal } from "@/lib/money";
import { ApiError } from "@/server/api/errors";
import { nonNegativeAmount } from "@/server/api/schemas";
import type { OwnerTx } from "@/server/db/owner";
import { account, monthlyAccountSetting, ownerSetting } from "@/server/db/schema/onboarding";

import { requireActiveCashAccounts } from "./accounts";

export async function getSettings(tx: OwnerTx, ownerId: string) {
  const [setting] = await tx.select().from(ownerSetting).where(eq(ownerSetting.ownerId, ownerId));
  const floors = await tx
    .select({ accountId: monthlyAccountSetting.accountId, floor: monthlyAccountSetting.retainedBalanceFloorMinor, name: account.displayName })
    .from(monthlyAccountSetting)
    .innerJoin(account, eq(account.id, monthlyAccountSetting.accountId))
    .where(eq(monthlyAccountSetting.ownerId, ownerId));
  return {
    defaultSpecialSourceAccountId: setting?.defaultSpecialSourceAccountId ?? null,
    reserveAccountId: setting?.reserveAccountId ?? null,
    retainedFloors: floors.map((row) => ({ accountId: row.accountId, accountName: row.name, retainedBalanceFloor: toIdrDecimal(row.floor) })),
  };
}

export const settingsSchema = z.object({
  defaultSpecialSourceAccountId: z.uuid().optional(),
  retainedFloor: z.object({ accountId: z.uuid(), amount: nonNegativeAmount }).optional(),
});

/**
 * The floor change applies only to targets frozen later; existing targets keep
 * the floor they used (PRD). The default special-expense source must be active.
 */
export async function updateSettings(tx: OwnerTx, ownerId: string, input: z.infer<typeof settingsSchema>): Promise<void> {
  if (input.defaultSpecialSourceAccountId) {
    await requireActiveCashAccounts(tx, ownerId, [input.defaultSpecialSourceAccountId]);
    await tx.update(ownerSetting).set({ defaultSpecialSourceAccountId: input.defaultSpecialSourceAccountId, updatedAt: new Date() }).where(eq(ownerSetting.ownerId, ownerId));
  }
  if (input.retainedFloor) {
    const updated = await tx
      .update(monthlyAccountSetting)
      .set({ retainedBalanceFloorMinor: parseIdrDecimal(input.retainedFloor.amount), updatedAt: new Date() })
      .where(and(eq(monthlyAccountSetting.ownerId, ownerId), eq(monthlyAccountSetting.accountId, input.retainedFloor.accountId)))
      .returning({ accountId: monthlyAccountSetting.accountId });
    if (updated.length === 0) throw new ApiError("NOT_FOUND");
  }
}
