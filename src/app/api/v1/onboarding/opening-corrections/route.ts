import { ApiError } from "@/server/api/errors";
import { ownerRoute } from "@/server/api/owner-route";
import { requireIfMatchToken } from "@/server/api/preconditions";
import { supersedeOpeningSnapshot } from "@/server/application/opening-correction";

/**
 * Corrects the confirmed opening snapshot named in If-Match by creating a
 * superseding snapshot. The original stays available for audit.
 */
export const POST = ownerRoute(async ({ request, tx, principal }) => {
  const expectedSnapshotId = requireIfMatchToken(request);
  const body: unknown = await request.json().catch(() => {
    throw new ApiError("VALIDATION_FAILED", { body: "invalid JSON" });
  });
  const result = await supersedeOpeningSnapshot(tx, principal.ownerId, expectedSnapshotId, body, new Date());
  return Response.json({ data: result }, { status: 201 });
});
