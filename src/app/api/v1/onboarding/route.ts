import { ownerRoute } from "@/server/api/owner-route";
import { etag } from "@/server/api/preconditions";
import { getOnboardingState } from "@/server/application/onboarding";

/** Current onboarding state: not started (with a default draft), draft, or confirmed. */
export const GET = ownerRoute(async ({ tx, principal }) => {
  const state = await getOnboardingState(tx, principal.ownerId, new Date());
  const headers = "version" in state ? { ETag: etag(state.version) } : undefined;
  return Response.json({ data: state }, { headers });
});
