import { ownerRoute } from "@/server/api/owner-route";
import { accountBalances } from "@/server/application/ledger";

/** Active cash accounts with calculated physical, external, and personal balances. */
export const GET = ownerRoute(async ({ tx, principal }) => {
  const balances = await accountBalances(tx, principal.ownerId);
  return Response.json({ data: balances });
});
