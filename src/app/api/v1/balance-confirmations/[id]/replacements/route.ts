import { readJson } from "@/server/api/body";
import { ApiError } from "@/server/api/errors";
import { ownerRoute } from "@/server/api/owner-route";
import { isUuid } from "@/server/api/responses";
import { replaceConfirmation, replacementSchema } from "@/server/application/reconciliation";

/** Replacement confirmation for a mistyped balance; the old one stays as superseded. */
export const POST = ownerRoute(
  async ({ request, tx, principal, params }) => {
    if (!isUuid(params.id)) throw new ApiError("NOT_FOUND");
    return Response.json({ data: await replaceConfirmation(tx, principal.ownerId, params.id, await readJson(request, replacementSchema)) }, { status: 201 });
  },
  { idempotent: true },
);
