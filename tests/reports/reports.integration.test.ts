// S11: the locked full-month validation fixture replayed on February 2021
// (starts on a Monday and has exactly four Monday–Sunday weeks, like February 2027).
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as getCategories } from "@/app/api/v1/categories/route";
import { POST as postTransitions } from "@/app/api/v1/daily-income/[ruleId]/transitions/route";
import { PUT as putOverride } from "@/app/api/v1/daily-income/[ruleId]/overrides/route";
import { GET as getDailyIncome } from "@/app/api/v1/daily-income/route";
import { GET as getCycles } from "@/app/api/v1/monthly-cycles/route";
import { POST as resolve } from "@/app/api/v1/occurrences/[type]/[id]/resolutions/route";
import { GET as getDashboard } from "@/app/api/v1/reports/dashboard/route";
import { GET as getMonth } from "@/app/api/v1/reports/months/[month]/route";
import { PATCH as patchSettlement } from "@/app/api/v1/settlements/[id]/route";
import { POST as settleRoute } from "@/app/api/v1/settlements/[id]/settle/route";
import { POST as createSettlement } from "@/app/api/v1/settlements/route";
import { POST as postSpecial } from "@/app/api/v1/special-expenses/route";
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
  const parsed = { status: response.status, body: (text ? JSON.parse(text) : {}) as Body };
  if (response.status >= 400) throw new Error(`${response.status} ${text}`);
  return parsed;
}

async function settleWeek(endDate: string, closing: string) {
  const created = await call(createSettlement, { method: "POST", body: { endDate } });
  const patched = await call(patchSettlement, {
    method: "PATCH",
    params: { id: created.body.data.id },
    ifMatch: created.body.data.version,
    body: { closingPhysicalBalance: closing, closingAt: `${endDate}T21:00:00+07:00` },
  });
  return call(settleRoute, { method: "POST", params: { id: created.body.data.id }, ifMatch: patched.body.data.version });
}

const transfer = (from: "daily" | "monthly", amount: string, businessDate: string) =>
  call(postTransfer, { method: "POST", body: { sourceAccountId: owner.accountIds[from], destinationAccountId: owner.accountIds.reserve, amount, businessDate } });

const month = (view = "corrected") => call(getMonth, { params: { month: "2021-02" }, query: `?view=${view}` }).then((r) => r.body.data);

beforeAll(async () => {
  user = await createAuthUser(clients.authAdmin, "reports");
  owner = await resetWithConfirmedFixture(clients, user.id, "2021-01-31T20:00:00+07:00");
  const ruleId = (await call(getDailyIncome)).body.data.ruleId as string;

  // BCA: subscription on the 5th, income on the 7th, bank fee on the 25th, transfer on the 26th.
  const feb = (await call(getCycles)).body.data.find((c: { cycleKey: string }) => c.cycleKey === "2021-02");
  const byKind = (kind: string) => feb.obligations.find((o: { kind: string }) => o.kind === kind).occurrenceId;
  await call(resolve, { method: "POST", params: { type: "recurring-expense", id: byKind("SUBSCRIPTION") }, body: { outcome: "CONFIRMED", actualDate: "2021-02-05", actualAmount: "400000" } });
  await call(resolve, { method: "POST", params: { type: "monthly-income", id: feb.income.occurrenceId }, body: { outcome: "CONFIRMED", actualDate: "2021-02-07", actualAmount: "750000" } });
  await call(resolve, { method: "POST", params: { type: "recurring-expense", id: byKind("BANK_FEE") }, body: { outcome: "CONFIRMED", actualDate: "2021-02-25", actualAmount: "15000" } });
  await transfer("monthly", "335000", "2021-02-26");

  // DANA: four weeks with an Rp0 override in week 2 and a two-day pause in week 4.
  await settleWeek("2021-02-07", "110000");
  await transfer("daily", "110000", "2021-02-07");
  await call(putOverride, { method: "PUT", params: { ruleId }, body: { businessDate: "2021-02-10", amount: "0" } });
  await settleWeek("2021-02-14", "70000");
  await transfer("daily", "70000", "2021-02-14");
  await settleWeek("2021-02-21", "80000");
  await transfer("daily", "50000", "2021-02-21");
  await transfer("daily", "30000", "2021-02-21");
  await call(postTransitions, { method: "POST", params: { ruleId }, body: { toState: "PAUSED", effectiveDate: "2021-02-24" } });
  await call(postTransitions, { method: "POST", params: { ruleId }, body: { toState: "ACTIVE", effectiveDate: "2021-02-26" } });
  await settleWeek("2021-02-28", "60000");
  await transfer("daily", "60000", "2021-02-28");

  const vape = (await call(getCategories)).body.data.find((c: { displayName: string }) => c.displayName === "Vape").id;
  await call(postSpecial, { method: "POST", body: { amount: "150000", categoryId: vape, sourceAccountId: owner.accountIds.reserve, businessDate: "2021-02-15" } });
});

afterAll(async () => {
  await clients.admin`truncate fintrack.app_owner cascade`;
  await clients.authAdmin.auth.admin.deleteUser(user.id);
  await closeClients(clients);
});

describe("locked full-month validation fixture", () => {
  it("reconciles exactly: income Rp2.000.000, outflow Rp1.495.000, Jago inflow Rp655.000, growth Rp505.000", async () => {
    const report = await month();
    expect(report.completeness).toBe("LENGKAP");
    expect(report.income).toMatchObject({ total: "2000000", daily: "1250000", monthly: "750000" });
    expect(report.outflow).toMatchObject({ actualTotal: "1495000", living: "930000", special: "150000", recurring: "415000" });
    expect(report.outflow.specialByCategory).toEqual([expect.objectContaining({ name: "Vape", amount: "150000" })]);
    expect(report.reserve).toMatchObject({ grossSaved: "655000", netGrowth: "505000" });
  });

  it("gives the same as-settled view while nothing was corrected", async () => {
    const asSettled = await month("as_settled");
    expect(asSettled.outflow).toMatchObject({ actualTotal: "1495000", living: "930000" });
  });

  it("reclassifies a late DANA special expense only in the corrected view", async () => {
    const kopi = await call(postSpecial, { method: "POST", body: { amount: "20000", newCategoryName: "Kopi", sourceAccountId: owner.accountIds.daily, businessDate: "2021-02-18" } });
    expect(kopi.status).toBe(201);
    const corrected = await month();
    expect(corrected.outflow).toMatchObject({ living: "910000", special: "170000", actualTotal: "1495000" });
    const asSettled = await month("as_settled");
    expect(asSettled.outflow).toMatchObject({ living: "930000", special: "150000", actualTotal: "1495000" });
  });

  it("builds the dashboard in reading order with tasks and summaries", async () => {
    const { body } = await call(getDashboard);
    expect(body.data.accounts.map((a: { displayName: string }) => a.displayName)).toEqual(["Jago", "BCA", "DANA"]);
    expect(body.data.danaDisclosure).toBe(true);
    expect(body.data.tasks.some((t: { type: string }) => t.type === "SETTLEMENT")).toBe(true);
    expect(body.data.bca.latestCompletedCycle).toMatchObject({ cycleKey: "2021-02", state: "COMPLETE" });
    expect(body.data.dana.latestCompleted).toBeTruthy();
    expect(body.data.external).toEqual([expect.objectContaining({ displayName: "Dosen", total: "431999.93" })]);
  });
});
