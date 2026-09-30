// Performance guard (owner report 30 September 2026: pages felt slow). Every
// query is a round trip from Vercel to the Supabase pooler (~3–4 ms), so each
// page loader has a query budget that must not grow with history length.
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PATCH as patchSettlement } from "@/app/api/v1/settlements/[id]/route";
import { POST as settleRoute } from "@/app/api/v1/settlements/[id]/settle/route";
import { POST as createSettlement } from "@/app/api/v1/settlements/route";
import { POST as postTransfer } from "@/app/api/v1/transfers/route";
import { accountsOverview } from "@/server/application/accounts-overview";
import { listActivity } from "@/server/application/activity";
import { dailyIncomeView } from "@/server/application/daily-income";
import { listExternalSubjects } from "@/server/application/external-funds";
import { listMonthlyCycles } from "@/server/application/monthly";
import { listCategories } from "@/server/application/events";
import { listRecurringRules } from "@/server/application/monthly";
import { getOnboardingState } from "@/server/application/onboarding";
import { recordingContext } from "@/server/application/recording-context";
import { getSettings } from "@/server/application/settings";
import { dashboard, settlementHistory } from "@/server/application/reports";
import { settlementRouter } from "@/server/application/settlement";
import { listTargets, transferSuggestions } from "@/server/application/transfers";
import { createRuntimeDb, type RuntimeDb } from "@/server/db/client";
import { withOwnerDb, type OwnerTx } from "@/server/db/owner";

import { closeClients, createAuthUser, resetWithConfirmedFixture, testClients, type ConfirmedOwner, type TestUser } from "../helpers/owner";

const clients = testClients();
let user: TestUser;
let owner: ConfirmedOwner;
let queries = 0;
// Counts every statement the runtime pool sends, including BEGIN and COMMIT.
const db: RuntimeDb = createRuntimeDb(process.env.DATABASE_URL!, { max: 2 });
db.$client.on("connect", (connection) => {
  const query = connection.query.bind(connection) as (...args: unknown[]) => unknown;
  (connection as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
    queries += 1;
    return query(...args);
  };
});

type Handler = (request: Request, segment?: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function call(handler: Handler, method: string, body: unknown, params: Record<string, string> = {}, ifMatch?: number) {
  const headers: Record<string, string> = { authorization: `Bearer ${user.accessToken}`, "content-type": "application/json", "idempotency-key": randomUUID() };
  if (ifMatch !== undefined) headers["if-match"] = `"${ifMatch}"`;
  const response = await handler(new Request("http://127.0.0.1:3000/api/v1/x", { method, headers, body: JSON.stringify(body) }), { params: Promise.resolve(params) });
  const json = (await response.json()) as { data: { id: string; version: number } };
  if (response.status >= 400) throw new Error(JSON.stringify(json));
  return json.data;
}

async function measure(load: (tx: OwnerTx, ownerId: string) => Promise<unknown>): Promise<number> {
  queries = 0;
  await withOwnerDb(db, { sub: user.id }, (tx, principal) => load(tx, principal.ownerId));
  return queries;
}

beforeAll(async () => {
  user = await createAuthUser(clients.authAdmin, "budget");
  // Four months of history: monthly cycles and six settled weeks with transfers.
  owner = await resetWithConfirmedFixture(clients, user.id, "2026-05-31T20:00:00+07:00");
  for (const endDate of ["2026-06-07", "2026-06-14", "2026-06-21", "2026-06-28", "2026-07-05", "2026-07-12"]) {
    const created = await call(createSettlement, "POST", { endDate });
    const patched = await call(patchSettlement, "PATCH", { closingPhysicalBalance: "100000", closingAt: `${endDate}T21:00:00+07:00` }, { id: created.id }, created.version);
    await call(settleRoute, "POST", {}, { id: created.id }, patched.version);
    await call(postTransfer, "POST", { sourceAccountId: owner.accountIds.daily, destinationAccountId: owner.accountIds.reserve, amount: "100000", businessDate: endDate });
  }
}, 240_000);

afterAll(async () => {
  await clients.admin`truncate fintrack.app_owner cascade`;
  await clients.authAdmin.auth.admin.deleteUser(user.id);
  await db.$client.end();
  await closeClients(clients);
});

describe("query budget per page (grows with neither weeks nor months)", () => {
  const now = new Date();
  const pages: [string, number, (tx: OwnerTx, ownerId: string) => Promise<unknown>][] = [
    ["layout", 5, (tx, o) => getOnboardingState(tx, o, now)],
    ["Beranda", 44, (tx, o) => dashboard(tx, o, now)],
    [
      "Rutinitas",
      40,
      async (tx, o) => {
        await listMonthlyCycles(tx, o, now);
        const targets = await listTargets(tx, o);
        await settlementRouter(tx, o, now);
        await settlementHistory(tx, o);
        await transferSuggestions(tx, o, { targets });
        await dailyIncomeView(tx, o, now);
      },
    ],
    ["Akun", 24, async (tx, o) => { await accountsOverview(tx, o, now); await listExternalSubjects(tx, o); }],
    ["Aktivitas", 7, (tx, o) => listActivity(tx, o, { limit: 50 })],
    ["Catat (form context)", 19, (tx, o) => recordingContext(tx, o)],
    [
      "Pengaturan",
      31,
      async (tx, o) => {
        await getSettings(tx, o);
        await dailyIncomeView(tx, o, now);
        await listRecurringRules(tx, o, now);
        await listCategories(tx, o, { includeArchived: true });
        await recordingContext(tx, o);
      },
    ],
  ];
  for (const [name, budget, load] of pages) {
    it(`${name} stays within ${budget} queries`, async () => {
      await measure(load); // first run may create lazy occurrences and targets
      const count = await measure(load);
      console.log(`query budget ${name}: ${count}/${budget}`);
      expect(count).toBeLessThanOrEqual(budget);
    });
  }
});
