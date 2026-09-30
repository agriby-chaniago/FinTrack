import { ApiError } from "@/server/api/errors";
import { ownerRoute } from "@/server/api/owner-route";
import { listActivity } from "@/server/application/activity";

/** Audit timeline ordered by recorded time; `?before=<cursor>&limit=<n>` pages back. */
export const GET = ownerRoute(async ({ request, tx, principal }) => {
  const url = new URL(request.url);
  const cursor = url.searchParams.get("before");
  let before: { recordedAt: string; id: string } | undefined;
  if (cursor) {
    const [recordedAt, id] = cursor.split("|");
    if (!recordedAt || !id || Number.isNaN(Date.parse(recordedAt))) throw new ApiError("VALIDATION_FAILED", { query: "before" });
    before = { recordedAt, id };
  }
  const limit = Number(url.searchParams.get("limit") ?? "50") || 50;
  return Response.json({ data: await listActivity(tx, principal.ownerId, { limit, before }) });
});
