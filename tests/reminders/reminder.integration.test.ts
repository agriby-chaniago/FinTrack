// S18: the daily Telegram digest (PRD v0.20 P6).
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { deliverDailyDigest } from "@/server/application/reminders";
import { sqlRows } from "@/server/db/rows";

import { closeClients, createAuthUser, resetWithConfirmedFixture, testClients, type TestUser } from "../helpers/owner";

const clients = testClients();
let user: TestUser;

function daysAgoIso(n: number): string {
  const today = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date())}T00:00:00Z`);
  return new Date(today.getTime() - n * 86_400_000).toISOString().slice(0, 10);
}

beforeAll(async () => {
  user = await createAuthUser(clients.authAdmin, "reminder");
  // Cutover three days ago leaves this month's income and obligations pending.
  await resetWithConfirmedFixture(clients, user.id, `${daysAgoIso(3)}T20:00:00+07:00`);
}, 120_000);

afterAll(async () => {
  await clients.admin`truncate fintrack.app_owner cascade`;
  await clients.authAdmin.auth.admin.deleteUser(user.id);
  await closeClients(clients);
});

describe("reminder owner lookup and delivery log", () => {
  it("returns the bound owner's Auth user id to the runtime role", async () => {
    const rows = await sqlRows<{ sub: string | null }>(clients.runtime, sql`select fintrack.reminder_owner_auth_user_id() as sub`);
    expect(rows[0].sub).toBe(user.id);
  });

  it("keeps delivery rows invisible without owner claims", async () => {
    const rows = await sqlRows<{ n: string }>(clients.runtime, sql`select count(*)::text as n from fintrack.reminder_delivery`);
    expect(rows[0].n).toBe("0");
  });
});

describe("deliverDailyDigest", () => {
  const origin = "https://fintrack.example";
  const now = new Date();

  it("sends today's tasks once and records the business date", async () => {
    const sent: string[] = [];
    expect(await deliverDailyDigest(clients.runtime, now, origin, async (text) => void sent.push(text))).toBe("SENT");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Konfirmasi income bulanan");
    expect(sent[0]).not.toContain("Rp");
  });

  it("a second run the same day sends nothing", async () => {
    const sent: string[] = [];
    expect(await deliverDailyDigest(clients.runtime, now, origin, async (text) => void sent.push(text))).toBe("ALREADY_SENT");
    expect(sent).toHaveLength(0);
  });

  it("a failed send leaves no record", async () => {
    const tomorrow = new Date(now.getTime() + 86_400_000);
    await expect(
      deliverDailyDigest(clients.runtime, tomorrow, origin, async () => {
        throw new Error("telegram down");
      }),
    ).rejects.toThrow("telegram down");
    const sent: string[] = [];
    expect(await deliverDailyDigest(clients.runtime, tomorrow, origin, async (text) => void sent.push(text))).toBe("SENT");
    expect(sent).toHaveLength(1);
  });

  it("no bound owner", async () => {
    await clients.admin`update fintrack.app_owner set auth_user_id = null`;
    try {
      expect(await deliverDailyDigest(clients.runtime, now, origin, async () => {})).toBe("NO_OWNER");
    } finally {
      await clients.admin`update fintrack.app_owner set auth_user_id = ${user.id}`;
    }
  });
});
