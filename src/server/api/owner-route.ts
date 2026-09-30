import { createHash } from "node:crypto";

import { parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";
import { and, eq, sql } from "drizzle-orm";

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
import { idempotencyRecord } from "@/server/db/schema/api";

import { ApiError, toErrorResponse } from "./errors";

export type OwnerRouteContext = {
  readonly request: Request;
  readonly requestId: string;
  readonly tx: OwnerTx;
  readonly principal: AuthPrincipal;
  /** Dynamic route segments, e.g. `{ id }` for `/api/v1/categories/[id]`. */
  readonly params: Record<string, string>;
};

type RouteSegmentContext = { params?: Promise<Record<string, string | string[] | undefined> | undefined> };

export type OwnerRouteOptions = {
  /** Injected in tests; production uses the process-wide runtime handle. */
  readonly db?: () => RuntimeDb;
  /**
   * Financial mutations require an Idempotency-Key. A retry with the same key
   * and body replays the stored response; a different body is rejected.
   */
  readonly idempotent?: boolean;
};

async function runIdempotent(
  context: OwnerRouteContext,
  bodyText: string,
  handler: (context: OwnerRouteContext) => Promise<Response>,
): Promise<Response> {
  const { request, tx, principal } = context;
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key) throw new ApiError("IDEMPOTENCY_KEY_REQUIRED");
  if (key.length < 8 || key.length > 128) throw new ApiError("VALIDATION_FAILED", { header: "Idempotency-Key" });

  const requestHash = createHash("sha256")
    .update(`${request.method} ${new URL(request.url).pathname}\n${bodyText}`)
    .digest("hex");
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`fintrack.idempotency:${principal.ownerId}:${key}`}, 0))`);

  const [existing] = await tx
    .select()
    .from(idempotencyRecord)
    .where(and(eq(idempotencyRecord.ownerId, principal.ownerId), eq(idempotencyRecord.key, key)));
  if (existing) {
    if (existing.requestHash !== requestHash) throw new ApiError("IDEMPOTENCY_KEY_REUSED");
    return Response.json(existing.responseBody, { status: existing.responseStatus, headers: { "Idempotency-Replayed": "true" } });
  }

  const response = await handler(context);
  if (response.ok) {
    const responseBody: unknown = await response.clone().json();
    await tx.insert(idempotencyRecord).values({
      ownerId: principal.ownerId,
      key,
      requestHash,
      responseStatus: response.status,
      responseBody,
    });
  }
  return response;
}

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
): (request: Request, segment?: RouteSegmentContext) => Promise<Response> {
  return async (request, segment) => {
    const requestId = crypto.randomUUID();
    // Static routes receive a segment whose params resolve to undefined.
    const rawParams = (await segment?.params) ?? {};
    const params = Object.fromEntries(
      Object.entries(rawParams).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : [])),
    );
    const pendingCookies: CookieToSet[] = [];
    try {
      const claims = await claimsFromRequest(request, pendingCookies);
      const db = (options.db ?? getRuntimeDb)();
      const bodyText = options.idempotent ? await request.clone().text() : "";
      const response = await withOwnerDb(db, claims, (tx, principal) => {
        const context = { request, requestId, tx, principal, params };
        return options.idempotent ? runIdempotent(context, bodyText, handler) : handler(context);
      });
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("X-Request-Id", requestId);
      return withCookies(response, pendingCookies);
    } catch (error) {
      return withCookies(toErrorResponse(error, requestId), pendingCookies);
    }
  };
}
