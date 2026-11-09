import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { POST } from "@/app/api/v1/accounts/split/route";
import { businessDateOf } from "@/lib/business-time";
import { accountSplitStatus, accountSplitView, splitReserveAccount } from "@/server/application/account-split";
import { recordOtherEvent } from "@/server/application/events";
import { readExportSnapshot } from "@/server/application/export";
import { readExportAnalysis } from "@/server/application/export-analysis";
import { listExternalSubjects, recordExternalMovement } from "@/server/application/external-funds";
import { accountBalances } from "@/server/application/ledger";
import { recordingContext } from "@/server/application/recording-context";
import { monthReport } from "@/server/application/reports";
import { routeKind, recordTransfer } from "@/server/application/transfers";
import type { AuthPrincipal, OwnerTx } from "@/server/db/owner";

import { asOwner, closeClients, createAuthUser, resetWithConfirmedFixture, testClients, type ConfirmedOwner, type TestUser } from "../helpers/owner";

const clients = testClients();
let user: TestUser;
let owner: ConfirmedOwner;
const now = () => new Date();
const run = <T>(work: (tx: OwnerTx, p: AuthPrincipal) => Promise<T>) => asOwner(clients.runtime, user.id, work);
const view = () => run((tx, p) => accountSplitView(tx, p.ownerId));
beforeAll(async () => { user = await createAuthUser(clients.authAdmin, "split-regression"); });
beforeEach(async () => {
  owner = await resetWithConfirmedFixture(clients, user.id, "2026-08-02T20:00:00+07:00");
  await run((tx, p) => recordOtherEvent(tx, p.ownerId, { direction: "INCOME", accountId: owner.accountIds.reserve, amount: "1000000.17", businessDate: "2026-08-03" }, now()));
});
afterAll(async () => {
  await clients.admin`truncate fintrack.app_owner cascade`;
  if (user) await clients.authAdmin.auth.admin.deleteUser(user.id);
  await closeClients(clients);
});

it("splits exact balances atomically while retaining every original ledger entry and opening snapshot", async () => {
  const entries = await clients.admin`select * from fintrack.ledger_entry order by id`;
  const snapshots = await clients.admin`select * from fintrack.onboarding_snapshot order by id`;
  const before = await run((tx, p) => accountBalances(tx, p.ownerId));
  const initial = await view();
  const result = await run((tx, p) => splitReserveAccount(tx, p.ownerId, { primaryBalance: "300000.03", version: initial.version, externalComponents: [] }, now()));
  const after = await run((tx, p) => accountBalances(tx, p.ownerId));
  expect(after.personalCashRecorded).toBe(before.personalCashRecorded);
  expect(after.accounts.find((a) => a.id === owner.accountIds.reserve)).toMatchObject({ displayName: "Jago — Tabungan", physical: "700000.14", personal: "700000.14" });
  expect(after.accounts.find((a) => a.id === result.primaryAccountId)).toMatchObject({ displayName: "Jago — Utama", physical: "300000.03", personal: "300000.03" });
  expect(await clients.admin`select * from fintrack.ledger_entry where source_type is distinct from 'ACCOUNT_SPLIT' order by id`).toEqual(entries);
  expect(await clients.admin`select * from fintrack.onboarding_snapshot order by id`).toEqual(snapshots);
  expect(await run((tx, p) => routeKind(tx, p.ownerId, { sourceAccountId: owner.accountIds.daily, destinationAccountId: owner.accountIds.reserve }))).toBe("DANA");
  expect((await run((tx, p) => recordingContext(tx, p.ownerId))).defaultSpecialSourceAccountId).toBe(result.primaryAccountId);
  const report = await run((tx, p) => monthReport(tx, p.ownerId, businessDateOf(now()).slice(0, 7), "corrected", now()));
  expect(report.reserve.netGrowth).toBe("-300000.03");
  expect(report.outflow.actualTotal).toBe("0");
  const analysis = await run(async (tx, p) => readExportAnalysis(tx, p.ownerId, await readExportSnapshot(tx, p.ownerId), now()));
  expect(analysis.failedChecks).toBe(0);
});

it("preserves each subject's ownership while splitting funds and permits transfers in both directions", async () => {
  await run((tx, p) => recordExternalMovement(tx, p.ownerId, { type: "RECEIPT", accountId: owner.accountIds.reserve, subjectName: "Titipan Jago", amount: "50000.03", businessDate: "2026-08-04" }, now()));
  const initial = await view();
  const subject = initial.positions[0];
  const before = await run((tx, p) => accountBalances(tx, p.ownerId));
  const split = await run((tx, p) => splitReserveAccount(tx, p.ownerId, { primaryBalance: "200000.11", version: initial.version, externalComponents: [{ subjectId: subject.subjectId, amount: "20000.01" }] }, now()));
  let balances = await run((tx, p) => accountBalances(tx, p.ownerId));
  expect(balances.personalCashRecorded).toBe(before.personalCashRecorded);
  expect(balances.accounts.find((a) => a.id === split.primaryAccountId)).toMatchObject({ physical: "200000.11", external: "20000.01", personal: "180000.10" });
  expect(balances.accounts.find((a) => a.id === split.reserveAccountId)).toMatchObject({ physical: "850000.09", external: "30000.02" });
  const subjects = await run((tx, p) => listExternalSubjects(tx, p.ownerId));
  expect(subjects.find((s) => s.id === subject.subjectId)?.total).toBe("50000.03");
  for (const [source, destination] of [[split.primaryAccountId, split.reserveAccountId], [split.reserveAccountId, split.primaryAccountId]]) {
    await run((tx, p) => recordTransfer(tx, p.ownerId, { sourceAccountId: source, destinationAccountId: destination, amount: "10000.01", externalComponents: [{ subjectId: subject.subjectId, amount: "5000.01" }], businessDate: businessDateOf(now()), cutoverDayAnswer: "NOT_IN_OPENING" }, now()));
  }
  balances = await run((tx, p) => accountBalances(tx, p.ownerId));
  expect(balances.personalCashRecorded).toBe(before.personalCashRecorded);
  expect(balances.accounts.find((a) => a.id === split.primaryAccountId)).toMatchObject({ physical: "200000.11", external: "20000.01" });
});

