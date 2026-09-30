// S9: BCA monthly cycles with the locked BCA fixture (cycle 2026-07).
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET as getAccounts } from "@/app/api/v1/accounts/route";
import { POST as correct } from "@/app/api/v1/ledger-entries/[id]/corrections/route";
import { GET as getCycles } from "@/app/api/v1/monthly-cycles/route";
import { POST as resolve } from "@/app/api/v1/occurrences/[type]/[id]/resolutions/route";
import { POST as revise } from "@/app/api/v1/recurring-expense-rules/[id]/revisions/route";
import { POST as createSubscription } from "@/app/api/v1/recurring-expense-rules/route";
import { GET as getRules } from "@/app/api/v1/recurring-rules/route";
import { PATCH as patchSettings } from "@/app/api/v1/settings/route";
import { POST as closeTarget } from "@/app/api/v1/transfer-targets/[id]/close/route";
import { POST as postTransfer } from "@/app/api/v1/transfers/route";
import { cycleKeyOf, nextCycleKey } from "@/lib/business-time";

import { closeClients, createAuthUser, resetWithConfirmedFixture, testClients, type ConfirmedOwner, type TestUser } from "../helpers/owner";

const clients = testClients();
let user: TestUser;
let owner: ConfirmedOwner;

type Handler = (request: Request, segment?: { params: Promise<Record<string, string>> }) => Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response shapes differ per route
type Body = { data?: any; error?: { code: string; details?: any } };

async function call(handler: Handler, options: { method?: string; body?: unknown; params?: Record<string, string> } = {}) {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { authorization: `Bearer ${user.accessToken}` };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (method === "POST") headers["idempotency-key"] = randomUUID();
  const response = await handler(
    new Request("http://127.0.0.1:3000/api/v1/x", { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }),
    { params: Promise.resolve(options.params ?? {}) },
  );
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as Body };
}

async function cycle(key: string) {
  const { body } = await call(getCycles);
  return body.data.find((c: { cycleKey: string }) => c.cycleKey === key);
}

async function confirm(type: "monthly-income" | "recurring-expense", id: string, actualDate: string, actualAmount: string) {
  const result = await call(resolve, { method: "POST", params: { type, id }, body: { outcome: "CONFIRMED", actualDate, actualAmount } });
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return result.body.data;
}

const outcome = (type: "monthly-income" | "recurring-expense", id: string, value: "NOT_RECEIVED" | "NOT_CHARGED") =>
  call(resolve, { method: "POST", params: { type, id }, body: { outcome: value } });

const obligation = (c: { obligations: { kind: string; occurrenceId: string }[] }, kind: string) => c.obligations.find((o) => o.kind === kind)!.occurrenceId;

async function bcaPersonal() {
  const { body } = await call(getAccounts);
  return body.data.accounts.find((a: { displayName: string }) => a.displayName === "BCA").personal as string;
}

/** Locked BCA fixture: subscription on the 5th, income on the 7th, bank fee on the 25th. */
async function resolveJulyFixture(options: { bankFee?: boolean } = {}) {
  const july = await cycle("2026-07");
  await confirm("recurring-expense", obligation(july, "SUBSCRIPTION"), "2026-07-05", "400000");
  const income = await confirm("monthly-income", july.income.occurrenceId, "2026-07-07", "750000");
  if (options.bankFee !== false) await confirm("recurring-expense", obligation(july, "BANK_FEE"), "2026-07-25", "15000");
  return { july, income };
}

beforeAll(async () => {
  user = await createAuthUser(clients.authAdmin, "monthly");
});

beforeEach(async () => {
  // Cutover mid-June: every rule starts with the July cycle.
  owner = await resetWithConfirmedFixture(clients, user.id, "2026-06-15T10:00:00+07:00");
});

afterAll(async () => {
  await clients.admin`truncate fintrack.app_owner cascade`;
  await clients.authAdmin.auth.admin.deleteUser(user.id);
  await closeClients(clients);
});

