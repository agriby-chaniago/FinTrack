import { ApiError } from "@/server/api/errors";
import { ownerRoute } from "@/server/api/owner-route";
import { monthReport } from "@/server/application/reports";

/** Calendar-month report; `?view=as_settled|corrected` (default corrected). */
export const GET = ownerRoute(async ({ request, tx, principal, params }) => {
  const view = new URL(request.url).searchParams.get("view") ?? "corrected";
  if (view !== "corrected" && view !== "as_settled") throw new ApiError("VALIDATION_FAILED", { query: "view" });
  return Response.json({ data: await monthReport(tx, principal.ownerId, params.month ?? "", view, new Date()) });
});
