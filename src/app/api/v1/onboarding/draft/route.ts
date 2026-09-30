import { ApiError } from "@/server/api/errors";
import { ownerRoute } from "@/server/api/owner-route";
import { etag, requireIfMatchVersion } from "@/server/api/preconditions";
import { saveOnboardingDraft } from "@/server/application/onboarding";

/** Creates (`If-Match: "0"`) or replaces the editable onboarding draft. */
export const PUT = ownerRoute(async ({ request, tx, principal }) => {
  const expectedVersion = requireIfMatchVersion(request);
  const body: unknown = await request.json().catch(() => {
    throw new ApiError("VALIDATION_FAILED", { body: "invalid JSON" });
  });
  const result = await saveOnboardingDraft(tx, principal.ownerId, body, expectedVersion);
  return Response.json({ data: result }, { headers: { ETag: etag(result.version) } });
});