it("rejects a stale balance preview and leaves account setup untouched", async () => {
  const initial = await view();
  await run((tx, p) => recordOtherEvent(tx, p.ownerId, { direction: "INCOME", accountId: owner.accountIds.reserve, amount: "100", businessDate: businessDateOf(now()) }, now()));
  await expect(run((tx, p) => splitReserveAccount(tx, p.ownerId, { primaryBalance: "300000", version: initial.version, externalComponents: [] }, now()))).rejects.toMatchObject({ code: "STALE_VERSION" });
  expect((await run((tx, p) => accountSplitStatus(tx, p.ownerId))).primaryId).toBeNull();
  expect((await run((tx, p) => accountBalances(tx, p.ownerId))).accounts).toHaveLength(3);
});

it("rejects over-allocation without creating an account or changing the reserve name", async () => {
  const initial = await view();
  await expect(run((tx, p) => splitReserveAccount(tx, p.ownerId, { primaryBalance: "1000001", version: initial.version, externalComponents: [] }, now()))).rejects.toMatchObject({ details: { issues: ["SPLIT_EXCEEDS_TOTAL"] } });
  expect((await view()).reserveName).toBe(initial.reserveName);
  expect((await view()).primaryId).toBeNull();
});

it("rejects a split that strands more external funds than the remaining physical balance", async () => {
  await run((tx, p) => recordExternalMovement(tx, p.ownerId, { type: "RECEIPT", accountId: owner.accountIds.reserve, subjectName: "Titipan Jago", amount: "50000", businessDate: "2026-08-04" }, now()));
  const initial = await view();
  await expect(run((tx, p) => splitReserveAccount(tx, p.ownerId, { primaryBalance: "1040000", version: initial.version, externalComponents: [] }, now()))).rejects.toMatchObject({ details: { issues: ["SPLIT_EXTERNAL_ALLOCATION"] } });
  expect((await view()).primaryId).toBeNull();
});

it("allows zero in Utama without a fake transaction and serializes competing setup requests", async () => {
  const initial = await view();
  const attempts = await Promise.allSettled([0, 1].map(() => run((tx, p) => splitReserveAccount(tx, p.ownerId, { primaryBalance: "0", version: initial.version, externalComponents: [] }, now()))));
  expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
  expect((attempts.find((a) => a.status === "rejected") as PromiseRejectedResult).reason.details).toEqual({ issues: ["ACCOUNT_ALREADY_SPLIT"] });
  expect((await view()).primaryId).not.toBeNull();
  const [count] = await clients.admin`select count(*)::int as n from fintrack.ledger_entry where source_type = 'ACCOUNT_SPLIT'`;
  expect(count.n).toBe(0);
});

it("keeps split identity after account labels and the expense default change", async () => {
  const initial = await view();
  const split = await run((tx, p) => splitReserveAccount(tx, p.ownerId, { primaryBalance: "0", version: initial.version, externalComponents: [] }, now()));
  await clients.admin`update fintrack.account set display_name = 'Rekening harian', provider_name = 'Provider lain', purpose_label = 'Belanja' where id = ${split.primaryAccountId}`;
  await clients.admin`update fintrack.owner_setting set default_special_source_account_id = ${owner.accountIds.monthly}`;
  expect(await run((tx, p) => accountSplitStatus(tx, p.ownerId))).toMatchObject({ primaryId: split.primaryAccountId, reserveId: owner.accountIds.reserve });
  const refreshed = await view();
  await expect(run((tx, p) => splitReserveAccount(tx, p.ownerId, { primaryBalance: "0", version: refreshed.version, externalComponents: [] }, now()))).rejects.toMatchObject({ details: { issues: ["ACCOUNT_ALREADY_SPLIT"] } });
  const [count] = await clients.admin`select count(*)::int as n from fintrack.account`;
  expect(count.n).toBe(4);
});

it("replays the same financial mutation key without splitting twice", async () => {
  const initial = await view();
  const key = randomUUID();
  const request = () => new Request("http://localhost:3000/api/v1/accounts/split", { method: "POST", headers: { authorization: `Bearer ${user.accessToken}`, "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify({ primaryBalance: "150000", version: initial.version }) });
  const first = await POST(request());
  expect(first.status).toBe(201);
  const second = await POST(request());
  expect(second.status).toBe(201);
  expect(second.headers.get("idempotency-replayed")).toBe("true");
  expect(await second.json()).toEqual(await first.json());
});
