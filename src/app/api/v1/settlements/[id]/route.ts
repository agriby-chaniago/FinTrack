import { readJson } from "@/server/api/body";
import { ApiError } from "@/server/api/errors";
import { ownerRoute } from "@/server/api/owner-route";
import { etag, requireIfMatchVersion } from "@/server/api/preconditions";
import { isUuid } from "@/server/api/responses";
import { deleteSettlementDraft, settlementView, updateSettlementDraft, updateSettlementSchema } from "@/server/application/settlement";

/** Draft preview, or as-settled and corrected views of a settled period. */
export const GET = ownerRoute(async ({ tx, principal, params }) => {
  if (!isUuid(params.id)) throw new ApiError("NOT_FOUND");
  const view = await settlementView(tx, principal.ownerId, params.id);
  return Response.json({ data: view }, { headers: { ETag: etag(view.version) } });
});

/** Sets the closing physical balance seen at the provider before the remainder is transferred. */
export const PATCH = ownerRoute(async ({ request, tx, principal, params }) => {
  if (!isUuid(params.id)) throw new ApiError("NOT_FOUND");
  const version = requireIfMatchVersion(request);
  const row = await updateSettlementDraft(tx, principal.ownerId, params.id, await readJson(request, updateSettlementSchema), version, new Date());
  return Response.json({ data: await settlementView(tx, principal.ownerId, row.id) }, { headers: { ETag: etag(row.version) } });
});

export const DELETE = ownerRoute(async ({ tx, principal, params }) => {
  if (!isUuid(params.id)) throw new ApiError("NOT_FOUND");
  await deleteSettlementDraft(tx, principal.ownerId, params.id);
  return new Response(null, { status: 204 });
});
