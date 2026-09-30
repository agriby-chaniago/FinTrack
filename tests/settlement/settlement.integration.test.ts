// S7/S8: daily income, weekly DANA settlement, and settled-history corrections,
// using the locked four-week fixture shifted to August 2026 (Monday–Sunday).
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET as getAccounts } from "@/app/api/v1/accounts/route";
import { POST as postTransitions } from "@/app/api/v1/daily-income/[ruleId]/transitions/route";
import { PUT as putOverride } from "@/app/api/v1/daily-income/[ruleId]/overrides/route";
import { GET as getDailyIncome } from "@/app/api/v1/daily-income/route";
import { POST as correct } from "@/app/api/v1/ledger-entries/[id]/corrections/route";
import { POST as closingCorrection } from "@/app/api/v1/settlements/[id]/closing-corrections/route";
import { GET as getSettlement, PATCH as patchSettlement } from "@/app/api/v1/settlements/[id]/route";
import { POST as settleRoute } from "@/app/api/v1/settlements/[id]/settle/route";
import { GET as nextSettlement } from "@/app/api/v1/settlements/next/route";
import { POST as createSettlement } from "@/app/api/v1/settlements/route";
import { POST as postSpecial } from "@/app/api/v1/special-expenses/route";
import { GET as getTargets } from "@/app/api/v1/transfer-targets/route";
import { POST as postTransfer } from "@/app/api/v1/transfers/route";

import { closeClients, createAuthUser, resetWithConfirmedFixture, testClients, type ConfirmedOwner, type TestUser } from "../helpers/owner";

const clients = testClients();
let user: TestUser;
let owner: ConfirmedOwner;
let ruleId: string;

type Handler = (request: Request, segment?: { params: Promise<Record<string, string>> }) => Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response shapes differ per route
type Body = { data?: any; error?: { code: string; details?: any } };

async function call(handler: Handler, options: { method?: string; body?: unknown; params?: Record<string, string>; ifMatch?: number } = {}) {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { authorization: `Bearer ${user.accessToken}` };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (method === "POST" || method === "PUT") headers["idempotency-key"] = randomUUID();
  if (options.ifMatch !== undefined) headers["if-match"] = `"${options.ifMatch}"`;
  const response = await handler(
    new Request("http://127.0.0.1:3000/api/v1/x", { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }),
    { params: Promise.resolve(options.params ?? {}) },
  );
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as Body };
}

async function settleWeek(endDate: string, closing: string) {
  const created = await call(createSettlement, { method: "POST", body: { endDate } });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.data.id as string;
  const patched = await call(patchSettlement, {
    method: "PATCH",
    params: { id },
    ifMatch: created.body.data.version,
    body: { closingPhysicalBalance: closing, closingAt: `${endDate}T21:00:00+07:00` },
  });
  expect(patched.status, JSON.stringify(patched.body)).toBe(200);
  const settled = await call(settleRoute, { method: "POST", params: { id }, ifMatch: patched.body.data.version });
  expect(settled.status, JSON.stringify(settled.body)).toBe(201);
  return { id, view: settled.body.data };
}

const toJago = (amount: string, businessDate: string) =>
  call(postTransfer, {
    method: "POST",
    body: { sourceAccountId: owner.accountIds.daily, destinationAccountId: owner.accountIds.reserve, amount, businessDate },
  });

async function dana() {
  const { body } = await call(getAccounts);
  return body.data.accounts.find((a: { displayName: string }) => a.displayName === "DANA");
}

async function view(id: string) {
  return (await call(getSettlement, { params: { id } })).body.data;
}

beforeAll(async () => {
  user = await createAuthUser(clients.authAdmin, "settlement");
});

beforeEach(async () => {
  // Cutover Sunday 2 August 2026; daily income starts Monday 3 August.
  owner = await resetWithConfirmedFixture(clients, user.id, "2026-08-02T20:00:00+07:00");
  ruleId = (await call(getDailyIncome)).body.data.ruleId;
});

afterAll(async () => {
  await clients.admin`truncate fintrack.app_owner cascade`;
  await clients.authAdmin.auth.admin.deleteUser(user.id);
  await closeClients(clients);
});

