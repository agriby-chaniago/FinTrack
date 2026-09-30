import { ownerRoute } from "@/server/api/owner-route";

/** Returns the authenticated owner principal. */
export const GET = ownerRoute(async ({ principal }) =>
  Response.json({ data: { ownerId: principal.ownerId, authUserId: principal.authUserId } }),
);
