import { readJson } from "@/server/api/body";
import { ownerRoute } from "@/server/api/owner-route";
import { getSettings, settingsSchema, updateSettings } from "@/server/application/settings";

export const GET = ownerRoute(async ({ tx, principal }) => Response.json({ data: await getSettings(tx, principal.ownerId) }));

export const PATCH = ownerRoute(async ({ request, tx, principal }) => {
  await updateSettings(tx, principal.ownerId, await readJson(request, settingsSchema));
  return Response.json({ data: await getSettings(tx, principal.ownerId) });
});
