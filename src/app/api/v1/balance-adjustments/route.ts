import { readJson } from "@/server/api/body";
import { ownerRoute } from "@/server/api/owner-route";
import { adjustBalance, adjustmentSchema } from "@/server/application/reconciliation";

/** Explicit BALANCE_ADJUSTMENT for an unknown discrepancy; reason required. */
export const POST = ownerRoute(
  async ({ request, tx, principal }) =>
    Response.json({ data: await adjustBalance(tx, principal.ownerId, await readJson(request, adjustmentSchema), new Date()) }, { status: 201 }),
  { idempotent: true },
);
