# S18 Telegram Daily Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send the owner one Telegram message per business date at 08:00 `Asia/Jakarta` listing what is in `Perlu dilakukan`, with no amounts, through a token-protected internal route that a GitHub Actions schedule calls.

**Architecture:** The route has no session. A narrow `SECURITY DEFINER` function returns the bound owner's Auth user id, so the route opens a normal `withOwnerDb()` transaction and reads the same `dashboard()` tasks Beranda shows; nothing gets `BYPASSRLS`. A `fintrack.reminder_delivery` row per business date, inserted in the same transaction before sending, makes the digest at most once a day; a failed send rolls it back so the next run can retry. Task titles come from one pure `taskTitle()` that Beranda also uses; the digest text is built by a pure function that never sees an amount it could print.

**Tech Stack:** Next.js 16 route handler (Node runtime), Drizzle migration (generated table plus custom SQL), node-postgres, Vitest (unit and db), GitHub Actions.

**Spec:** `PRD.md` → `Visual refresh dan fitur pasca-MVP (v0.20)` → P6 (LOCKED). Roadmap design point S18 in `docs/superpowers/plans/2026-10-01-visual-refresh-roadmap.md`.

## Global Constraints

- One-way bot: no webhook, no handling of incoming messages.
- Messages go only to `TELEGRAM_CHAT_ID`. `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `REMINDER_TOKEN` live only in environment secrets; never in the repository, logs, or error bodies (the bot token is part of the Telegram URL, so no URL is ever logged).
- Digest at 08:00 `Asia/Jakarta` = `0 1 * * *` UTC, from GitHub Actions to `POST /api/internal/reminders` with `Authorization: Bearer <REMINDER_TOKEN>`, like keepalive.
- Send only when `Perlu dilakukan` has tasks; content is task titles and a link to `APP_ORIGIN`; no amounts, balances, or external-fund (dana titipan) names.
- At most one digest per business date; a Telegram failure fails the workflow run and does not affect the app.
- The migration that creates `reminder_delivery` also enables RLS, adds its policy, and adds its grants; the function grants `EXECUTE` only to `fintrack_app`.
- Apply the migration to production before pushing code that needs it.

## Review Focus

1. A second run on the same business date must not send again. Pinned in Task 3 (`a second run the same day sends nothing`).
2. A failed Telegram send must leave no delivery record, so the next run retries. Pinned in Task 3 (`a failed send leaves no record`).
3. The digest must never contain an amount, even though tasks carry `remaining` and `expectedAmount`. Pinned in Task 2 (`digestText never prints an amount`).
4. A wrong or missing bearer token must get 401 without touching the database. Pinned in Task 4 (`rejects a wrong token before delivering`).
5. With no bound owner the route must answer 503, not throw. Pinned in Task 3 (`no bound owner`) and Task 4.

---

### Task 1: Migration — owner lookup function and delivery log

**Files:**
- Modify: `src/server/db/schema/platform.ts` (`reminderDelivery`)
- Create: `drizzle/0013_reminder_delivery.sql` (generated, then custom SQL appended), `drizzle/meta/*` (generated)
- Modify: `src/server/application/export.ts` (`excludedTables.reminder_delivery`)
- Test: `tests/reminders/reminder.integration.test.ts`

**Interfaces:**
- Produces: table `fintrack.reminder_delivery(owner_id uuid, business_date date, sent_at timestamptz)`, primary key `(owner_id, business_date)`; Drizzle `reminderDelivery`; SQL function `fintrack.reminder_owner_auth_user_id() returns uuid`.

- [ ] **Step 1: Write the failing integration test**

`tests/reminders/reminder.integration.test.ts`:

```ts
// S18: the daily Telegram digest (PRD v0.20 P6).
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run --project db tests/reminders/reminder.integration.test.ts`
Expected: FAIL (`function fintrack.reminder_owner_auth_user_id() does not exist`).

- [ ] **Step 3: Schema and generated migration**

Append to `src/server/db/schema/platform.ts` (add `date` and `primaryKey` to the `drizzle-orm/pg-core` import):

```ts
/**
 * One row per business date on which the Telegram digest was sent (PRD v0.20 P6:
 * at most one per day). Operational, not financial; excluded from the export.
 */
