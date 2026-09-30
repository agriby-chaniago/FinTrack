import { ownerRoute } from "@/server/api/owner-route";
import { settlementRouter } from "@/server/application/settlement";

/** `Update saldo` for DANA: normal, draft, overdue (late or catch-up), or informational state. */
export const GET = ownerRoute(async ({ tx, principal }) => Response.json({ data: await settlementRouter(tx, principal.ownerId, new Date()) }));
