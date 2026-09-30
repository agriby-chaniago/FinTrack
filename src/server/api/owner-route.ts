import { parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";

import { resolveVerifiedClaims } from "@/server/auth/claims";
import {
  cookieSessionVerifier,
  createSupabaseServerClient,
  hasSupabaseAuthCookie,
  requestCookieStore,
  tokenVerifier,
  type CookieToSet,
} from "@/server/auth/supabase";
import { getRuntimeDb, type RuntimeDb } from "@/server/db/client";
import { withOwnerDb, type AuthPrincipal, type OwnerTx, type VerifiedClaims } from "@/server/db/owner";

import { toErrorResponse } from "./errors";

export type OwnerRouteContext = {
  readonly request: Request;
  readonly requestId: string;
  readonly tx: OwnerTx;
  readonly principal: AuthPrincipal;
};

export type OwnerRouteOptions = {
  /** Injected in tests; production uses the process-wide runtime handle. */
  readonly db?: () => RuntimeDb;
};

/** Resolves the verified claims for a Route Handler request (cookie and/or Bearer). */
export async function claimsFromRequest(request: Request, pending: CookieToSet[]): Promise<VerifiedClaims> {
  const store = requestCookieStore(request);
  const client = createSupabaseServerClient(store.methods);
  const cookieNames = parseCookieHeader(request.headers.get("cookie") ?? "").map((cookie) => cookie.name);

  try {
    return await resolveVerifiedClaims({
      authorizationHeader: request.headers.get("authorization"),
      hasCookieSession: hasSupabaseAuthCookie(cookieNames),
      verifyToken: tokenVerifier(client),
      verifyCookieSession: cookieSessionVerifier(client),
    });
  } finally {
    pending.push(...store.pending);
  }
}

function withCookies(response: Response, cookies: CookieToSet[]): Response {
  for (const { name, value, options } of cookies) {
    response.headers.append("Set-Cookie", serializeCookieHeader(name, value, options));
  }
  return response;
}

/**
 * Wraps a protected Route Handler: every request is authenticated, resolved to
 * the owner inside an RLS-aware transaction, and mapped to the JSON error
 * contract on failure. Responses are never cached.
 */
export function ownerRoute(
  handler: (context: OwnerRouteContext) => Promise<Response>,
  options: OwnerRouteOptions = {},
): (request: Request) => Promise<Response> {
  return async (request) => {
    const requestId = crypto.randomUUID();
    const pendingCookies: CookieToSet[] = [];
    try {
      const claims = await claimsFromRequest(request, pendingCookies);
      const db = (options.db ?? getRuntimeDb)();
      const response = await withOwnerDb(db, claims, (tx, principal) =>
        handler({ request, requestId, tx, principal }),
      );
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("X-Request-Id", requestId);
      return withCookies(response, pendingCookies);
    } catch (error) {
      return withCookies(toErrorResponse(error, requestId), pendingCookies);
    }
  };
}
