import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { appOrigin } from "@/server/app-origin";
import { createSupabaseClientFromNextCookies } from "@/server/auth/next-cookies";

// Exact allowlist: the callback never redirects to an arbitrary URL.
const allowedNext = new Set(["/", "/reset-password"]);
const allowedOtpTypes = new Set<EmailOtpType>(["invite", "recovery"]);

/**
 * Verifies invitation and password-recovery links (token_hash) and PKCE codes,
 * then redirects to an allowlisted page inside this origin.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const nextParam = searchParams.get("next") ?? "/";
  const next = allowedNext.has(nextParam) ? nextParam : "/";
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  const supabase = await createSupabaseClientFromNextCookies();
  let ok = false;

  if (tokenHash && type && allowedOtpTypes.has(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  // Redirect only within the configured app origin so the session cookie that
  // was just set is sent back on the next request.
  const origin = appOrigin();
  const target = ok ? new URL(next, origin) : new URL("/login?error=link", origin);
  const response = NextResponse.redirect(target);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
