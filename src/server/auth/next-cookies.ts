import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "./supabase";

/**
 * Supabase Auth client for Server Components, Server Functions, and Route
 * Handlers that use the Next.js cookie store.
 */
export async function createSupabaseClientFromNextCookies(): Promise<SupabaseClient> {
  const store = await cookies();
  return createSupabaseServerClient({
    getAll: () => store.getAll(),
    setAll: (cookiesToSet) => {
      try {
        for (const { name, value, options } of cookiesToSet) store.set(name, value, options);
      } catch {
        // Server Components cannot write cookies; proxy.ts refreshes the session instead.
      }
    },
  });
}
