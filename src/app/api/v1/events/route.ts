import { readJson } from "@/server/api/body";
import { ownerRoute } from "@/server/api/owner-route";
import { postResultResponse } from "@/server/api/responses";
import { otherEventSchema, recordOtherEvent } from "@/server/application/events";

/** `Catat income/expense lain` from Detail Akun and reconciliation. */
export const POST = ownerRoute(
  async ({ request, tx, principal }) => {
    const input = await readJson(request, otherEventSchema);
    return postResultResponse(await recordOtherEvent(tx, principal.ownerId, input, new Date()));
  },
  { idempotent: true },
);
