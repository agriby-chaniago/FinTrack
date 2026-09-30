import { ownerRoute } from "@/server/api/owner-route";
import { listCategories } from "@/server/application/events";

/** Special-expense categories; `?includeArchived=true` for history and settings. */
export const GET = ownerRoute(async ({ request, tx, principal }) => {
  const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";
  return Response.json({ data: await listCategories(tx, principal.ownerId, { includeArchived }) });
});
