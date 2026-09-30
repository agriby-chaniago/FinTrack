"use server";

import { revalidatePath } from "next/cache";

/**
 * After any financial change: purges the client cache, including pages
 * prefetched from the navigation, and re-renders the page being viewed, so no
 * screen shows balances from before the change. useMutation calls this, so
 * every form gets it without extra code.
 */
export async function revalidateAppData(): Promise<void> {
  revalidatePath("/", "layout");
}