describe("locked four-week fixture", () => {
  it("reproduces income, living expense, averages, targets, and transfers", async () => {
    expect((await call(nextSettlement)).body.data).toMatchObject({ mode: "OVERDUE", periodStart: "2026-08-03", normalEnd: "2026-08-09" });

    const w1 = await settleWeek("2026-08-09", "110000");
    expect(w1.view.asSettled).toMatchObject({ recognizedIncome: "350000", livingExpense: "240000", averagePerDay: "34286", availableRemainder: "110000", initialTarget: "110000" });
    await toJago("110000", "2026-08-09");

    // Override Rp0 keeps the rule ACTIVE: 7 eligible days, 6 received.
    await call(putOverride, { method: "PUT", params: { ruleId }, body: { businessDate: "2026-08-12", amount: "0" } });
    const w2 = await settleWeek("2026-08-16", "70000");
    // The Sunday-night sweep is recorded after the closing, so it belongs to week 2's
    // flows: opening Rp110.000 − transfer Rp110.000 equals the PRD's "swept" opening of Rp0.
    expect(w2.view.asSettled).toMatchObject({
      recognizedIncome: "300000",
      eligibleDays: 7,
      receivedDays: 6,
      openingPersonal: "110000",
      transfersOut: "110000",
      livingExpense: "230000",
      averagePerDay: "32857",
    });
    await toJago("70000", "2026-08-16");

    const w3 = await settleWeek("2026-08-23", "80000");
    expect(w3.view.asSettled).toMatchObject({ livingExpense: "270000", averagePerDay: "38571" });
    await toJago("50000", "2026-08-23");
    await toJago("30000", "2026-08-23");

    await call(postTransitions, { method: "POST", params: { ruleId }, body: { toState: "PAUSED", effectiveDate: "2026-08-26" } });
    await call(postTransitions, { method: "POST", params: { ruleId }, body: { toState: "ACTIVE", effectiveDate: "2026-08-28" } });
    const w4 = await settleWeek("2026-08-30", "60000");
    // Average uses settlement calendar days, not income-eligible days.
    expect(w4.view.asSettled).toMatchObject({ recognizedIncome: "250000", eligibleDays: 5, settlementDays: 7, livingExpense: "190000", averagePerDay: "27143" });
    await toJago("60000", "2026-08-30");

    // Transfers after each closing never change the settled week.
    expect((await view(w3.id)).corrected).toMatchObject({ livingExpense: "270000" });
    const { body } = await call(getTargets);
    const dana = body.data.filter((t: { contextType: string }) => t.contextType === "DANA_SETTLEMENT");
    expect(dana.map((t: { progress: string; linked: string }) => [t.progress, t.linked])).toEqual([
      ["FULLY_TRANSFERRED", "110000"],
      ["FULLY_TRANSFERRED", "70000"],
      ["FULLY_TRANSFERRED", "80000"],
      ["FULLY_TRANSFERRED", "60000"],
    ]);
    const total = [w1, w2, w3, w4].reduce((sum, w) => sum + Number(w.view.asSettled.livingExpense), 0);
    expect(total).toBe(930000);
  });

  it("subtracts prior outstanding so an unpaid remainder is not suggested twice", async () => {
    await settleWeek("2026-08-09", "110000");
    const w2 = await settleWeek("2026-08-16", "180000");
    expect(w2.view.asSettled).toMatchObject({ priorOutstanding: "110000", initialTarget: "70000" });
  });
});

describe("settlement rules", () => {
  it("allows a catch-up range only when overdue and rejects nonstandard or future ranges", async () => {
    const bad = await call(createSettlement, { method: "POST", body: { endDate: "2026-08-07" } });
    expect(bad.body.error!.details).toEqual({ issues: ["NONSTANDARD_RANGE"] });
    const future = await call(createSettlement, { method: "POST", body: { endDate: "2099-01-04" } });
    expect(future.body.error!.details).toEqual({ issues: ["END_IN_FUTURE"] });

    const catchUp = await settleWeek("2026-08-20", "500000");
    expect(catchUp.view).toMatchObject({ startDate: "2026-08-03", endDate: "2026-08-20", nonstandard: true });
    expect(catchUp.view.asSettled).toMatchObject({ recognizedIncome: "900000", settlementDays: 18 });
    expect((await call(nextSettlement)).body.data).toMatchObject({ periodStart: "2026-08-21", normalEnd: "2026-08-23" });
  });

  it("warns about unrecorded income when living expense is negative and never clamps", async () => {
    const week = await settleWeek("2026-08-09", "400000");
    expect(week.view.asSettled).toMatchObject({ livingExpense: "-50000", averagePerDay: "-7143" });
    expect(week.view.warnings).toContain("UNRECORDED_INCOME");
  });

  it("keeps a settled settlement immutable even for the runtime role", async () => {
    const week = await settleWeek("2026-08-09", "110000");
    const error = await clients.admin`update fintrack.settlement set end_date = '2026-08-10' where id = ${week.id}`.catch((e: Error) => e);
    expect(String(error)).toMatch(/settled and immutable/);
  });

  it("rejects pause/resume changes inside settled history", async () => {
    await settleWeek("2026-08-09", "110000");
    const result = await call(postTransitions, { method: "POST", params: { ruleId }, body: { toState: "PAUSED", effectiveDate: "2026-08-08" } });
    expect(result.body.error!.details).toEqual({ issues: ["BEFORE_OPEN_PERIOD"] });
  });

  it("shows DANA as the latest closing plus income, and asks for review while overdue", async () => {
    await settleWeek("2026-08-09", "110000");
    await toJago("110000", "2026-08-09");
    const account = await dana();
    expect(account).toMatchObject({ status: "NEEDS_REVIEW", openWeekDisclosure: true, confirmedPersonal: "110000" });
    // Weeks since the closing are unsettled, so income through today is still counted.
    expect(Number(account.personal)).toBeGreaterThan(0);
  });
});