describe("locked BCA fixture", () => {
  it("waits for income and obligations, then freezes Rp335.000 and completes after the transfer", async () => {
    const july = await cycle("2026-07");
    expect(july).toMatchObject({ state: "WAITING_FOR_INCOME", income: { status: "PENDING", label: "OVERDUE", expectedAmount: "750000" } });
    expect(july.obligations.map((o: { kind: string; expectedDate: string | null }) => [o.kind, o.expectedDate])).toEqual([
      ["SUBSCRIPTION", "2026-07-05"],
      ["BANK_FEE", null],
    ]);

    await confirm("recurring-expense", obligation(july, "SUBSCRIPTION"), "2026-07-05", "400000");
    expect((await cycle("2026-07")).state).toBe("WAITING_FOR_INCOME");
    await confirm("monthly-income", july.income.occurrenceId, "2026-07-07", "750000");
    expect((await cycle("2026-07")).state).toBe("WAITING_FOR_OBLIGATIONS");
    await confirm("recurring-expense", obligation(july, "BANK_FEE"), "2026-07-25", "15000");

    const ready = await cycle("2026-07");
    expect(ready).toMatchObject({ state: "READY_TO_TRANSFER", target: { amount: "335000", remaining: "335000" } });
    expect(await bcaPersonal()).toBe("735000");

    await call(postTransfer, { method: "POST", body: { sourceAccountId: owner.accountIds.monthly, destinationAccountId: owner.accountIds.reserve, amount: "335000", businessDate: "2026-07-26" } });
    expect(await cycle("2026-07")).toMatchObject({ state: "COMPLETE", target: { progress: "FULLY_TRANSFERRED" } });
    expect(await bcaPersonal()).toBe("400000");
    expect((await cycle("2026-08")).state).not.toBe("WAITING_FOR_PRIOR_CYCLE");
  });

  it("gates later cycles chronologically while allowing their occurrences to be resolved", async () => {
    const august = await cycle("2026-08");
    expect(august.state).toBe("WAITING_FOR_PRIOR_CYCLE");
    await confirm("recurring-expense", obligation(august, "SUBSCRIPTION"), "2026-08-05", "400000");
    expect((await cycle("2026-08")).state).toBe("WAITING_FOR_PRIOR_CYCLE");
  });

  it("adds early fulfillment back into the basis when the target is frozen", async () => {
    await resolveJulyFixture({ bankFee: false });
    await call(postTransfer, { method: "POST", body: { sourceAccountId: owner.accountIds.monthly, destinationAccountId: owner.accountIds.reserve, amount: "100000", businessDate: "2026-07-20" } });
    const july = await cycle("2026-07");
    expect(july.state).toBe("WAITING_FOR_OBLIGATIONS");
    await confirm("recurring-expense", obligation(july, "BANK_FEE"), "2026-07-25", "15000");
    expect(await cycle("2026-07")).toMatchObject({ state: "PARTIALLY_TRANSFERRED", target: { amount: "335000", linked: "100000", remaining: "235000" } });
  });

  it("completes with no transfer needed when the floor covers the balance", async () => {
    await call(patchSettings, { method: "PATCH", body: { retainedFloor: { accountId: owner.accountIds.monthly, amount: "800000" } } });
    await resolveJulyFixture();
    expect(await cycle("2026-07")).toMatchObject({ state: "COMPLETE", note: "NO_TRANSFER_NEEDED", target: { amount: "0" } });
  });
});

