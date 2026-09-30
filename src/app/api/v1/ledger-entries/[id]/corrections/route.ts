import { readJson } from "@/server/api/body";
import { ApiError } from "@/server/api/errors";
import { ownerRoute } from "@/server/api/owner-route";
import { isUuid } from "@/server/api/responses";
import { correctEntry, correctionSchema } from "@/server/application/corrections";

/** `Koreksi`: reversal + replacement, reversal-only void, or settled CORRECTION_POSTING. */
export const POST = ownerRoute(
  async ({ request, tx, principal, params }) => {
    if (!isUuid(params.id)) throw new ApiError("NOT_FOUND");
    const input = await readJson(request, correctionSchema);
    return Response.json({ data: await correctEntry(tx, principal.ownerId, params.id, input, new Date()) }, { status: 201 });
  },
  { idempotent: true },
);
