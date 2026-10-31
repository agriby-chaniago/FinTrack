import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, expect, it } from "vitest";

import { POST as createSettlement } from "@/app/api/v1/settlements/route";
import { PATCH as patchSettlement } from "@/app/api/v1/settlements/[id]/route";
import { POST as settle } from "@/app/api/v1/settlements/[id]/settle/route";
import { POST as correctClosing } from "@/app/api/v1/settlements/[id]/closing-corrections/route";
import { POST as specialExpense } from "@/app/api/v1/special-expenses/route";
import { POST as correctEvent } from "@/app/api/v1/ledger-entries/[id]/corrections/route";
import { readExportSnapshot } from "@/server/application/export";
import { readExportAnalysis } from "@/server/application/export-analysis";
import { withOwnerDb } from "@/server/db/owner";
import { createRuntimeDb } from "@/server/db/client";

import { closeClients, createAuthUser, resetWithConfirmedFixture, testClients, type ConfirmedOwner, type TestUser } from "../helpers/owner";

const clients = testClients();
const counted = createRuntimeDb(process.env.DATABASE_URL!, { max: 1 });
let queryCalls = 0;
counted.$client.on("connect", (connection) => {
  const original = connection.query.bind(connection) as (...args: unknown[]) => unknown;
  (connection as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => { queryCalls++; return original(...args); };
});
let user: TestUser;
let owner: ConfirmedOwner;
type Handler = (request: Request, segment?: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function call<T>(handler: Handler, method: string, body: unknown, id?: string, version?: number): Promise<T> {
  const headers: Record<string, string> = { authorization: `Bearer ${user.accessToken}`, "content-type": "application/json", "idempotency-key": randomUUID() };
  if (version !== undefined) headers["if-match"] = `"${version}"`;
  const params: Record<string, string> = id ? { id } : {};
  const response = await handler(new Request("http://127.0.0.1:3000/api/v1/test", { method, headers, body: JSON.stringify(body) }), { params: Promise.resolve(params) });
  const result = await response.json();
  expect(response.ok, JSON.stringify(result)).toBe(true);
  return result.data as T;
}

beforeAll(async () => {
  user = await createAuthUser(clients.authAdmin, "export-effective");
  owner = await resetWithConfirmedFixture(clients, user.id, "2026-08-02T20:00:00+07:00");
});
afterAll(async () => {
  await clients.admin`truncate fintrack.app_owner cascade`;
  await clients.authAdmin.auth.admin.deleteUser(user.id);
  await counted.$client.end();
  await closeClients(clients);
});

async function readProbe() {
  queryCalls = 0;
  const result = await withOwnerDb(counted, { sub: user.id }, async (tx, principal) => {
    const snapshot = await readExportSnapshot(tx, principal.ownerId);
    const analysis = await readExportAnalysis(tx, principal.ownerId, snapshot, new Date());
    const after = await readExportSnapshot(tx, principal.ownerId);
    return { snapshot, after, analysis };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  return { ...result, queries: queryCalls };
}

it("exports only the effective settlement after two closing revisions and settled expense corrections, without lazy writes", async () => {
  const created = await call<{ id: string; version: number }>(createSettlement, "POST", { endDate: "2026-08-09" });
  const patched = await call<{ version: number }>(patchSettlement, "PATCH", { closingPhysicalBalance: "50000", closingAt: "2026-08-09T21:00:00+07:00" }, created.id, created.version);
  await call(settle, "POST", {}, created.id, patched.version); // 350000 income - 50000 closing = 300000 living.
  await call(correctClosing, "POST", { closingPhysicalBalance: "100000" }, created.id); // 250000
  await call(correctClosing, "POST", { closingPhysicalBalance: "75000" }, created.id); // 275000
  const expense = await call<{ entryId: string }>(specialExpense, "POST", { sourceAccountId: owner.accountIds.daily, amount: "10000", businessDate: "2026-08-05", newCategoryName: "Test special" });
  await call(correctEvent, "POST", { action: "REPLACE", amount: "15000", businessDate: "2026-08-05" }, expense.entryId);
  await call(correctEvent, "POST", { action: "VOID" }, expense.entryId); // Final special effect zero; living returns to 275000.

  const result = await readProbe();
  expect(result.after).toEqual(result.snapshot);
  expect(result.analysis.rows.filter((r) => r.row_type === "CHECK" && r.status === "FAIL")).toEqual([]);
  expect(result.analysis.rows.filter((r) => r.row_type === "SETTLEMENT")).toEqual([expect.objectContaining({ value: "275000", status: "EFFECTIVE_CORRECTED" })]);
  expect(result.analysis.rows.find((r) => r.record_id === `void:${expense.entryId}`)).toMatchObject({ value: "0" });
  expect(result.analysis.rows.filter((r) => r.row_type === "OCCURRENCE" && r.status === "UNMATERIALIZED_PENDING").length).toBeGreaterThan(0);
  const original = result.snapshot.find((d) => d.table === "settlement")!.rows[0];
  expect(original.living_expense_minor).toBe("30000000");
  expect(original.snapshot).toMatchObject({ livingExpense: "300000" });
  // Repeated genuine revisions must not add one DB round trip per link.
  for (let i = 0; i < 20; i++) await call(correctClosing, "POST", { closingPhysicalBalance: i % 2 === 0 ? "75001" : "75000" }, created.id);
  const revised = await readProbe();
  expect(revised.queries).toBe(result.queries);
  expect(revised.analysis.failedChecks).toBe(0);
  expect(revised.analysis.rows.find((row) => row.row_type === "SETTLEMENT")).toMatchObject({ value: "275000" });
});

it("keeps a month-end cutover partial when daily settlement coverage starts next month", async () => {
  owner = await resetWithConfirmedFixture(clients, user.id, "2026-09-30T20:00:00+07:00");
  const result = await readProbe();
  expect(result.analysis.failedChecks).toBe(0);
  expect(result.analysis.rows.find((row) => row.record_id === "month:2026-09:income.total")).toMatchObject({ status: "PERIODE_PARSIAL" });
  expect(result.analysis.rows.find((row) => row.record_id === "month:2026-09:eligibility")).toMatchObject({ value: "false" });
});
