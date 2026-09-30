import { ownerRoute } from "@/server/api/owner-route";
import { dailyIncomeView } from "@/server/application/daily-income";

/** Daily income rule with current state, upcoming transition, and overrides. */
export const GET = ownerRoute(async ({ tx, principal }) => Response.json({ data: await dailyIncomeView(tx, principal.ownerId, new Date()) }));
