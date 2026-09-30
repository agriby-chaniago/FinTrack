import { ownerRoute } from "@/server/api/owner-route";
import { accountsOverview } from "@/server/application/accounts-overview";

/** Active cash accounts with calculated balances, primary status badge, and reconciliation prompts. */
export const GET = ownerRoute(async ({ tx, principal }) => Response.json({ data: await accountsOverview(tx, principal.ownerId, new Date()) }));
