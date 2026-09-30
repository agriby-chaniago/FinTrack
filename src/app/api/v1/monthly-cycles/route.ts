import { ownerRoute } from "@/server/api/owner-route";
import { listMonthlyCycles } from "@/server/application/monthly";

/** BCA cycles newest first with derived state, occurrences, and frozen targets. */
export const GET = ownerRoute(async ({ tx, principal }) => Response.json({ data: await listMonthlyCycles(tx, principal.ownerId, new Date()) }));
