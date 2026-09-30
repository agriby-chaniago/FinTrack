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

/** Reads an opaque `If-Match` token such as a snapshot id (`"<uuid>"`). */
export function requireIfMatchToken(request: Request): string {
  const header = request.headers.get("if-match");
  if (header === null) throw new ApiError("PRECONDITION_REQUIRED");
  const match = /^"?([0-9a-f-]{36})"?$/i.exec(header.trim());
  if (!match) throw new ApiError("VALIDATION_FAILED", { header: "If-Match" });
  return match[1].toLowerCase();
}
