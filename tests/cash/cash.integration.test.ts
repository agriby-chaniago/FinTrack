// S14 (PRD v0.19): Tunai joins the DANA settlement pool. Withdrawals are not
// recorded; the wallet count at each settlement keeps leftover cash out of
// living cost. Uses the August 2026 week fixture (daily income Rp50.000).
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET as getAccounts } from "@/app/api/v1/accounts/route";
import { POST as postConfirmation } from "@/app/api/v1/balance-confirmations/route";
import { POST as postEvent } from "@/app/api/v1/events/route";
import { POST as correct } from "@/app/api/v1/ledger-entries/[id]/corrections/route";
import { GET as getMonth } from "@/app/api/v1/reports/months/[month]/route";
import { POST as closingCorrection } from "@/app/api/v1/settlements/[id]/closing-corrections/route";
import { GET as getSettlement, PATCH as patchSettlement } from "@/app/api/v1/settlements/[id]/route";
import { POST as settleRoute } from "@/app/api/v1/settlements/[id]/settle/route";
import { POST as createSettlement } from "@/app/api/v1/settlements/route";
import { POST as postSpecial } from "@/app/api/v1/special-expenses/route";
import { GET as getTargets } from "@/app/api/v1/transfer-targets/route";
import { POST as postTransfer } from "@/app/api/v1/transfers/route";

import { closeClients, createAuthUser, resetWithConfirmedFixture, testClients, type ConfirmedOwner, type TestUser } from "../helpers/owner";

const clients = testClients();
let user: TestUser;
let owner: ConfirmedOwner;

type Handler = (request: Request, segment?: { params: Promise<Record<string, string>> }) => Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response shapes differ per route
type Body = { data?: any; error?: { code: string; details?: any } };