export const reminderDelivery = fintrack.table(
  "reminder_delivery",
  {
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => appOwner.id),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.businessDate] })],
);
```

Run: `pnpm db:generate --name reminder_delivery`. Check that `drizzle/0013_reminder_delivery.sql` creates only the table, its primary key, and its foreign key.

- [ ] **Step 4: Append the custom SQL to the same migration**

```sql
--> statement-breakpoint
-- The reminder route has no session. This returns the bound owner's Auth user id so
-- the route can open a normal owner transaction (withOwnerDb) instead of bypassing RLS.
CREATE FUNCTION "fintrack"."reminder_owner_auth_user_id"() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = ''
AS $$
  SELECT o.auth_user_id FROM fintrack.app_owner o WHERE o.auth_user_id IS NOT NULL
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "fintrack"."reminder_owner_auth_user_id"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "fintrack"."reminder_owner_auth_user_id"() TO fintrack_app;
--> statement-breakpoint
ALTER TABLE "fintrack"."reminder_delivery" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON "fintrack"."reminder_delivery" TO fintrack_app;
--> statement-breakpoint
CREATE POLICY "reminder_delivery_owner" ON "fintrack"."reminder_delivery" AS PERMISSIVE FOR ALL TO fintrack_app
  USING ("owner_id" = (select fintrack.current_owner_id()))
  WITH CHECK ("owner_id" = (select fintrack.current_owner_id()));
```

Add to `excludedTables` in `src/server/application/export.ts`:

```ts
  reminder_delivery: "Operational log of the dates a Telegram digest was sent; holds no financial data.",
```

- [ ] **Step 5: Migrate and run the tests**

Run: `pnpm db:migrate && pnpm vitest run --project db tests/reminders/reminder.integration.test.ts tests/reports/reports.integration.test.ts`
Expected: PASS (the export registry test still classifies every table).

- [ ] **Step 6: Commit**

```bash
git add src/server/db/schema/platform.ts drizzle src/server/application/export.ts tests/reminders/reminder.integration.test.ts
git commit -m "feat(db): reminder delivery log and owner lookup for the digest route"
```

---

### Task 2: One task-title source and the digest text

**Files:**
- Modify: `src/lib/dashboard-view.ts`, `src/lib/dashboard-view.test.ts` (`taskTitle`)
- Create: `src/lib/reminder-text.ts`, `src/lib/reminder-text.test.ts`
- Modify: `src/app/(app)/page.tsx` (`taskView` uses `taskTitle`)

**Interfaces:**
- Produces: `taskTitle(task: DashboardTaskLike, accountName: (id: string) => string): string` where `DashboardTaskLike` is the structural union of `DashboardTask`; `digestText(tasks: DashboardTaskLike[], accountName: (id: string) => string, origin: string): string`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/dashboard-view.test.ts`:

```ts
describe("taskTitle", () => {
  const name = (id: string) => ({ a1: "BCA" })[id] ?? "akun";
  it("names each task the way Beranda does", () => {
    expect(taskTitle({ type: "SETTLEMENT", mode: "NORMAL" }, name)).toBe("Settlement DANA");
    expect(taskTitle({ type: "CONFIRM_INCOME", name: "Income bulanan" }, name)).toBe("Konfirmasi income bulanan");
    expect(taskTitle({ type: "CONFIRM_OBLIGATION", name: "Langganan" }, name)).toBe("Konfirmasi Langganan");
    expect(taskTitle({ type: "TRANSFER", route: "BCA → Jago" }, name)).toBe("Transfer BCA → Jago");
    expect(taskTitle({ type: "RECONCILE", accountId: "a1" }, name)).toBe("Periksa saldo BCA");
  });
});
```

