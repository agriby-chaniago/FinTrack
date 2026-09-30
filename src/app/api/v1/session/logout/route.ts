import { serializeCookieHeader } from "@supabase/ssr";

import { ApiError, noStoreHeaders, toErrorResponse } from "@/server/api/errors";
import { createSupabaseServerClient, requestCookieStore } from "@/server/auth/supabase";

type Scope = "local" | "global";

async function readScope(request: Request): Promise<Scope> {
  const body: unknown = await request.json().catch(() => ({}));
  const scope = (body as { scope?: unknown }).scope ?? "local";
  if (scope !== "local" && scope !== "global") {
    throw new ApiError("VALIDATION_FAILED", { field: "scope", allowed: ["local", "global"] });
  }
  return scope;
}

/**
 * Ends the session on this device (`local`) or on every device (`global`).
 * Works for the website cookie session and for a Bearer access token.
 * Logging out does not require owner authorization.
 */
export async function POST(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    const scope = await readScope(request);
    const store = requestCookieStore(request);
    const client = createSupabaseServerClient(store.methods);

    const authorization = request.headers.get("authorization");
    const bearer = authorization?.match(/^Bearer\s+(\S+)$/)?.[1];
    if (bearer) {
      await logoutWithAccessToken(bearer, scope);
    }
    // Clears the cookie session (if any) and asks Supabase Auth to revoke it.
    await client.auth.signOut({ scope });

    const response = new Response(null, { status: 204, headers: { ...noStoreHeaders, "X-Request-Id": requestId } });
    for (const { name, value, options } of store.pending) {
      response.headers.append("Set-Cookie", serializeCookieHeader(name, value, options));
    }
    return response;
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}

async function logoutWithAccessToken(accessToken: string, scope: Scope): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const apikey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !apikey) throw new Error("Supabase public configuration is missing");
  await fetch(`${url}/auth/v1/logout?scope=${scope}`, {
    method: "POST",
    headers: { apikey, Authorization: `Bearer ${accessToken}` },
  });
}
