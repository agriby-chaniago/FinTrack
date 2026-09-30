import { readJson } from "@/server/api/body";
import { ownerRoute } from "@/server/api/owner-route";
import { createSubscription, subscriptionSchema } from "@/server/application/monthly";

/** Adds a subscription on the monthly account starting next cycle (or this one when opted in). */
export const POST = ownerRoute(
  async ({ request, tx, principal }) =>
    Response.json({ data: await createSubscription(tx, principal.ownerId, await readJson(request, subscriptionSchema), new Date()) }, { status: 201 }),
  { idempotent: true },
);
