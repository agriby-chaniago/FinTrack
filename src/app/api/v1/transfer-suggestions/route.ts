import { ownerRoute } from "@/server/api/owner-route";
import { transferSuggestions } from "@/server/application/transfers";

/** Operational "transfer sekarang" amount per saving route. */
export const GET = ownerRoute(async ({ tx, principal }) => Response.json({ data: await transferSuggestions(tx, principal.ownerId) }));
