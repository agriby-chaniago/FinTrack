// Account cards with the final primary badge (PRD precedence):
// Ada selisih > Perlu diperiksa > Minggu berjalan > Terhitung setelah konfirmasi > Dikonfirmasi.
import type { OwnerTx } from "@/server/db/owner";

import { accountBalances, type AccountBalanceView, type BalanceStatus } from "./ledger";
import type { CycleView } from "./monthly";
import { reconciliationPrompts, type ReconciliationPrompt } from "./reconciliation";

const precedence: BalanceStatus[] = ["DISCREPANCY", "NEEDS_REVIEW", "OPEN_WEEK", "CALCULATED_AFTER_CONFIRMATION", "CONFIRMED"];

export type AccountCard = AccountBalanceView & { prompt: ReconciliationPrompt | null };

export async function accountsOverview(
  tx: OwnerTx,
  ownerId: string,
  now: Date,
  loaded: { cycles?: CycleView[] } = {},
): Promise<{ accounts: AccountCard[]; personalCashRecorded: string; prompts: ReconciliationPrompt[] }> {
  const balances = await accountBalances(tx, ownerId);
  const prompts = await reconciliationPrompts(tx, ownerId, now, loaded);
  const accounts = balances.accounts.map((account) => {
    const prompt = prompts.find((p) => p.accountId === account.id) ?? null;
    const candidates: BalanceStatus[] = [account.status];
    if (prompt) candidates.push("NEEDS_REVIEW");
    const status = precedence.find((s) => candidates.includes(s)) ?? account.status;
    return { ...account, status, prompt };
  });
  return { accounts, personalCashRecorded: balances.personalCashRecorded, prompts };
}
