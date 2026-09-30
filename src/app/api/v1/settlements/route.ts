import { readJson } from "@/server/api/body";
import { ownerRoute } from "@/server/api/owner-route";
import { etag } from "@/server/api/preconditions";
import { createSettlementDraft, createSettlementSchema, listSettlements } from "@/server/application/settlement";

export const GET = ownerRoute(async ({ tx, principal }) => Response.json({ data: await listSettlements(tx, principal.ownerId) }));

/** Starts the draft for the next contiguous period. */
export const POST = ownerRoute(
  async ({ request, tx, principal }) => {
    const input = await readJson(request, createSettlementSchema);
    const row = await createSettlementDraft(tx, principal.ownerId, input, new Date());
    return Response.json({ data: { id: row.id, version: row.version } }, { status: 201, headers: { ETag: etag(row.version) } });
  },
  { idempotent: true },
);
