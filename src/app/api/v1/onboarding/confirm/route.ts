import { ownerRoute } from "@/server/api/owner-route";
import { requireIfMatchVersion } from "@/server/api/preconditions";
import { confirmOnboarding } from "@/server/application/onboarding";

/** `Mulai FinTrack`: atomically confirms the draft version named in If-Match. */
export const POST = ownerRoute(async ({ request, tx, principal }) => {
  const expectedVersion = requireIfMatchVersion(request);
  const summary = await confirmOnboarding(tx, principal.ownerId, expectedVersion, new Date());
  return Response.json({ data: summary }, { status: 201 });
});
