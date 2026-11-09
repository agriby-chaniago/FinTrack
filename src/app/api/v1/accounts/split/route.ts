import { readJson } from "@/server/api/body";
import { ownerRoute } from "@/server/api/owner-route";
import { splitAccountSchema, splitReserveAccount } from "@/server/application/account-split";

/** Explicit owner confirmation only; a page load never splits money. */
export const POST = ownerRoute(async ({ request, tx, principal }) => {
  const input = await readJson(request, splitAccountSchema);
  return Response.json({ data: await splitReserveAccount(tx, principal.ownerId, input, new Date()) }, { status: 201 });
}, { idempotent: true });
