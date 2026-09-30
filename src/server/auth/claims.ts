import { ApiError } from "@/server/api/errors";
import type { VerifiedClaims } from "@/server/db/owner";

/** Verifies a Supabase access token and returns its claims, or null if invalid. */
export type TokenVerifier = (token: string) => Promise<Record<string, unknown> | null>;

/** Returns verified claims for the cookie session, or null when there is no session. */
export type CookieSessionVerifier = () => Promise<Record<string, unknown> | null>;

export type CredentialSources = {
  readonly authorizationHeader: string | null;
  readonly hasCookieSession: boolean;
  readonly verifyToken: TokenVerifier;
  readonly verifyCookieSession: CookieSessionVerifier;
};

function toVerifiedClaims(claims: Record<string, unknown> | null): VerifiedClaims | null {
  if (!claims || typeof claims.sub !== "string" || claims.sub.length === 0) return null;
  return { ...claims, sub: claims.sub };
}

/**
 * Normalises the website cookie session and a future mobile Bearer token into
 * one principal. Invalid credentials and conflicting identities are rejected.
 */
export async function resolveVerifiedClaims(sources: CredentialSources): Promise<VerifiedClaims> {
  let bearerClaims: VerifiedClaims | null = null;

  if (sources.authorizationHeader !== null) {
    const match = /^Bearer\s+(\S+)$/.exec(sources.authorizationHeader);
    if (!match) throw new ApiError("INVALID_IDENTITY");
    bearerClaims = toVerifiedClaims(await sources.verifyToken(match[1]));
    if (!bearerClaims) throw new ApiError("INVALID_IDENTITY");
  }

  let cookieClaims: VerifiedClaims | null = null;
  if (sources.hasCookieSession) {
    cookieClaims = toVerifiedClaims(await sources.verifyCookieSession());
  }

  if (bearerClaims && cookieClaims && bearerClaims.sub !== cookieClaims.sub) {
    throw new ApiError("AMBIGUOUS_IDENTITY");
  }

  const claims = bearerClaims ?? cookieClaims;
  if (!claims) throw new ApiError("INVALID_IDENTITY");
  return claims;
}
