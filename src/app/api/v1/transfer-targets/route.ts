import { ownerRoute } from "@/server/api/owner-route";
import { listTargets } from "@/server/application/transfers";

/** Every logical transfer target with its effective version, allocations, and derived progress. */
export const GET = ownerRoute(async ({ tx, principal }) => Response.json({ data: await listTargets(tx, principal.ownerId) }));