Before relying on `Settlement DANA` for `NORMAL`, check `settlementModeLabel` in `src/lib/labels.ts`; use what Beranda shows today (the fallback is `Settlement DANA`) and keep the expectation equal to it.

`src/lib/reminder-text.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { digestText } from "./reminder-text";

const name = () => "BCA";
const tasks = [
  { type: "SETTLEMENT" as const, mode: "OVERDUE", periodStart: "2026-09-21", normalEnd: "2026-09-27", draftId: null },
  { type: "CONFIRM_INCOME" as const, cycleKey: "2026-10", occurrenceId: "o1", name: "Income bulanan", label: null, expectedAmount: "750000", expectedDate: null },
  { type: "TRANSFER" as const, targetId: "t1", route: "BCA → Jago", amount: "400000", linked: "0", remaining: "400000", transferNow: "350000", contextKey: "2026-09" },
];

describe("digestText", () => {
  it("lists every task title and the link", () => {
    const text = digestText(tasks, name, "https://fintrack.example");
    expect(text).toContain("Perlu dilakukan (3)");
    expect(text).toContain("• Konfirmasi income bulanan");
    expect(text).toContain("• Transfer BCA → Jago");
    expect(text.trim().endsWith("https://fintrack.example")).toBe(true);
  });

  it("never prints an amount", () => {
    const text = digestText(tasks, name, "https://fintrack.example");
    expect(text).not.toMatch(/Rp|750|400|350/);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run --project unit src/lib/dashboard-view.test.ts src/lib/reminder-text.test.ts`
Expected: FAIL (`taskTitle` not exported; `./reminder-text` not found).

- [ ] **Step 3: Implement**

Append to `src/lib/dashboard-view.ts`:

```ts
type TitledTask =
  | { type: "SETTLEMENT"; mode: string }
  | { type: "CONFIRM_INCOME" | "CONFIRM_OBLIGATION"; name: string }
  | { type: "TRANSFER"; route: string }
  | { type: "RECONCILE"; accountId: string };

/** The one title of a Perlu dilakukan task, for Beranda and the Telegram digest. */
export function taskTitle(task: TitledTask, accountName: (id: string) => string): string {
  switch (task.type) {
    case "SETTLEMENT":
      return settlementModeLabel[task.mode] ?? "Settlement DANA";
    case "CONFIRM_INCOME":
      return `Konfirmasi ${task.name.toLowerCase()}`;
    case "CONFIRM_OBLIGATION":
      return `Konfirmasi ${task.name}`;
    case "TRANSFER":
      return `Transfer ${task.route}`;
    case "RECONCILE":
      return `Periksa saldo ${accountName(task.accountId)}`;
  }
}
```

(import `settlementModeLabel` from `@/lib/labels`). In `src/app/(app)/page.tsx`, make each `taskView` case use `title: taskTitle(task, accountName)` instead of its own title expression.

`src/lib/reminder-text.ts`:

```ts
// Telegram digest text (PRD v0.20 P6): task titles and a link only. It is built
// from titles, never from task amounts, so no amount can reach the message.
import { taskTitle } from "@/lib/dashboard-view";

type DigestTask = Parameters<typeof taskTitle>[0];

export function digestText(tasks: DigestTask[], accountName: (id: string) => string, origin: string): string {
  const lines = tasks.map((task) => `• ${taskTitle(task, accountName)}`);
  return [`FinTrack · Perlu dilakukan (${tasks.length})`, "", ...lines, "", `Buka FinTrack: ${origin}`].join("\n");
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run --project unit && pnpm test:e2e tests/e2e/beranda.spec.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard-view.ts src/lib/dashboard-view.test.ts src/lib/reminder-text.ts src/lib/reminder-text.test.ts 'src/app/(app)/page.tsx'
git commit -m "feat(reminders): one task-title source and the amount-free digest text"
```

---

### Task 3: Deliver the digest at most once per business date

