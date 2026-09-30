import { ApiError } from "@/server/api/errors";
import { ownerRoute } from "@/server/api/owner-route";
import { isUuid } from "@/server/api/responses";
import { cancelTransition } from "@/server/application/daily-income";

/** Cancels a transition outside settled history; the revision stays recorded. */
export const DELETE = ownerRoute(async ({ tx, principal, params }) => {
  if (!isUuid(params.ruleId) || !isUuid(params.transitionId)) throw new ApiError("NOT_FOUND");
  await cancelTransition(tx, principal.ownerId, params.ruleId, params.transitionId, new Date());
  return new Response(null, { status: 204 });
});
