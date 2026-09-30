import { ApiError } from "@/server/api/errors";
import { ownerRoute } from "@/server/api/owner-route";
import { isUuid } from "@/server/api/responses";
import { reconciliationView } from "@/server/application/reconciliation";

/** Canonical reconciliation view of the latest manual confirmation (Detail Akun). */
export const GET = ownerRoute(async ({ tx, principal, params }) => {
  if (!isUuid(params.id)) throw new ApiError("NOT_FOUND");
  return Response.json({ data: await reconciliationView(tx, principal.ownerId, params.id) });
});
