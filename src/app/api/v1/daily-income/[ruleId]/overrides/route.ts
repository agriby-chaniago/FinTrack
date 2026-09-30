import { readJson } from "@/server/api/body";
import { ApiError } from "@/server/api/errors";
import { ownerRoute } from "@/server/api/owner-route";
import { isUuid } from "@/server/api/responses";
import { overrideSchema, setOverride } from "@/server/application/daily-income";

/** Actual amount for an ACTIVE date (Rp0 = not received); null restores the default. */
export const PUT = ownerRoute(
  async ({ request, tx, principal, params }) => {
    if (!isUuid(params.ruleId)) throw new ApiError("NOT_FOUND");
    const input = await readJson(request, overrideSchema);
    return Response.json({ data: await setOverride(tx, principal.ownerId, params.ruleId, input, new Date()) });
  },
  { idempotent: true },
);
