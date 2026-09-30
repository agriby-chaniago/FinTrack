import { ownerRoute } from "@/server/api/owner-route";
import { listRecurringRules } from "@/server/application/monthly";

export const GET = ownerRoute(async ({ tx, principal }) => Response.json({ data: await listRecurringRules(tx, principal.ownerId, new Date()) }));
