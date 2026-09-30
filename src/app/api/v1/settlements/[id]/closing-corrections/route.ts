import { readJson } from "@/server/api/body";
import { ApiError } from "@/server/api/errors";
import { ownerRoute } from "@/server/api/owner-route";
import { isUuid } from "@/server/api/responses";
import { replaceClosingSchema, replaceSettlementClosing, settlementView } from "@/server/application/settlement";

/** Replacement closing balance: corrected views change, the as-settled snapshot does not. */
export const POST = ownerRoute(
  async ({ request, tx, principal, params }) => {
    if (!isUuid(params.id)) throw new ApiError("NOT_FOUND");
    await replaceSettlementClosing(tx, principal.ownerId, params.id, await readJson(request, replaceClosingSchema), new Date());
    return Response.json({ data: await settlementView(tx, principal.ownerId, params.id) }, { status: 201 });
  },
  { idempotent: true },
);
