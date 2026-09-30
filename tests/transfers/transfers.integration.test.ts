// S6: transfers with ownership composition, logical targets and versions,
// oldest-first allocation, surplus, early BCA fulfillment, closing, corrections.
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET as getSubjects } from "@/app/api/v1/external-subjects/route";
import { POST as correct } from "@/app/api/v1/ledger-entries/[id]/corrections/route";
import { POST as closeTargetRoute } from "@/app/api/v1/transfer-targets/[id]/close/route";
import { GET as getTargets } from "@/app/api/v1/transfer-targets/route";
import { GET as getSuggestions } from "@/app/api/v1/transfer-suggestions/route";
import { POST as postTransfer } from "@/app/api/v1/transfers/route";
import { createTargetVersion, ensureTarget, priorOutstanding, type ContextType } from "@/server/application/transfers";

import { asOwner, closeClients, createAuthUser, resetWithConfirmedFixture, testClients, type ConfirmedOwner, type TestUser } from "../helpers/owner";

const clients = testClients();
let user: TestUser;
let owner: ConfirmedOwner;

type Handler = (request: Request, segment?: { params: Promise<Record<string, string>> }) => Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response shapes differ per route
type Body = { data?: any; error?: { code: string; details?: any } };

async function call(handler: Handler, options: { method?: string; body?: unknown; params?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { authorization: `Bearer ${user.accessToken}` };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.method === "POST") headers["idempotency-key"] = randomUUID();
  const response = await handler(
    new Request("http://127.0.0.1:3000/api/v1/x", { method: options.method ?? "GET", headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }),
    { params: Promise.resolve(options.params ?? {}) },
  );
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as Body };
}

const route = (from: "daily" | "monthly" | "reserve", to: "daily" | "monthly" | "reserve") => ({
  sourceAccountId: owner.accountIds[from],
  destinationAccountId: owner.accountIds[to],
});

async function target(contextType: ContextType, contextKey: string, contextOrder: string, from: "daily" | "monthly", amount: string) {
  return asOwner(clients.runtime, user.id, async (tx, principal) => {
    const id = await ensureTarget(tx, principal.ownerId, { contextType, contextKey, contextOrder }, route(from, "reserve"));
    await createTargetVersion(tx, principal.ownerId, id, { amount: BigInt(amount) * 100n, basis: { test: true }, isActionable: true });
    return id;
  });
}

const transfer = (from: "daily" | "monthly" | "reserve", to: "daily" | "monthly" | "reserve", amount: string, extra: Record<string, unknown> = {}) =>
  call(postTransfer, { method: "POST", body: { ...route(from, to), amount, businessDate: "2026-09-20", ...extra } });

async function targets() {
  const { body } = await call(getTargets);
  return Object.fromEntries(body.data.map((t: { id: string }) => [t.id, t])) as Record<string, { progress: string; linked: string; remaining: string; version: { amount: string } | null; contextKey: string }>;
}

beforeAll(async () => {
  user = await createAuthUser(clients.authAdmin, "transfers");
});

beforeEach(async () => {
  owner = await resetWithConfirmedFixture(clients, user.id, "2026-09-01T10:00:00+07:00");
});

afterAll(async () => {
  await clients.admin`truncate fintrack.app_owner cascade`;
  await clients.authAdmin.auth.admin.deleteUser(user.id);
  await closeClients(clients);
});