**Files:**
- Create: `src/server/application/reminders.ts`
- Test: `tests/reminders/reminder.integration.test.ts`

**Interfaces:**
- Consumes: `reminderDelivery` (Task 1), `digestText` (Task 2), `dashboard()`.
- Produces: `deliverDailyDigest(db: RuntimeDb, now: Date, origin: string, send: (text: string) => Promise<void>): Promise<"SENT" | "NOTHING_DUE" | "ALREADY_SENT" | "NO_OWNER">`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/reminders/reminder.integration.test.ts` (import `deliverDailyDigest`):

```ts
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
    await expect(deliverDailyDigest(clients.runtime, tomorrow, origin, async () => { throw new Error("telegram down"); })).rejects.toThrow("telegram down");
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
```

If unbinding conflicts with a constraint on `app_owner`, use the bootstrap helper the auth tests use to unbind and rebind, and record a ruling.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run --project db tests/reminders/reminder.integration.test.ts -t deliverDailyDigest`
Expected: FAIL (`deliverDailyDigest` is not exported).

- [ ] **Step 3: Implement `src/server/application/reminders.ts`**

```ts
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
    // Recorded before sending, in this transaction: a failed send rolls it back for a retry.
    const recorded = await tx.insert(reminderDelivery).values({ ownerId, businessDate: today }).onConflictDoNothing().returning({ businessDate: reminderDelivery.businessDate });
    if (recorded.length === 0) return "ALREADY_SENT";
    const accountName = (id: string) => data.accounts.find((a) => a.id === id)?.displayName ?? "akun";
    await send(digestText(data.tasks, accountName, origin));
    return "SENT";
  });
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run --project db tests/reminders/reminder.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/application/reminders.ts tests/reminders/reminder.integration.test.ts
git commit -m "feat(reminders): deliver the daily digest at most once per business date"
```

---

### Task 4: Token-protected route, Telegram sender, and the schedule

**Files:**
- Create: `src/server/ops/reminder.ts`, `src/server/ops/reminder.test.ts`
- Create: `src/server/ops/telegram.ts`, `src/server/ops/telegram.test.ts`
- Create: `src/app/api/internal/reminders/route.ts`
- Create: `.github/workflows/telegram-reminder.yml`
- Modify: `.env.example` (`TELEGRAM_BOT_TOKEN=`, `TELEGRAM_CHAT_ID=`, `REMINDER_TOKEN=`)

**Interfaces:**
- Produces: `handleReminder(request: Request, deps: { environment: string | undefined; expectedToken: string | undefined; deliver: () => Promise<DigestOutcome> }): Promise<Response>`; `telegramSender(token: string | undefined, chatId: string | undefined, fetchImpl?: typeof fetch): (text: string) => Promise<void>`.

- [ ] **Step 1: Write the failing unit tests**

`src/server/ops/reminder.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { handleReminder } from "./reminder";

const request = (token?: string) => new Request("https://fintrack.example/api/internal/reminders", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {} });
const deps = (deliver = vi.fn(async () => "SENT" as const)) => ({ environment: "production", expectedToken: "secret-token", deliver });

describe("handleReminder", () => {
  it("is unavailable outside production", async () => {
    expect((await handleReminder(request("secret-token"), { ...deps(), environment: "preview" })).status).toBe(404);
  });

  it("rejects a wrong token before delivering", async () => {
    const d = deps();
    expect((await handleReminder(request("nope"), d)).status).toBe(401);
    expect((await handleReminder(request(), d)).status).toBe(401);
    expect(d.deliver).not.toHaveBeenCalled();
  });

  it("reports the outcome", async () => {
    const response = await handleReminder(request("secret-token"), deps());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { status: "SENT" } });
  });

  it("answers 503 without a bound owner and 502 when Telegram fails", async () => {
    expect((await handleReminder(request("secret-token"), deps(vi.fn(async () => "NO_OWNER" as const)))).status).toBe(503);
    const failing = vi.fn(async () => {
      throw new Error("TELEGRAM_500");
    });
    const response = await handleReminder(request("secret-token"), deps(failing));
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("api.telegram.org");
  });

  it("needs a configured token", async () => {
    expect((await handleReminder(request("x"), { ...deps(), expectedToken: undefined })).status).toBe(500);
  });
});
```

