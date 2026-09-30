import { ApiError } from "@/server/api/errors";
import { ownerRoute } from "@/server/api/owner-route";
import { requireIfMatchVersion } from "@/server/api/preconditions";
import { isUuid } from "@/server/api/responses";
import { settle, settlementView } from "@/server/application/settlement";

/** Confirms closing and reconstruction; the settlement becomes SETTLED and immutable. */
export const POST = ownerRoute(
  async ({ request, tx, principal, params }) => {
    if (!isUuid(params.id)) throw new ApiError("NOT_FOUND");
    await settle(tx, principal.ownerId, params.id, requireIfMatchVersion(request), new Date());
    return Response.json({ data: await settlementView(tx, principal.ownerId, params.id) }, { status: 201 });
  },
  { idempotent: true },
);