describe("no-event outcomes and corrections", () => {
  it("closes a cycle without income, then accepts a late confirmation", async () => {
    const july = await cycle("2026-07");
    await outcome("monthly-income", july.income.occurrenceId, "NOT_RECEIVED");
    await outcome("recurring-expense", obligation(july, "SUBSCRIPTION"), "NOT_CHARGED");
    await outcome("recurring-expense", obligation(july, "BANK_FEE"), "NOT_CHARGED");
    expect(await cycle("2026-07")).toMatchObject({ state: "CLOSED_NO_INCOME", target: null });
    expect(await bcaPersonal()).toBe("400000");

    await confirm("monthly-income", july.income.occurrenceId, "2026-07-20", "750000");
    expect(await cycle("2026-07")).toMatchObject({ state: "READY_TO_TRANSFER", income: { status: "CONFIRMED", label: "LATE" }, target: { amount: "750000" } });
  });

  it("voids the income and retires the target when confirmed income is corrected to NOT_RECEIVED", async () => {
    await resolveJulyFixture();
    const july = await cycle("2026-07");
    await outcome("monthly-income", july.income.occurrenceId, "NOT_RECEIVED");
    const after = await cycle("2026-07");
    expect(after).toMatchObject({ state: "CLOSED_NO_INCOME", target: { retirementReason: "INCOME_NOT_RECEIVED" } });
    expect(await bcaPersonal()).toBe("-15000");
  });

  it("re-versions the target when the confirmed income value is corrected", async () => {
    const { income } = await resolveJulyFixture();
    const result = await call(correct, { method: "POST", params: { id: income.entryId }, body: { action: "REPLACE", amount: "700000", businessDate: "2026-07-07" } });
    expect(result.status).toBe(201);
    expect(await cycle("2026-07")).toMatchObject({ target: { amount: "285000" }, income: { actual: { amount: "700000" } } });

    const voided = await call(correct, { method: "POST", params: { id: result.body.data.entryIds[1] }, body: { action: "VOID" } });
    expect(voided.body.error!.details).toEqual({ issues: ["USE_OCCURRENCE_RESOLUTION"] });
  });

  it("closes a BCA target with Tutup target", async () => {
    await resolveJulyFixture();
    const july = await cycle("2026-07");
    await call(closeTarget, { method: "POST", params: { id: july.target.id } });
    expect(await cycle("2026-07")).toMatchObject({ state: "COMPLETE", note: "TARGET_CLOSED" });
  });
});

describe("rules and schedule revisions", () => {
  const current = cycleKeyOf(new Date().toISOString().slice(0, 10));

  it("adds a subscription from next cycle and rejects duplicate active names", async () => {
    const created = await call(createSubscription, { method: "POST", body: { name: "Musik", expectedDay: 31, expectedAmount: "55000" } });
    expect(created.body.data.firstCycle).toBe(nextCycleKey(current));
    const duplicate = await call(createSubscription, { method: "POST", body: { name: " musik ", expectedDay: 1, expectedAmount: "1" } });
    expect(duplicate.body.error!.details).toEqual({ issues: ["DUPLICATE_NAME"] });
  });

  it("revises the expected schedule only prospectively and supersedes a pending revision", async () => {
    const { body } = await call(getRules);
    const subscription = body.data.recurringExpenses.find((r: { kind: string }) => r.kind === "SUBSCRIPTION");
    const past = await call(revise, { method: "POST", params: { id: subscription.id }, body: { effectiveFromCycle: current, expectedDay: 10, expectedAmount: "400000" } });
    expect(past.body.error!.details).toEqual({ issues: ["REVISION_MUST_BE_PROSPECTIVE"] });

    const next = nextCycleKey(current);
    expect((await call(revise, { method: "POST", params: { id: subscription.id }, body: { effectiveFromCycle: next, expectedDay: 10, expectedAmount: "400000" } })).status).toBe(201);
    expect((await call(revise, { method: "POST", params: { id: subscription.id }, body: { effectiveFromCycle: next, expectedDay: 12, expectedAmount: "410000" } })).status).toBe(201);
    const rules = await call(getRules);
    const updated = rules.body.data.recurringExpenses.find((r: { id: string }) => r.id === subscription.id);
    expect(updated.expectedDay).toBe(5);
    expect(updated.upcomingRevisions).toEqual([{ effectiveFromCycle: next, expectedDay: 12, expectedAmount: "410000" }]);
  });
});

describe("obligation-only onboarding cycle", () => {
  it("must be resolved first but never suggests an automatic transfer", async () => {
    owner = await resetWithConfirmedFixture(clients, user.id, "2026-06-15T10:00:00+07:00", (draft) => {
      draft.routines.subscriptions[0].includeCurrentCycle = true;
    });
    const june = await cycle("2026-06");
    expect(june).toMatchObject({ income: null, state: "WAITING_FOR_OBLIGATIONS" });
    expect((await cycle("2026-07")).state).toBe("WAITING_FOR_PRIOR_CYCLE");

    await confirm("recurring-expense", obligation(june, "SUBSCRIPTION"), "2026-06-20", "400000");
    expect(await cycle("2026-06")).toMatchObject({ state: "COMPLETE", note: "NO_AUTOMATIC_SUGGESTION", target: null });
    expect((await cycle("2026-07")).state).toBe("WAITING_FOR_INCOME");
  });
});