describe("settled-history corrections", () => {
  it("reclassifies a late special expense without counting cash twice", async () => {
    const w1 = await settleWeek("2026-08-09", "110000");
    const before = (await dana()).physical;
    const late = await call(postSpecial, { method: "POST", body: { amount: "20000", newCategoryName: "Kopi", sourceAccountId: owner.accountIds.daily, businessDate: "2026-08-05" } });
    expect(late.status).toBe(201);

    const w1View = await view(w1.id);
    expect(w1View.asSettled.livingExpense).toBe("240000");
    expect(w1View.corrected).toMatchObject({ livingExpense: "220000", nonLivingDeductions: "20000" });
    expect(w1View.hasCorrections).toBe(true);
    expect((await dana()).physical).toBe(before);
  });

  it("uses CORRECTION_POSTING for a settled special expense and keeps the snapshot", async () => {
    const recorded = await call(postSpecial, { method: "POST", body: { amount: "10000", newCategoryName: "Kopi", sourceAccountId: owner.accountIds.daily, businessDate: "2026-08-05" } });
    const w1 = await settleWeek("2026-08-09", "110000");
    expect(w1.view.asSettled).toMatchObject({ livingExpense: "230000", nonLivingDeductions: "10000" });

    const corrected = await call(correct, {
      method: "POST",
      params: { id: recorded.body.data.entryId },
      body: { action: "REPLACE", amount: "15000", businessDate: "2026-08-05" },
    });
    expect(corrected.body.data).toMatchObject({ mode: "SETTLED_HISTORY" });
    expect((await view(w1.id)).corrected).toMatchObject({ livingExpense: "225000", nonLivingDeductions: "15000" });

    const voided = await call(correct, { method: "POST", params: { id: recorded.body.data.entryId }, body: { action: "VOID" } });
    expect(voided.body.data.mode).toBe("SETTLED_HISTORY");
    const w1View = await view(w1.id);
    expect(w1View.corrected).toMatchObject({ livingExpense: "240000", nonLivingDeductions: "0" });
    expect(w1View.asSettled.livingExpense).toBe("230000");
  });

  it("moves a corrected closing balance into the next week's living expense only (one hop)", async () => {
    const w1 = await settleWeek("2026-08-09", "110000");
    await toJago("110000", "2026-08-09");
    const w2 = await settleWeek("2026-08-16", "70000");
    await toJago("70000", "2026-08-16");
    const w3 = await settleWeek("2026-08-23", "80000");

    await call(closingCorrection, { method: "POST", params: { id: w1.id }, body: { closingPhysicalBalance: "100000" } });
    expect((await view(w1.id)).corrected).toMatchObject({ livingExpense: "250000", closingPersonal: "100000" });
    // Week 1 gains Rp10.000 of living cost and week 2 loses it; week 3 is anchored.
    expect((await view(w2.id)).asSettled.livingExpense).toBe("280000");
    expect((await view(w2.id)).corrected).toMatchObject({ openingPersonal: "100000", livingExpense: "270000" });
    expect((await view(w3.id)).corrected).toMatchObject({ livingExpense: "270000" });
    expect((await view(w1.id)).asSettled.livingExpense).toBe("240000");

    const { body } = await call(getTargets);
    const first = body.data.find((t: { contextKey: string }) => t.contextKey === w1.id);
    expect(first).toMatchObject({ version: { amount: "100000" }, linked: "110000", progress: "EXCEEDS_SUGGESTION" });
  });

  it("corrects a daily override after settlement through the settlement component", async () => {
    const w1 = await settleWeek("2026-08-09", "110000");
    const result = await call(putOverride, { method: "PUT", params: { ruleId }, body: { businessDate: "2026-08-05", amount: "0" } });
    expect(result.body.data).toEqual({ afterSettlement: true });
    expect((await view(w1.id)).corrected).toMatchObject({ recognizedIncome: "300000", livingExpense: "190000" });
    expect((await dana()).confirmedPersonal).toBe("110000");
  });

  it("treats a correction of a post-closing transfer as settled once the next week is settled", async () => {
    await settleWeek("2026-08-09", "110000");
    const transfer = await toJago("110000", "2026-08-09");
    const w2 = await settleWeek("2026-08-16", "70000");
    expect(w2.view.asSettled).toMatchObject({ transfersOut: "110000", livingExpense: "280000" });

    const result = await call(correct, { method: "POST", params: { id: transfer.body.data.entryId }, body: { action: "REPLACE", amount: "100000", businessDate: "2026-08-09" } });
    expect(result.body.data.mode).toBe("SETTLED_HISTORY");
    expect((await view(w2.id)).corrected).toMatchObject({ transfersOut: "100000", livingExpense: "290000" });
  });
});
