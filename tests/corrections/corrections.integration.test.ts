// Regression proof for the financial correction failures reproduced by the QA audit.
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { toIdrDecimal } from "@/lib/money";
import { ApiError } from "@/server/api/errors";
import { listActivity } from "@/server/application/activity";
import { correctEntry } from "@/server/application/corrections";
import { createOrReuseCategory, recordOtherEvent, recordSpecialExpense } from "@/server/application/events";
import { readExportSnapshot } from "@/server/application/export";
import { readExportAnalysis } from "@/server/application/export-analysis";
import { recordExternalMovement } from "@/server/application/external-funds";
import { accountBalances, lockLedger } from "@/server/application/ledger";
import { monthReport } from "@/server/application/reports";
import { createSettlementDraft, settle, settlementView } from "@/server/application/settlement";
import { recordTransfer } from "@/server/application/transfers";
import { createRuntimeDb } from "@/server/db/client";
import type { AuthPrincipal, OwnerTx } from "@/server/db/owner";

import { asOwner, closeClients, createAuthUser, resetWithConfirmedFixture, testClients, type ConfirmedOwner, type TestUser } from "../helpers/owner";

const clients = testClients();
// A held ledger lock and two independent correction transactions need three connections.
const db = createRuntimeDb(process.env.DATABASE_URL!, { max: 5 });
let user: TestUser;
let owner: ConfirmedOwner;
const run = <T>(work: (tx: OwnerTx, principal: AuthPrincipal) => Promise<T>) => asOwner(db, user.id, work);

beforeAll(async () => { user = await createAuthUser(clients.authAdmin, "correction-regression"); });
beforeEach(async () => { owner = await resetWithConfirmedFixture(clients, user.id, "2026-08-02T20:00:00+07:00"); });
afterAll(async () => {
  await clients.admin`truncate fintrack.app_owner cascade`;
  if (user) await clients.authAdmin.auth.admin.deleteUser(user.id);
  await db.$client.end();
  await closeClients(clients);
});

async function expense(amount = "10000", businessDate = "2026-08-05") {
  const result = await run((tx, p) => recordSpecialExpense(tx, p.ownerId, {
    amount, businessDate, sourceAccountId: owner.accountIds.daily, newCategoryName: "Kategori A",
  }, new Date()));
  if (!result.recorded) throw new Error("Fixture expense was not posted");
  return result.entryId;
}

async function settleFirst() {
  return run(async (tx, p) => {
    const draft = await createSettlementDraft(tx, p.ownerId, {
      endDate: "2026-08-09", closingPhysicalBalance: "110000", closingAt: "2026-08-09T21:00:00+07:00",
    }, new Date());
    return settle(tx, p.ownerId, draft.id, draft.version, new Date());
  });
}

async function dailyPhysical() {
  return run(async (tx, p) => (await accountBalances(tx, p.ownerId)).accounts.find((a) => a.id === owner.accountIds.daily)!.physical);
}

async function categoryTotals() {
  const report = await run((tx, p) => monthReport(tx, p.ownerId, "2026-08", "corrected", new Date()));
  return { total: report.outflow.special, categories: new Map(report.outflow.specialByCategory.map((c) => [c.name, c.amount])) };
}

