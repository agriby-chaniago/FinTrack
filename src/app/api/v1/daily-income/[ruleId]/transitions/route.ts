import { readJson } from "@/server/api/body";
import { ApiError } from "@/server/api/errors";
import { ownerRoute } from "@/server/api/owner-route";
import { isUuid } from "@/server/api/responses";
import { scheduleTransition, transitionSchema } from "@/server/application/daily-income";

/** Pause or resume from an inclusive effective date (default today or the next open date). */
export const POST = ownerRoute(
  async ({ request, tx, principal, params }) => {
    if (!isUuid(params.ruleId)) throw new ApiError("NOT_FOUND");
    const input = await readJson(request, transitionSchema);
    return Response.json({ data: await scheduleTransition(tx, principal.ownerId, params.ruleId, input, new Date()) }, { status: 201 });
  },
  { idempotent: true },
);
