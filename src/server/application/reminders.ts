// Daily Telegram digest (PRD v0.20 P6) for the bound owner. The route has no
// session, so the owner's Auth user id comes from a narrow SECURITY DEFINER
// function and the work runs in a normal owner transaction under RLS.
import { and, eq, sql } from "drizzle-orm";

import { businessDateOf } from "@/lib/business-time";
import { digestText } from "@/lib/reminder-text";
import type { RuntimeDb } from "@/server/db/client";
import { withOwnerDb } from "@/server/db/owner";
import { sqlRows } from "@/server/db/rows";
import { reminderDelivery } from "@/server/db/schema/platform";

import { dashboard } from "./reports";

export type DigestOutcome = "SENT" | "NOTHING_DUE" | "ALREADY_SENT" | "NO_OWNER";

/**
 * Sends today's Perlu dilakukan titles at most once per business date. The date
 * is recorded in the same transaction before sending, so a failed send rolls the
 * record back and the next run retries; a successful one is never repeated.
 */
export async function deliverDailyDigest(db: RuntimeDb, now: Date, origin: string, send: (text: string) => Promise<void>): Promise<DigestOutcome> {
  const [binding] = await sqlRows<{ sub: string | null }>(db, sql`select fintrack.reminder_owner_auth_user_id() as sub`);
  if (!binding?.sub) return "NO_OWNER";
  const today = businessDateOf(now);
  return withOwnerDb(db, { sub: binding.sub }, async (tx, { ownerId }) => {
    const [earlier] = await tx
      .select({ businessDate: reminderDelivery.businessDate })
      .from(reminderDelivery)
      .where(and(eq(reminderDelivery.ownerId, ownerId), eq(reminderDelivery.businessDate, today)));
    if (earlier) return "ALREADY_SENT";
    const data = await dashboard(tx, ownerId, now);
    if (data.tasks.length === 0) return "NOTHING_DUE";
    const recorded = await tx.insert(reminderDelivery).values({ ownerId, businessDate: today }).onConflictDoNothing().returning({ businessDate: reminderDelivery.businessDate });
    if (recorded.length === 0) return "ALREADY_SENT";
    const accountName = (id: string) => data.accounts.find((a) => a.id === id)?.displayName ?? "akun";
    await send(digestText(data.tasks, accountName, origin));
    return "SENT";
  });
}
