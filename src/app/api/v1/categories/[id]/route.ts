import { readJson } from "@/server/api/body";
import { ApiError } from "@/server/api/errors";
import { ownerRoute } from "@/server/api/owner-route";
import { isUuid } from "@/server/api/responses";
import { categoryUpdateSchema, updateCategory } from "@/server/application/events";

/** Rename or archive a category; used categories are never deleted. */
export const PATCH = ownerRoute(async ({ request, tx, principal, params }) => {
  if (!isUuid(params.id)) throw new ApiError("NOT_FOUND");
  await updateCategory(tx, principal.ownerId, params.id, await readJson(request, categoryUpdateSchema));
  return new Response(null, { status: 204 });
});
