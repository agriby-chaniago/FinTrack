import { ownerRoute } from "@/server/api/owner-route";
import { listExternalSubjects } from "@/server/application/external-funds";

/** External subjects with outstanding positions per account. */
export const GET = ownerRoute(async ({ tx, principal }) =>
  Response.json({ data: await listExternalSubjects(tx, principal.ownerId) }),
);