it("serializes independent corrections before checking whether the original was already reversed", async () => {
  const original = await run((tx, p) => recordOtherEvent(tx, p.ownerId, {
    direction: "INCOME", accountId: owner.accountIds.reserve, amount: "100000", businessDate: "2026-08-05",
  }, new Date()));
  if (!original.recorded) throw new Error("Fixture income was not posted");

  let release!: () => void;
  let ready!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  const locked = new Promise<void>((resolve) => { ready = resolve; });
  const holder = run(async (tx, p) => { await lockLedger(tx, p.ownerId); ready(); await released; });
  await locked;
  const corrections = Promise.allSettled(["90000", "80000"].map((amount) => run((tx, p) => correctEntry(tx, p.ownerId, original.entryId, {
    action: "REPLACE", amount, businessDate: "2026-08-05",
  }, new Date()))));
  let waiting = 0;
  try {
    for (let attempt = 0; attempt < 200; attempt++) {
      const [row] = await clients.admin<{ count: number }[]>`
        select count(*)::int as count from pg_stat_activity
        where usename = 'fintrack_app' and wait_event = 'advisory'`;
      waiting = row.count;
      if (waiting >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } finally {
    release();
    await holder;
  }
  const results = await corrections;
  expect(waiting, "Both requests must reach the real database lock").toBeGreaterThanOrEqual(2);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
  expect(rejected.reason).toBeInstanceOf(ApiError);
  expect(rejected.reason.details).toEqual({ issues: ["ALREADY_CORRECTED"] });
  const balance = await run(async (tx, p) => (await accountBalances(tx, p.ownerId)).accounts.find((a) => a.id === owner.accountIds.reserve)!.personal);
  expect(["80000", "90000"]).toContain(balance);
});

it("includes a correction of a closing-day expense without shifting cash or the immutable snapshot", async () => {
  const id = await expense("10000", "2026-08-09");
  const settled = await settleFirst();
  const before = await dailyPhysical();
  await run((tx, p) => correctEntry(tx, p.ownerId, id, { action: "REPLACE", amount: "15000", businessDate: "2026-08-09" }, new Date()));
  const view = await run((tx, p) => settlementView(tx, p.ownerId, settled.id));
  expect(view.corrected).toMatchObject({ livingExpense: "225000", nonLivingDeductions: "15000" });
  expect(view.asSettled).toMatchObject({ livingExpense: "230000", nonLivingDeductions: "10000" });
  expect(await dailyPhysical()).toBe(before);
});

it("accepts a category-only settled correction and preserves that category on a later amount correction", async () => {
  const id = await expense();
  const settled = await settleFirst();
  const before = await dailyPhysical();
  const categoryId = await run((tx, p) => createOrReuseCategory(tx, p.ownerId, "Kategori B"));
  await run((tx, p) => correctEntry(tx, p.ownerId, id, { action: "REPLACE", amount: "10000", categoryId, businessDate: "2026-08-05" }, new Date()));
  let totals = await categoryTotals();
  expect(totals.categories.get("Kategori A") ?? "0").toBe("0");
  expect(totals.categories.get("Kategori B")).toBe("10000");
  expect(await dailyPhysical()).toBe(before);

  await run((tx, p) => correctEntry(tx, p.ownerId, id, { action: "REPLACE", amount: "12000", businessDate: "2026-08-05" }, new Date()));
  totals = await categoryTotals();
  expect(totals.total).toBe("12000");
  expect(totals.categories.get("Kategori A") ?? "0").toBe("0");
  expect(totals.categories.get("Kategori B")).toBe("12000");
  expect((await run((tx, p) => settlementView(tx, p.ownerId, settled.id))).asSettled).toMatchObject({ nonLivingDeductions: "10000" });
  expect(await dailyPhysical()).toBe(before);
});

it("reclassifies the full corrected expense in reports and the analysis export, then permits a complete void", async () => {
  const id = await expense("150000");
  await settleFirst();
  const before = await dailyPhysical();
  const categoryId = await run((tx, p) => createOrReuseCategory(tx, p.ownerId, "Kategori B"));
  await run((tx, p) => correctEntry(tx, p.ownerId, id, { action: "REPLACE", amount: "120000", categoryId, businessDate: "2026-08-05" }, new Date()));
  const totals = await categoryTotals();
  expect(totals.total).toBe("120000");
  expect(totals.categories.get("Kategori A") ?? "0").toBe("0");
  expect(totals.categories.get("Kategori B")).toBe("120000");
  const analysis = await run(async (tx, p) => readExportAnalysis(tx, p.ownerId, await readExportSnapshot(tx, p.ownerId), new Date()));
  expect(analysis.failedChecks).toBe(0);
  expect(analysis.rows.filter((row) => row.row_type === "EVENT" && row.parent_id === id && row.aggregation_role === "DETAIL_FLOW"))
    .toEqual([expect.objectContaining({ category: "Kategori B", outflow_effect_idr: "120000" })]);

  await run((tx, p) => correctEntry(tx, p.ownerId, id, { action: "VOID" }, new Date()));
  expect((await categoryTotals()).total).toBe("0");
  expect(await dailyPhysical()).toBe(before);
});

it("keeps the original and current effects accessible after more than twenty settled corrections", async () => {
  const id = await expense();
  await settleFirst();
  for (let i = 1; i <= 21; i++) {
    await run((tx, p) => correctEntry(tx, p.ownerId, id, {
      action: "REPLACE", amount: toIdrDecimal(1_000_000n + BigInt(i) * 10_000n), businessDate: "2026-08-05",
    }, new Date()));
  }
  const thread = await run((tx, p) => listActivity(tx, p.ownerId, { limit: 20, thread: id }));
  expect(thread.items).toHaveLength(22);
  expect(thread.items.find((item) => item.id === id)).toMatchObject({ status: "CORRECTED" });
  expect(thread.nextCursor).toBeNull();
  expect((await categoryTotals()).total).toBe("12100");
});

it("retains a settled transfer's corrected external composition when only its amount is corrected again", async () => {
  await run((tx, p) => recordExternalMovement(tx, p.ownerId, {
    type: "RECEIPT", accountId: owner.accountIds.daily, subjectName: "Adik", amount: "50000", businessDate: "2026-08-03",
  }, new Date()));
  const [subject] = await clients.admin<{ id: string }[]>`select id from fintrack.external_subject where normalized_name = 'adik'`;
  const transfer = await run((tx, p) => recordTransfer(tx, p.ownerId, {
    sourceAccountId: owner.accountIds.daily, destinationAccountId: owner.accountIds.reserve,
    amount: "100000", externalComponents: [{ subjectId: subject.id, amount: "20000" }], businessDate: "2026-08-05",
  }, new Date()));
  if (!transfer.recorded) throw new Error("Fixture transfer was not posted");
  await settleFirst();
  await run((tx, p) => correctEntry(tx, p.ownerId, transfer.entryId, {
    action: "REPLACE", amount: "100000", externalComponents: [{ subjectId: subject.id, amount: "30000" }], businessDate: "2026-08-05",
  }, new Date()));
  await run((tx, p) => correctEntry(tx, p.ownerId, transfer.entryId, { action: "REPLACE", amount: "90000", businessDate: "2026-08-05" }, new Date()));
  const balances = await run((tx, p) => accountBalances(tx, p.ownerId));
  expect(balances.accounts.find((a) => a.id === owner.accountIds.reserve)).toMatchObject({ physical: "90000", external: "30000", personal: "60000" });
  expect(balances.accounts.find((a) => a.id === owner.accountIds.daily)?.external).toBe("20000");
  const report = await run((tx, p) => monthReport(tx, p.ownerId, "2026-08", "corrected", new Date()));
  expect(report.reserve).toMatchObject({ grossSaved: "60000", netGrowth: "60000" });

  await run((tx, p) => correctEntry(tx, p.ownerId, transfer.entryId, { action: "VOID" }, new Date()));
  const voided = await run((tx, p) => monthReport(tx, p.ownerId, "2026-08", "corrected", new Date()));
  expect(voided.reserve).toMatchObject({ grossSaved: "0", netGrowth: "0" });
});