describe("transfers and allocation", () => {
  it("moves a mixed transfer and counts only the personal component toward the target", async () => {
    const cycle = await target("BCA_CYCLE", "2026-09", "2026-09", "monthly", "335000");
    const { body: subjects } = await call(getSubjects);
    const dosen = subjects.data.find((s: { displayName: string }) => s.displayName === "Dosen");

    const result = await transfer("monthly", "reserve", "250000", { externalComponents: [{ subjectId: dosen.id, amount: "150000" }] });
    expect(result.status).toBe(201);

    expect((await targets())[cycle]).toMatchObject({ linked: "100000", remaining: "235000", progress: "PARTIALLY_TRANSFERRED" });
    const after = (await call(getSubjects)).body.data.find((s: { displayName: string }) => s.displayName === "Dosen");
    expect(after.positions).toEqual([
      expect.objectContaining({ accountName: "Jago", amount: "150000" }),
      expect.objectContaining({ accountName: "BCA", amount: "281999.93" }),
    ]);
  });

  it("fills targets oldest-first and puts a surplus on the newest actionable target", async () => {
    const week1 = await target("DANA_SETTLEMENT", randomUUID(), "2026-09-06", "daily", "110000");
    const week2 = await target("DANA_SETTLEMENT", randomUUID(), "2026-09-13", "daily", "70000");

    await transfer("daily", "reserve", "150000");
    let state = await targets();
    expect(state[week1]).toMatchObject({ linked: "110000", progress: "FULLY_TRANSFERRED" });
    expect(state[week2]).toMatchObject({ linked: "40000", progress: "PARTIALLY_TRANSFERRED" });

    await transfer("daily", "reserve", "50000");
    state = await targets();
    expect(state[week2]).toMatchObject({ linked: "90000", remaining: "0", progress: "EXCEEDS_SUGGESTION" });
  });

  it("leaves a DANA transfer unallocated without targets and ignores non-saving routes", async () => {
    await transfer("daily", "reserve", "10000");
    await transfer("reserve", "monthly", "10000");
    const [{ count }] = await clients.admin<{ count: number }[]>`select count(*)::int as count from fintrack.transfer_allocation`;
    expect(count).toBe(0);
  });

  it("attaches an early BCA transfer to the not-yet-ready cycle context", async () => {
    await call(postTransfer, { method: "POST", body: { ...route("monthly", "reserve"), amount: "100000", businessDate: "2026-09-20" } });
    const early = Object.values(await targets()).find((t) => t.contextKey === "2026-09")!;
    expect(early).toMatchObject({ version: null, linked: "100000", progress: "PENDING_READINESS" });
  });

  it("gives external-only transfers no allocation", async () => {
    await target("BCA_CYCLE", "2026-09", "2026-09", "monthly", "100000");
    const dosen = (await call(getSubjects)).body.data.find((s: { displayName: string }) => s.displayName === "Dosen");
    await transfer("monthly", "reserve", "50000", { externalComponents: [{ subjectId: dosen.id, amount: "50000" }] });
    expect(Object.values(await targets())[0]).toMatchObject({ linked: "0", progress: "NOT_TRANSFERRED" });
  });

  it("rejects external components larger than the transfer", async () => {
    const dosen = (await call(getSubjects)).body.data.find((s: { displayName: string }) => s.displayName === "Dosen");
    const result = await transfer("monthly", "reserve", "50000", { externalComponents: [{ subjectId: dosen.id, amount: "50000.01" }] });
    expect(result.body.error!.details).toEqual({ issues: ["EXTERNAL_EXCEEDS_TRANSFER"] });
  });
});

describe("Tutup target", () => {
  it("writes off an unfulfillable target once and removes it from prior outstanding", async () => {
    const week1 = await target("DANA_SETTLEMENT", randomUUID(), "2026-09-06", "daily", "110000");
    await transfer("daily", "reserve", "10000");

    expect((await call(closeTargetRoute, { method: "POST", params: { id: week1 } })).status).toBe(201);
    expect((await targets())[week1]).toMatchObject({ progress: "CLOSED", linked: "10000", remaining: "0" });

    const outstanding = await asOwner(clients.runtime, user.id, (tx, principal) => priorOutstanding(tx, principal.ownerId, route("daily", "reserve"), "2026-09-13"));
    expect(outstanding).toBe(0n);

    const again = await call(closeTargetRoute, { method: "POST", params: { id: week1 } });
    expect(again.body.error!.details).toEqual({ issues: ["TARGET_NOT_CLOSABLE"] });
    const [{ versions }] = await clients.admin<{ versions: number }[]>`select count(*)::int as versions from fintrack.transfer_target_version`;
    expect(versions).toBe(2);
  });
});

describe("transfer corrections", () => {
  it("negates old allocations and re-allocates the replacement oldest-first", async () => {
    const week1 = await target("DANA_SETTLEMENT", randomUUID(), "2026-09-06", "daily", "110000");
    const week2 = await target("DANA_SETTLEMENT", randomUUID(), "2026-09-13", "daily", "70000");
    const posted = await transfer("daily", "reserve", "150000");

    const result = await call(correct, {
      method: "POST",
      params: { id: posted.body.data.entryId },
      body: { action: "REPLACE", amount: "100000", businessDate: "2026-09-20" },
    });
    expect(result.status).toBe(201);
    const state = await targets();
    expect(state[week1]).toMatchObject({ linked: "100000", progress: "PARTIALLY_TRANSFERRED" });
    expect(state[week2]).toMatchObject({ linked: "0", progress: "NOT_TRANSFERRED" });

    const [{ allocations }] = await clients.admin<{ allocations: number }[]>`select count(*)::int as allocations from fintrack.transfer_allocation`;
    expect(allocations).toBe(5); // 2 original + 2 negations + 1 replacement
  });
});

describe("transfer-now suggestion", () => {
  it("caps outstanding BCA targets by personal balance above the retained floor", async () => {
    await target("BCA_CYCLE", "2026-09", "2026-09", "monthly", "335000");
    const { body } = await call(getSuggestions);
    // Personal BCA Rp400.000 − floor Rp400.000 leaves nothing to move now.
    expect(body.data.find((s: { kind: string }) => s.kind === "BCA")).toMatchObject({ outstanding: "335000", transferNow: "0", liquidityWarning: true });
  });
});
