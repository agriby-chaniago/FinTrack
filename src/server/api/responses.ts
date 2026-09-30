import type { PostResult } from "@/server/application/ledger";

/** 201 when a ledger entry was recorded; 200 when the cutover-day answer skipped it. */
export function postResultResponse(result: PostResult): Response {
  return Response.json({ data: result }, { status: result.recorded ? 201 : 200 });
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | undefined): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}