async function call(handler: Handler, options: { method?: string; body?: unknown; params?: Record<string, string>; ifMatch?: number; query?: string } = {}) {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { authorization: `Bearer ${user.accessToken}` };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (method === "POST" || method === "PUT") headers["idempotency-key"] = randomUUID();
  if (options.ifMatch !== undefined) headers["if-match"] = `"${options.ifMatch}"`;
  const response = await handler(
    new Request(`http://127.0.0.1:3000/api/v1/x${options.query ?? ""}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }),
    { params: Promise.resolve(options.params ?? {}) },
  );
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as Body };
}

async function draft(endDate: string, closing: Record<string, unknown>) {
  const created = await call(createSettlement, { method: "POST", body: { endDate } });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.data.id as string;
  const patched = await call(patchSettlement, {
    method: "PATCH",
    params: { id },
    ifMatch: created.body.data.version,
    body: { closingAt: `${endDate}T21:00:00+07:00`, ...closing },
  });
  return { id, patched };
}

async function settleWeek(endDate: string, closing: Record<string, unknown>) {
  const { id, patched } = await draft(endDate, closing);
  expect(patched.status, JSON.stringify(patched.body)).toBe(200);
  const settled = await call(settleRoute, { method: "POST", params: { id }, ifMatch: patched.body.data.version });
  expect(settled.status, JSON.stringify(settled.body)).toBe(201);
  return { id, view: settled.body.data };
}

async function account(name: string) {
  const { body } = await call(getAccounts);
  return body.data.accounts.find((a: { displayName: string }) => a.displayName === name);
}

const transfer = (sourceAccountId: string, destinationAccountId: string, amount: string, businessDate: string) =>
  call(postTransfer, { method: "POST", body: { sourceAccountId, destinationAccountId, amount, businessDate } });

beforeAll(async () => {
  user = await createAuthUser(clients.authAdmin, "cash");
});

beforeEach(async () => {
  // Cutover Sunday 2 August 2026; daily income Rp50.000 starts Monday 3 August.
  owner = await resetWithConfirmedFixture(clients, user.id, "2026-08-02T20:00:00+07:00");
});

afterAll(async () => {
  await clients.admin`truncate fintrack.app_owner cascade`;
  await clients.authAdmin.auth.admin.deleteUser(user.id);
  await closeClients(clients);
});

/** Week 1 activates Tunai with Rp20.000 in the wallet; week 2 runs with the pool. */
async function twoWeeks() {
  const w1 = await settleWeek("2026-08-09", { closingPhysicalBalance: "110000", startCashTracking: "20000" });
  await transfer(owner.accountIds.daily, owner.accountIds.reserve, "110000", "2026-08-09");
  const tunai = await account("Tunai");

  const vape = await call(postSpecial, {
    method: "POST",
    body: { amount: "25000", newCategoryName: "Vape", sourceAccountId: tunai.id, businessDate: "2026-08-12" },
  });
  expect(vape.status, JSON.stringify(vape.body)).toBe(201);
  // Cash from the BCA ATM is a transfer into the pool; a recorded DANA → Tunai withdrawal is internal.
  expect((await transfer(owner.accountIds.monthly, tunai.id, "100000", "2026-08-13")).status).toBe(201);
  expect((await transfer(owner.accountIds.daily, tunai.id, "50000", "2026-08-14")).status).toBe(201);

  const w2 = await settleWeek("2026-08-16", { closingPhysicalBalance: "60000", cashClosingBalance: "45000" });
  return { w1, w2, tunai, vapeEntryId: vape.body.data.entryId as string };
}

describe("Tunai in the DANA settlement pool", () => {
  it("activates at a settlement without changing that settlement", async () => {
    const w1 = await settleWeek("2026-08-09", { closingPhysicalBalance: "110000", startCashTracking: "20000" });
    expect(w1.view.asSettled).toMatchObject({ livingExpense: "240000", cashTracked: false, cashActivated: "20000" });
    const tunai = await account("Tunai");
    // Tunai's badge follows the DANA week (overdue here, because the fixture is in the past).
    expect(tunai).toMatchObject({ physical: "20000", personal: "20000", status: (await account("DANA")).status, openWeekDisclosure: true });
  });

  it("keeps leftover cash out of living cost and nets internal transfers", async () => {
    const { w2, tunai } = await twoWeeks();
    // 110.000 + 20.000 + 350.000 + 100.000 − 110.000 − 25.000 − 60.000 − 45.000 = 340.000
    expect(w2.view.asSettled).toMatchObject({
      cashTracked: true,
      openingPersonal: "110000",
      cashOpeningPersonal: "20000",
      recognizedIncome: "350000",
      transfersIn: "100000",
      transfersOut: "110000",
      nonLivingDeductions: "25000",
      closingPersonal: "60000",
      cashClosingPhysical: "45000",
      livingExpense: "340000",
      averagePerDay: "48571",
    });
    expect((await account("Tunai")).physical).toBe("45000");
    expect(tunai.id).toBeTruthy();

    // The reserve suggestion comes from DANA only; the wallet is never suggested for transfer.
    const targets = (await call(getTargets)).body.data;
    const week2 = targets.find((t: { contextKey: string }) => t.contextKey === w2.id);
    expect(week2.version.amount).toBe("60000");
  });

  it("settles a draft created in one request with the wallet count, as the UI does", async () => {
    await settleWeek("2026-08-09", { closingPhysicalBalance: "110000", startCashTracking: "20000" });
    const created = await call(createSettlement, {
      method: "POST",
      body: { endDate: "2026-08-16", closingPhysicalBalance: "300000", closingAt: "2026-08-16T21:00:00+07:00", cashClosingBalance: "30000" },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const settled = await call(settleRoute, { method: "POST", params: { id: created.body.data.id }, ifMatch: created.body.data.version });
    expect(settled.status, JSON.stringify(settled.body)).toBe(201);
    expect(settled.body.data.asSettled).toMatchObject({ cashTracked: true, cashClosingPhysical: "30000" });
    expect((await account("Tunai")).physical).toBe("30000");
  });

  it("requires the wallet count once Tunai is tracked and refuses a second activation", async () => {
    await twoWeeks();
    const { id, patched } = await draft("2026-08-23", { closingPhysicalBalance: "80000" });
    expect(patched.status).toBe(200);
    expect((await call(getSettlement, { params: { id } })).body.data).toMatchObject({ cash: { tracked: true, canStart: false }, preview: null });
    const refused = await call(settleRoute, { method: "POST", params: { id }, ifMatch: patched.body.data.version });
    expect(refused.body.error?.details?.issues).toContain("CASH_CLOSING_REQUIRED");

    const again = await call(patchSettlement, {
      method: "PATCH",
      params: { id },
      ifMatch: patched.body.data.version,
      body: { closingPhysicalBalance: "80000", closingAt: "2026-08-23T21:00:00+07:00", startCashTracking: "1000" },
    });
    expect(again.body.error?.details?.issues).toContain("CASH_ALREADY_TRACKED");
  });

  it("treats Tunai like DANA: special expense only, confirmed only by settlement", async () => {
    const { tunai } = await twoWeeks();
    const expense = await call(postEvent, { method: "POST", body: { direction: "EXPENSE", accountId: tunai.id, amount: "1000", businessDate: "2026-08-18" } });
    expect(expense.body.error?.details?.issues).toContain("USE_SPECIAL_EXPENSE_FOR_WEEKLY_ACCOUNT");
    const confirm = await call(postConfirmation, { method: "POST", body: { accountId: tunai.id, physicalBalance: "1000" } });
    expect(confirm.body.error?.details?.issues).toContain("USE_SETTLEMENT_FOR_WEEKLY_ACCOUNT");
    const income = await call(postEvent, { method: "POST", body: { direction: "INCOME", accountId: tunai.id, amount: "5000", businessDate: "2026-08-18" } });
    expect(income.status).toBe(201);
  });

  it("corrects settled Tunai history and the wallet count without moving the anchored balance", async () => {
    const { w2, vapeEntryId } = await twoWeeks();
    const corrected = await call(correct, {
      method: "POST",
      params: { id: vapeEntryId },
      body: { action: "REPLACE", amount: "35000", businessDate: "2026-08-12" },
    });
    expect(corrected.body.data).toMatchObject({ mode: "SETTLED_HISTORY" });
    let detail = (await call(getSettlement, { params: { id: w2.id } })).body.data;
    expect(detail.asSettled.livingExpense).toBe("340000");
    expect(detail.corrected).toMatchObject({ nonLivingDeductions: "35000", livingExpense: "330000" });
    expect((await account("Tunai")).physical).toBe("45000");

    const replaced = await call(closingCorrection, { method: "POST", params: { id: w2.id }, body: { closingCashBalance: "50000" } });
    expect(replaced.status, JSON.stringify(replaced.body)).toBe(201);
    detail = replaced.body.data;
    expect(detail).toMatchObject({ hasCorrections: true, cash: { tracked: true, closingPhysicalBalance: "50000" } });
    expect(detail.corrected).toMatchObject({ cashClosingPhysical: "50000", livingExpense: "325000" });
    expect((await account("Tunai")).physical).toBe("50000");
  });

  it("reports pool living cost and keeps Tunai in personal cash", async () => {
    await twoWeeks();
    const report = (await call(getMonth, { params: { month: "2026-08" }, query: "?view=corrected" })).body.data;
    // Weeks 1–2 settled: 240.000 + 340.000; special expense from the wallet stays special.
    expect(report.outflow).toMatchObject({ living: "580000", special: "25000" });
    const accounts = (await call(getAccounts)).body.data.accounts.map((a: { displayName: string }) => a.displayName);
    expect(accounts).toEqual(["Jago", "BCA", "DANA", "Tunai"]);
  });
});
