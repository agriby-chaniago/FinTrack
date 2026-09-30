import { readJson } from "@/server/api/body";
import { ownerRoute } from "@/server/api/owner-route";
import { postResultResponse } from "@/server/api/responses";
import { externalMovementSchema, recordExternalMovement } from "@/server/application/external-funds";

/** Receipt, return, owner-use, internal move, or ownership conversion of external funds. */
export const POST = ownerRoute(
  async ({ request, tx, principal }) => {
    const input = await readJson(request, externalMovementSchema);
    return postResultResponse(await recordExternalMovement(tx, principal.ownerId, input, new Date()));
  },
  { idempotent: true },
);