`src/server/ops/telegram.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { telegramSender } from "./telegram";

describe("telegramSender", () => {
  it("posts the text to the configured chat without link previews", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await telegramSender("123:abc", "42", fetchImpl as unknown as typeof fetch)("halo");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    expect(JSON.parse(String(init.body))).toEqual({ chat_id: "42", text: "halo", disable_web_page_preview: true });
  });

  it("throws a code that carries neither the token nor the URL", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 401 }));
    await expect(telegramSender("123:abc", "42", fetchImpl as unknown as typeof fetch)("halo")).rejects.toThrow(/^TELEGRAM_401$/);
    await expect(telegramSender(undefined, "42")("halo")).rejects.toThrow("TELEGRAM_NOT_CONFIGURED");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run --project unit src/server/ops/reminder.test.ts src/server/ops/telegram.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`src/server/ops/telegram.ts`:

```ts
// One-way Telegram delivery (PRD v0.20 P6). The bot token is part of the URL, so
// errors carry only a status code and nothing here logs the request.
export function telegramSender(token: string | undefined, chatId: string | undefined, fetchImpl: typeof fetch = fetch) {
  return async (text: string): Promise<void> => {
    if (!token || !chatId) throw new Error("TELEGRAM_NOT_CONFIGURED");
    let response: Response;
    try {
      response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error("TELEGRAM_UNREACHABLE");
    }
    if (!response.ok) throw new Error(`TELEGRAM_${response.status}`);
  };
}
```

`src/server/ops/reminder.ts` (reuse the keepalive token comparison by moving `tokensMatch` into a shared `src/server/ops/token.ts` that both import):

```ts
import type { DigestOutcome } from "@/server/application/reminders";

import { tokensMatch } from "./token";

const noStore = { "Cache-Control": "no-store" } as const;
const error = (status: number, code: string) => Response.json({ error: { code } }, { status, headers: noStore });

/** POST /api/internal/reminders: token-protected trigger for the daily digest. */
export async function handleReminder(request: Request, deps: { environment: string | undefined; expectedToken: string | undefined; deliver: () => Promise<DigestOutcome> }): Promise<Response> {
  if (deps.environment !== "production") return error(404, "NOT_AVAILABLE");
  if (!deps.expectedToken) return error(500, "REMINDER_NOT_CONFIGURED");
  const match = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "");
  if (!match || !tokensMatch(match[1], deps.expectedToken)) return error(401, "INVALID_REMINDER_TOKEN");
  let outcome: DigestOutcome;
  try {
    outcome = await deps.deliver();
  } catch {
    return error(502, "DIGEST_NOT_SENT");
  }
  if (outcome === "NO_OWNER") return error(503, "APP_NOT_INITIALIZED");
  return Response.json({ data: { status: outcome } }, { status: 200, headers: noStore });
}
```

`src/app/api/internal/reminders/route.ts`:

```ts
import { deliverDailyDigest } from "@/server/application/reminders";
import { getRuntimeDb } from "@/server/db/client";
import { handleReminder } from "@/server/ops/reminder";
import { telegramSender } from "@/server/ops/telegram";

