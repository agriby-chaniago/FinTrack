import { ApiError } from "@/server/api/errors";
import { ownerRoute } from "@/server/api/owner-route";
import { isUuid } from "@/server/api/responses";
import { closeTarget } from "@/server/application/transfers";

/** `Tutup target`: final write-off with reason LIQUIDITY_WRITE_OFF. */
export const POST = ownerRoute(
  async ({ tx, principal, params }) => {
    if (!isUuid(params.id)) throw new ApiError("NOT_FOUND");
    await closeTarget(tx, principal.ownerId, params.id);
    return Response.json({ data: { closed: true } }, { status: 201 });
  },
  { idempotent: true },
);
