import { readJson } from "@/server/api/body";
import { ApiError } from "@/server/api/errors";
import { ownerRoute } from "@/server/api/owner-route";
import { isUuid } from "@/server/api/responses";
import { endRule, endRuleSchema } from "@/server/application/monthly";

/** Sets the last expected cycle; no occurrence is created after it. */
export const PATCH = ownerRoute(async ({ request, tx, principal, params }) => {
  if (!isUuid(params.id)) throw new ApiError("NOT_FOUND");
  await endRule(tx, principal.ownerId, "MONTHLY_INCOME", params.id, await readJson(request, endRuleSchema), new Date());
  return new Response(null, { status: 204 });
});
