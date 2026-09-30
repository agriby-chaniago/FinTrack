import { ownerRoute } from "@/server/api/owner-route";
import { dashboard } from "@/server/application/reports";

/** Beranda composition in the locked reading order. */
export const GET = ownerRoute(async ({ tx, principal }) => Response.json({ data: await dashboard(tx, principal.ownerId, new Date()) }));
