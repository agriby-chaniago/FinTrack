import { ApiError } from "@/server/api/errors";
import { getRuntimeDb } from "@/server/db/client";
import { OwnerAccessError, withOwnerDb, type AuthPrincipal, type OwnerTx } from "@/server/db/owner";

import { createSupabaseClientFromNextCookies } from "./next-cookies";

export type PageBlockedStatus = "NO_SESSION" | "NOT_OWNER" | "APP_NOT_INITIALIZED";

export type PageOwnerResult<T> =
  | { readonly status: "OWNER"; readonly principal: AuthPrincipal; readonly value: T }
  | { readonly status: PageBlockedStatus };

/**
 * Owner resolution for Server Components. Runs `work` inside the same
 * RLS-aware owner transaction; pages must load financial data only here.
 */
export async function runAsPageOwner<T>(
  work: (tx: OwnerTx, principal: AuthPrincipal) => Promise<T>,
): Promise<PageOwnerResult<T>> {
  const supabase = await createSupabaseClientFromNextCookies();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (typeof sub !== "string") return { status: "NO_SESSION" };

  try {
    return await withOwnerDb(getRuntimeDb(), { ...data!.claims, sub }, async (tx, principal) => ({
      status: "OWNER" as const,
      principal,
      value: await work(tx, principal),
    }));
  } catch (error) {
    if (error instanceof OwnerAccessError || error instanceof ApiError) {
      if (error.code === "APP_NOT_INITIALIZED") return { status: "APP_NOT_INITIALIZED" };
      if (error.code === "NOT_OWNER") return { status: "NOT_OWNER" };
      return { status: "NO_SESSION" };
    }
    throw error;
  }
}
