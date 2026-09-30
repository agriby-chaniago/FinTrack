import { ownerRoute } from "@/server/api/owner-route";
import { accountBalances } from "@/server/application/ledger";

/** Active cash accounts with calculated physical, external, and personal balances. */
export const GET = ownerRoute(async ({ tx, principal }) => {
  const now = new Date();
  const balances = await accountBalances(tx, principal.ownerId, { instant: now, recordedAt: now });
  return Response.json({ data: balances });
});
