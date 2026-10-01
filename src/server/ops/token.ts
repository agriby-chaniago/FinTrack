import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time comparison of a provided bearer token with the configured one. */
export function tokensMatch(provided: string, expected: string): boolean {
  // Hash both values so the comparison is constant-time regardless of length.
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
