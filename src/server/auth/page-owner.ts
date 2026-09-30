import { ApiError } from "@/server/api/errors";
import { getRuntimeDb } from "@/server/db/client";
import { OwnerAccessError, withOwnerDb, type AuthPrincipal } from "@/server/db/owner";

import { createSupabaseClientFromNextCookies } from "./next-cookies";

export type PageOwnerState =
  | { readonly status: "OWNER"; readonly principal: AuthPrincipal }
  | { readonly status: "NO_SESSION" | "NOT_OWNER" | "APP_NOT_INITIALIZED" };

/**
 * Owner resolution for Server Components. Pages must call this (or a use case
 * that runs requireOwner) before loading any financial data.
 */
export async function resolvePageOwner(): Promise<PageOwnerState> {
  const supabase = await createSupabaseClientFromNextCookies();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (typeof sub !== "string") return { status: "NO_SESSION" };

  try {
    const principal = await withOwnerDb(getRuntimeDb(), { ...data!.claims, sub }, async (_tx, principal) => principal);
    return { status: "OWNER", principal };
  } catch (error) {
    if (error instanceof OwnerAccessError || error instanceof ApiError) {
      if (error.code === "APP_NOT_INITIALIZED") return { status: "APP_NOT_INITIALIZED" };
      if (error.code === "NOT_OWNER") return { status: "NOT_OWNER" };
      return { status: "NO_SESSION" };
    }
    throw error;
  }
}
