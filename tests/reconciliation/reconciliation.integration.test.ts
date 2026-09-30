// S10: physical-first balance confirmation, discrepancy, BALANCE_ADJUSTMENT,
// replacement confirmations, reconciliation prompts, and badge precedence.
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET as getReconciliation } from "@/app/api/v1/accounts/[id]/reconciliation/route";
import { GET as getAccounts } from "@/app/api/v1/accounts/route";
import { POST as adjust } from "@/app/api/v1/balance-adjustments/route";
import { POST as replace } from "@/app/api/v1/balance-confirmations/[id]/replacements/route";
import { POST as confirmBalance } from "@/app/api/v1/balance-confirmations/route";
import { POST as postEvent } from "@/app/api/v1/events/route";
import { GET as getSubjects } from "@/app/api/v1/external-subjects/route";
import { addDays, businessDateOf } from "@/lib/business-time";

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

const yesterday = () => addDays(businessDateOf(new Date()), -1);
const confirm = (account: "reserve" | "monthly" | "daily", physicalBalance: string) =>
  call(confirmBalance, { method: "POST", body: { accountId: owner.accountIds[account], physicalBalance } });

async function card(name: string) {
  const { body } = await call(getAccounts);
  return body.data.accounts.find((a: { displayName: string }) => a.displayName === name);
}

beforeAll(async () => {
  user = await createAuthUser(clients.authAdmin, "reconcile");
});

beforeEach(async () => {
  owner = await resetWithConfirmedFixture(clients, user.id, "2026-06-15T10:00:00+07:00");
});

afterAll(async () => {
  await clients.admin`truncate fintrack.app_owner cascade`;
  await clients.authAdmin.auth.admin.deleteUser(user.id);
  await closeClients(clients);
});

describe("balance confirmation", () => {
  it("matches the calculated physical balance and derives personal from the ownership ledger", async () => {
    const result = await confirm("monthly", "831999.93");
    expect(result.status).toBe(201);
    expect(result.body.data).toMatchObject({ status: "MATCHED", discrepancy: "0", externalOutstanding: "431999.93", confirmedPersonal: "400000" });
    expect(await card("BCA")).toMatchObject({ status: "CONFIRMED", confirmedPersonal: "400000" });

    const posted = await call(postEvent, { method: "POST", body: { direction: "EXPENSE", accountId: owner.accountIds.monthly, amount: "1000", businessDate: businessDateOf(new Date()) } });
    expect(posted.status).toBe(201);
    expect((await card("BCA")).status).toBe("CALCULATED_AFTER_CONFIRMATION");
  });

  it("shows a discrepancy that a recorded missing event resolves without an adjustment", async () => {
    const result = await confirm("monthly", "800000");
    expect(result.body.data).toMatchObject({ status: "DISCREPANCY", discrepancy: "-31999.93" });
    expect(await card("BCA")).toMatchObject({ status: "DISCREPANCY" });

    await call(postEvent, { method: "POST", body: { direction: "EXPENSE", accountId: owner.accountIds.monthly, amount: "31999.93", businessDate: yesterday() } });
    const view = await call(getReconciliation, { params: { id: owner.accountIds.monthly } });
    expect(view.body.data).toMatchObject({ status: "MATCHED", discrepancy: "0" });
  });

  it("records an explicit adjustment for an unknown discrepancy without touching external ownership", async () => {
    const confirmation = await confirm("monthly", "800000");
    const adjusted = await call(adjust, {
      method: "POST",
      body: { balanceConfirmationId: confirmation.body.data.confirmationId, reason: "UNKNOWN_DISCREPANCY" },
    });
    expect(adjusted.status).toBe(201);
    expect(adjusted.body.data.reconciliation).toMatchObject({ status: "MATCHED", discrepancy: "0", adjustments: [{ amount: "-31999.93", reason: "UNKNOWN_DISCREPANCY" }] });
    expect(await card("BCA")).toMatchObject({ physical: "800000", external: "431999.93", personal: "368000.07", status: "CONFIRMED" });
    const dosen = (await call(getSubjects)).body.data.find((s: { displayName: string }) => s.displayName === "Dosen");
    expect(dosen.total).toBe("431999.93");

    const again = await call(adjust, { method: "POST", body: { balanceConfirmationId: confirmation.body.data.confirmationId, reason: "UNKNOWN_DISCREPANCY" } });
    expect(again.body.error!.details).toEqual({ issues: ["NO_DISCREPANCY"] });
  });

  it("keeps an old adjustment for review when its confirmation is replaced", async () => {
    const confirmation = await confirm("monthly", "800000");
    await call(adjust, { method: "POST", body: { balanceConfirmationId: confirmation.body.data.confirmationId, reason: "UNKNOWN_DISCREPANCY" } });
    const replaced = await call(replace, { method: "POST", params: { id: confirmation.body.data.confirmationId }, body: { physicalBalance: "790000" } });
    expect(replaced.body.data).toMatchObject({ status: "DISCREPANCY", discrepancy: "-10000" });
    expect(replaced.body.data.adjustments).toEqual([expect.objectContaining({ fromSupersededConfirmation: true })]);
  });

  it("routes DANA to settlement instead of a regular confirmation", async () => {
    const result = await confirm("daily", "1000");
    expect(result.body.error!.details).toEqual({ issues: ["USE_SETTLEMENT_FOR_WEEKLY_ACCOUNT"] });
  });
});

describe("reconciliation prompts", () => {
  it("asks for Jago and BCA once the previous BCA cycle is over, and clears after confirmation", async () => {
    const { body } = await call(getAccounts);
    const prompted = body.data.prompts.map((p: { accountId: string }) => p.accountId).sort();
    expect(prompted).toEqual([owner.accountIds.reserve, owner.accountIds.monthly].sort());
    expect(await card("Jago")).toMatchObject({ status: "NEEDS_REVIEW", prompt: expect.objectContaining({ reason: "BCA_CYCLE_COMPLETE" }) });

    await confirm("reserve", "0");
    await confirm("monthly", "831999.93");
    expect((await call(getAccounts)).body.data.prompts).toEqual([]);
    expect((await card("Jago")).status).toBe("CONFIRMED");
  });

  it("puts a discrepancy above a due prompt", async () => {
    await confirm("reserve", "5");
    expect((await card("Jago")).status).toBe("DISCREPANCY");
  });
});
