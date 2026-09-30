import { readJson } from "@/server/api/body";
import { ownerRoute } from "@/server/api/owner-route";
import { postResultResponse } from "@/server/api/responses";
import { recordSpecialExpense, specialExpenseSchema } from "@/server/application/events";

/** Special expense from the actual source account with a reusable category. */
export const POST = ownerRoute(
  async ({ request, tx, principal }) => {
    const input = await readJson(request, specialExpenseSchema);
    return postResultResponse(await recordSpecialExpense(tx, principal.ownerId, input, new Date()));
  },
  { idempotent: true },
);
