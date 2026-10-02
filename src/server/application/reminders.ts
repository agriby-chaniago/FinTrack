// Daily Telegram digest (PRD v0.20 P6) for the bound owner. The route has no
// session, so the owner's Auth user id comes from a narrow SECURITY DEFINER
// function and the work runs in normal owner transactions under RLS.
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
 * Sends today's Perlu dilakukan titles at most once per business date. One short
 * transaction checks the date and builds the text; Telegram is called with no
 * transaction open; the date is recorded once Telegram has accepted the message.
 * A failed send records nothing, so the next run retries. The workflow never runs
 * two digests at once (concurrency group), so a run cannot race another.
 */
export async function deliverDailyDigest(db: RuntimeDb, now: Date, origin: string, send: (text: string) => Promise<void>): Promise<DigestOutcome> {
  const [binding] = await sqlRows<{ sub: string | null }>(db, sql`select fintrack.reminder_owner_auth_user_id() as sub`);
  if (!binding?.sub) return "NO_OWNER";
  const claims = { sub: binding.sub };
  const today = businessDateOf(now);
  const prepared = await withOwnerDb(db, claims, async (tx, { ownerId }): Promise<{ outcome: DigestOutcome } | { text: string }> => {
    const [earlier] = await tx
      .select({ businessDate: reminderDelivery.businessDate })
      .from(reminderDelivery)
      .where(and(eq(reminderDelivery.ownerId, ownerId), eq(reminderDelivery.businessDate, today)));
    if (earlier) return { outcome: "ALREADY_SENT" };
    const data = await dashboard(tx, ownerId, now);
    if (data.tasks.length === 0) return { outcome: "NOTHING_DUE" };
    const accountName = (id: string) => data.accounts.find((a) => a.id === id)?.displayName ?? "akun";
    return { text: digestText(data.tasks, accountName, origin) };
  });
  if ("outcome" in prepared) return prepared.outcome;
  await send(prepared.text);
  await withOwnerDb(db, claims, (tx, { ownerId }) => tx.insert(reminderDelivery).values({ ownerId, businessDate: today }).onConflictDoNothing());
  return "SENT";
}
