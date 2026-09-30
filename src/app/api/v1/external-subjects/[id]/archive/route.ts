import { ApiError } from "@/server/api/errors";
import { ownerRoute } from "@/server/api/owner-route";
import { isUuid } from "@/server/api/responses";
import { archiveExternalSubject } from "@/server/application/external-funds";

/** Archives a subject whose every position is Rp0; history is kept. */
export const POST = ownerRoute(async ({ tx, principal, params }) => {
  if (!isUuid(params.id)) throw new ApiError("NOT_FOUND");
  await archiveExternalSubject(tx, principal.ownerId, params.id);
  return new Response(null, { status: 204 });
});
