import { readJson } from "@/server/api/body";
import { ownerRoute } from "@/server/api/owner-route";
import { confirmBalance, confirmationSchema } from "@/server/application/reconciliation";

/** `Update saldo` for accounts outside weekly settlement: physical balance only. */
export const POST = ownerRoute(
  async ({ request, tx, principal }) =>
    Response.json({ data: await confirmBalance(tx, principal.ownerId, await readJson(request, confirmationSchema), new Date()) }, { status: 201 }),
  { idempotent: true },
);
