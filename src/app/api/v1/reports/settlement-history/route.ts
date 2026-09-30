import { ownerRoute } from "@/server/api/owner-route";
import { settlementHistory } from "@/server/application/reports";

export const GET = ownerRoute(async ({ tx, principal }) => Response.json({ data: await settlementHistory(tx, principal.ownerId) }));
