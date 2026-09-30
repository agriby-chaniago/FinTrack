import { readJson } from "@/server/api/body";
import { ownerRoute } from "@/server/api/owner-route";
import { postResultResponse } from "@/server/api/responses";
import { recordTransfer, transferSchema } from "@/server/application/transfers";

/** Records a transfer that already happened at the provider; the personal component is allocated oldest-first. */
export const POST = ownerRoute(
  async ({ request, tx, principal }) => {
    const input = await readJson(request, transferSchema);
    return postResultResponse(await recordTransfer(tx, principal.ownerId, input, new Date()));
  },
  { idempotent: true },
);
