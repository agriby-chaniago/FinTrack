import { readJson } from "@/server/api/body";
import { ApiError } from "@/server/api/errors";
import { ownerRoute } from "@/server/api/owner-route";
import { isUuid } from "@/server/api/responses";
import { reviseRecurringRule, revisionSchema } from "@/server/application/monthly";

/** Explicit expected-schedule change from a future cycle (e.g. `Ubah perkiraan … mulai bulan depan`). */
export const POST = ownerRoute(
  async ({ request, tx, principal, params }) => {
    if (!isUuid(params.id)) throw new ApiError("NOT_FOUND");
    return Response.json({ data: await reviseRecurringRule(tx, principal.ownerId, params.id, await readJson(request, revisionSchema), new Date()) }, { status: 201 });
  },
  { idempotent: true },
);
