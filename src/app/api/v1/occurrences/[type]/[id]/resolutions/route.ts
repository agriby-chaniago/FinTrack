import { readJson } from "@/server/api/body";
import { ApiError } from "@/server/api/errors";
import { ownerRoute } from "@/server/api/owner-route";
import { isUuid } from "@/server/api/responses";
import { resolutionSchema, resolveOccurrence } from "@/server/application/monthly";

const types = { "monthly-income": "MONTHLY_INCOME", "recurring-expense": "RECURRING_EXPENSE" } as const;

/** Appends a resolution: confirm, not received/charged, late confirmation, or event → no-event. */
export const POST = ownerRoute(
  async ({ request, tx, principal, params }) => {
    const type = types[params.type as keyof typeof types];
    if (!type || !isUuid(params.id)) throw new ApiError("NOT_FOUND");
    const input = await readJson(request, resolutionSchema);
    return Response.json({ data: await resolveOccurrence(tx, principal.ownerId, type, params.id, input, new Date()) }, { status: 201 });
  },
  { idempotent: true },
);