// Operational trigger for the daily Telegram digest (PRD v0.20 P6), called by the
// GitHub Actions schedule. It never accepts owner credentials.
export async function POST(request: Request): Promise<Response> {
  return handleReminder(request, {
    environment: process.env.VERCEL_ENV,
    expectedToken: process.env.REMINDER_TOKEN,
    deliver: () => deliverDailyDigest(getRuntimeDb(), new Date(), process.env.APP_ORIGIN ?? "", telegramSender(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID)),
  });
}
```

`.github/workflows/telegram-reminder.yml`:

```yaml
# Daily Telegram digest (PRD v0.20 P6) at 08:00 Asia/Jakarta (01:00 UTC).
# Enable with variable FINTRACK_REMINDER_ENABLED=true after setting variable
# FINTRACK_REMINDER_URL and secret FINTRACK_REMINDER_TOKEN (same value as Vercel REMINDER_TOKEN).
# No retries: the route records the date before sending, so a rerun never sends twice.
name: Telegram reminder

on:
  schedule:
    - cron: "0 1 * * *"
  workflow_dispatch:

permissions: {}

jobs:
  remind:
    if: vars.FINTRACK_REMINDER_ENABLED == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 3
    steps:
      - name: Ask FinTrack to send today's digest
        shell: bash
        env:
          FINTRACK_REMINDER_URL: ${{ vars.FINTRACK_REMINDER_URL }}
          FINTRACK_REMINDER_TOKEN: ${{ secrets.FINTRACK_REMINDER_TOKEN }}
        run: |
          set -euo pipefail
          if [[ -z "${FINTRACK_REMINDER_URL}" || -z "${FINTRACK_REMINDER_TOKEN}" ]]; then
            echo "::error::Reminder URL or token is missing"
            exit 1
          fi
          if [[ "${FINTRACK_REMINDER_URL}" != https://*/api/internal/reminders ]]; then
            echo "::error::Reminder URL must be the HTTPS reminder endpoint"
            exit 1
          fi
          status="$(curl --proto '=https' --silent --show-error --output reminder.json --write-out '%{http_code}' \
            --connect-timeout 5 --max-time 30 --request POST \
            --header "Authorization: Bearer ${FINTRACK_REMINDER_TOKEN}" "${FINTRACK_REMINDER_URL}")"
          echo "HTTP ${status}: $(cat reminder.json)"
          if [[ "${status}" != "200" ]]; then
            echo "::error::Reminder failed with HTTP ${status}"
            exit 1
          fi
```

Add `TELEGRAM_BOT_TOKEN=`, `TELEGRAM_CHAT_ID=`, and `REMINDER_TOKEN=` (empty) to `.env.example` with a one-line comment.

- [ ] **Step 4: Run the tests and checks**

Run: `pnpm vitest run --project unit && pnpm lint && pnpm typecheck && pnpm build`
Expected: PASS, including the keepalive tests after the token helper moves.

- [ ] **Step 5: Commit**

```bash
git add src/server/ops src/app/api/internal/reminders .github/workflows/telegram-reminder.yml .env.example
git commit -m "feat(reminders): token-protected digest route, Telegram sender, daily schedule"
```

---

### Task 5: Full suite, runbook, and rollout

- [ ] **Step 1:** `pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm build && pnpm test:e2e && pnpm test:e2e:prod` → all green.
- [ ] **Step 2:** Runbook `docs/runbooks/production-and-release.md`: a `Telegram digest` section (Vercel `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `REMINDER_TOKEN` as Sensitive; GitHub secret `FINTRACK_REMINDER_TOKEN`, variables `FINTRACK_REMINDER_URL` and `FINTRACK_REMINDER_ENABLED`; first manual run; how to stop it). `docs/implementation-plan.md` S18 row `Selesai;`; `PRD.md` footer `Slices 0–18 implemented`.
- [ ] **Step 3:** Commit `docs: mark S18 complete`.
- [ ] **Step 4 (rollout, in this order):** migrate staging (`node --env-file=.env.staging.local scripts/migrate.mts`); migrate production with the production admin URL from 1Password (owner signs in to `op` first); then push `main`; generate `REMINDER_TOKEN`, store it in Vercel production and as GitHub secret `FINTRACK_REMINDER_TOKEN`, set `FINTRACK_REMINDER_URL`, redeploy so the route sees the token, set `FINTRACK_REMINDER_ENABLED=true`, and run the workflow once by hand.
