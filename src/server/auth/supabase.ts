import { createServerClient, parseCookieHeader, type CookieMethodsServer } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { CookieSessionVerifier, TokenVerifier } from "./claims";

function publicConfig(): { url: string; publishableKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required");
  }
  return { url, publishableKey };
}

/** Server-side Supabase Auth client bound to a cookie store. Uses the publishable key only. */
export function createSupabaseServerClient(cookies: CookieMethodsServer): SupabaseClient {
  const { url, publishableKey } = publicConfig();
  return createServerClient(url, publishableKey, { cookies });
}

export type CookieToSet = { name: string; value: string; options: Parameters<NonNullable<CookieMethodsServer["setAll"]>>[0][number]["options"] };

/**
 * Cookie adapter for Route Handlers that reads the request `Cookie` header and
 * collects refreshed cookies so the caller can attach them to its response.
 */
export function requestCookieStore(request: Request): { methods: CookieMethodsServer; pending: CookieToSet[] } {
  const pending: CookieToSet[] = [];
  const methods: CookieMethodsServer = {
    getAll: () => parseCookieHeader(request.headers.get("cookie") ?? ""),
    setAll: (cookiesToSet) => {
      pending.push(...cookiesToSet);
    },
  };
  return { methods, pending };
}

/** True when the request carries a Supabase auth cookie (possibly chunked). */
export function hasSupabaseAuthCookie(cookieNames: Iterable<string>): boolean {
  for (const name of cookieNames) {
    if (/^sb-.+-auth-token(\.\d+)?$/.test(name)) return true;
  }
  return false;
}

export function tokenVerifier(client: SupabaseClient): TokenVerifier {
  return async (token) => {
    const { data, error } = await client.auth.getClaims(token);
    return error || !data ? null : (data.claims as Record<string, unknown>);
  };
}

export function cookieSessionVerifier(client: SupabaseClient): CookieSessionVerifier {
  return async () => {
    const { data, error } = await client.auth.getClaims();
    return error || !data ? null : (data.claims as Record<string, unknown>);
  };
}
