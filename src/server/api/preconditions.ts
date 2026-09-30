import { ApiError } from "./errors";

/** Reads the aggregate version from `If-Match` (`"3"` or `3`). Missing → 428. */
export function requireIfMatchVersion(request: Request): number {
  const header = request.headers.get("if-match");
  if (header === null) throw new ApiError("PRECONDITION_REQUIRED");
  const match = /^"?(\d{1,9})"?$/.exec(header.trim());
  if (!match) throw new ApiError("VALIDATION_FAILED", { header: "If-Match" });
  return Number(match[1]);
}

export function etag(version: number): string {
  return `"${version}"`;
}
