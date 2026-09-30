// S4/S5: external funds, special expenses and categories, other events,
// open-period corrections, idempotency, and the activity timeline.
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET as getAccounts } from "@/app/api/v1/accounts/route";
import { GET as getActivity } from "@/app/api/v1/activity/route";
import { PATCH as patchCategory } from "@/app/api/v1/categories/[id]/route";
import { GET as getCategories } from "@/app/api/v1/categories/route";
import { POST as postEvent } from "@/app/api/v1/events/route";
import { POST as postExternal } from "@/app/api/v1/external-movements/route";
import { POST as archiveSubject } from "@/app/api/v1/external-subjects/[id]/archive/route";
import { GET as getSubjects } from "@/app/api/v1/external-subjects/route";
import { POST as correct } from "@/app/api/v1/ledger-entries/[id]/corrections/route";
import { POST as postSpecial } from "@/app/api/v1/special-expenses/route";

import { closeClients, createAuthUser, resetWithConfirmedFixture, testClients, type ConfirmedOwner, type TestUser } from "../helpers/owner";

const clients = testClients();
let user: TestUser;
let owner: ConfirmedOwner;

type Handler = (request: Request, segment?: { params: Promise<Record<string, string>> }) => Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response shapes differ per route
type Body = { data?: any; error?: { code: string; details?: any } };

async function call(handler: Handler, options: { method?: string; body?: unknown; params?: Record<string, string>; key?: string | null; query?: string } = {}) {
  const headers: Record<string, string> = { authorization: `Bearer ${user.accessToken}` };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.key !== null && options.method && options.method !== "GET") headers["idempotency-key"] = options.key ?? randomUUID();
  const response = await handler(
    new Request(`http://127.0.0.1:3000/api/v1/x${options.query ?? ""}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    { params: Promise.resolve(options.params ?? {}) },
  );
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: (text ? JSON.parse(text) : {}) as Body };
}

const post = (handler: Handler, body: unknown, key?: string | null) => call(handler, { method: "POST", body, key });

async function balances() {
  const { body } = await call(getAccounts);
  return Object.fromEntries(body.data.accounts.map((a: { displayName: string }) => [a.displayName, a])) as Record<
    string,
    { physical: string; external: string; personal: string }
  >;
}

async function subject(name: string) {
  const { body } = await call(getSubjects);
  return body.data.find((s: { displayName: string }) => s.displayName === name);
}

async function vapeId(): Promise<string> {
  const { body } = await call(getCategories);
  return body.data.find((c: { displayName: string }) => c.displayName === "Vape").id;
}

beforeAll(async () => {
  user = await createAuthUser(clients.authAdmin, "funds");
});

beforeEach(async () => {
  owner = await resetWithConfirmedFixture(clients, user.id, "2026-09-01T10:00:00+07:00");
});

afterAll(async () => {
  await clients.admin`truncate fintrack.app_owner cascade`;
  await clients.authAdmin.auth.admin.deleteUser(user.id);
  await closeClients(clients);
});

describe("external funds", () => {
  it("receives funds for a new subject without changing personal cash", async () => {
    const result = await post(postExternal, {
      type: "RECEIPT",
      subjectName: "Bu Rina",
      accountId: owner.accountIds.reserve,
      amount: "100000",
      businessDate: "2026-09-02",
    });
    expect(result.status).toBe(201);
    expect(await subject("Bu Rina")).toMatchObject({ status: "OPEN", total: "100000", positions: [{ accountName: "Jago", amount: "100000" }] });
    expect((await balances()).Jago).toMatchObject({ physical: "100000", external: "100000", personal: "0" });
  });

  it("returns in full, archives the cleared subject, and reopens it on a new receipt", async () => {
    const dosen = await subject("Dosen");
    await post(postExternal, { type: "RETURN", subjectId: dosen.id, accountId: owner.accountIds.monthly, amount: "431999.93", businessDate: "2026-09-02" });
    expect(await subject("Dosen")).toMatchObject({ status: "CLEARED", total: "0" });
    expect((await balances()).BCA).toMatchObject({ physical: "400000", personal: "400000" });

    expect((await call(archiveSubject, { method: "POST", params: { id: dosen.id } })).status).toBe(204);
    expect(await subject("Dosen")).toMatchObject({ isArchived: true });

    await post(postExternal, { type: "RECEIPT", subjectName: " dosen ", accountId: owner.accountIds.monthly, amount: "5000", businessDate: "2026-09-03" });
    expect(await subject("Dosen")).toMatchObject({ isArchived: false, total: "5000" });
  });

  it("rejects over-returns and archiving a subject with outstanding funds", async () => {
    const dosen = await subject("Dosen");
    const over = await post(postExternal, { type: "RETURN", subjectId: dosen.id, accountId: owner.accountIds.monthly, amount: "431999.94", businessDate: "2026-09-02" });
    expect(over.body.error!.code).toBe("INVARIANT_VIOLATION");
    const archive = await call(archiveSubject, { method: "POST", params: { id: dosen.id } });
    expect(archive.body.error!.details).toEqual({ issues: ["SUBJECT_HAS_OUTSTANDING"] });
  });

  it("moves funds between accounts, converts ownership, and classifies conversions", async () => {
    const dosen = await subject("Dosen");
    await post(postExternal, {
      type: "INTERNAL_TRANSFER",
      subjectId: dosen.id,
      fromAccountId: owner.accountIds.monthly,
      toAccountId: owner.accountIds.reserve,
      amount: "150000",
      businessDate: "2026-09-02",
    });
    await post(postExternal, { type: "CONVERT_TO_PERSONAL", subjectId: dosen.id, accountId: owner.accountIds.reserve, amount: "60000", businessDate: "2026-09-03" });
    await post(postExternal, { type: "CONVERT_TO_EXTERNAL", subjectName: "Adik", accountId: owner.accountIds.monthly, amount: "25000", businessDate: "2026-09-04" });

    const b = await balances();
    expect(b.Jago).toMatchObject({ physical: "150000", external: "90000", personal: "60000" });
    expect(b.BCA).toMatchObject({ physical: "681999.93", external: "306999.93", personal: "375000" });

    const { body } = await call(getActivity);
    const conversions = body.data.items.filter((item: { movementType: string }) => item.movementType?.startsWith("CONVERT"));
    expect(conversions.map((item: { reportingClassification: string }) => item.reportingClassification).sort()).toEqual([
      "OTHER_GIFT_INCOME",
      "OWNERSHIP_OUTFLOW",
    ]);
  });
});

describe("special expenses and categories", () => {
  it("records Vape from the actual source account", async () => {
    const result = await post(postSpecial, { amount: "150000", categoryId: await vapeId(), sourceAccountId: owner.accountIds.monthly, businessDate: "2026-09-02" });
    expect(result.status).toBe(201);
    expect((await balances()).BCA.personal).toBe("250000");
  });

  it("reuses a custom category by normalized name and never stores Lainnya…", async () => {
    const base = { amount: "10000", sourceAccountId: owner.accountIds.monthly, businessDate: "2026-09-02" };
    await post(postSpecial, { ...base, newCategoryName: "  Kopi   Luar " });
    await post(postSpecial, { ...base, newCategoryName: "kopi luar" });
    const reserved = await post(postSpecial, { ...base, newCategoryName: "Lainnya…" });
    expect(reserved.body.error!.details).toEqual({ issues: ["CATEGORY_NAME_RESERVED"] });

    const { body } = await call(getCategories);
    expect(body.data.map((c: { displayName: string }) => c.displayName)).toEqual(["Kopi Luar", "Vape"]);
  });

  it("renames and archives categories while keeping history, and hides archived ones from new expenses", async () => {
    const id = await vapeId();
    await post(postSpecial, { amount: "1000", categoryId: id, sourceAccountId: owner.accountIds.monthly, businessDate: "2026-09-02" });
    expect((await call(patchCategory, { method: "PATCH", params: { id }, body: { displayName: "Rokok elektrik" }, key: null })).status).toBe(204);
    expect((await call(patchCategory, { method: "PATCH", params: { id }, body: { isArchived: true }, key: null })).status).toBe(204);

    const rejected = await post(postSpecial, { amount: "1000", categoryId: id, sourceAccountId: owner.accountIds.monthly, businessDate: "2026-09-03" });
    expect(rejected.body.error!.details).toEqual({ issues: ["CATEGORY_NOT_ACTIVE"] });

    const { body } = await call(getActivity);
    const entry = body.data.items.find((item: { eventClass: string }) => item.eventClass === "SPECIAL_EXPENSE");
    expect(entry.category.displayName).toBe("Rokok elektrik");
    const all = await call(getCategories, { query: "?includeArchived=true" });
    expect(all.body.data).toEqual([expect.objectContaining({ id, isArchived: true })]);
  });
});

describe("other events", () => {
  it("records other income anywhere but rejects ordinary expense on the weekly-settlement account", async () => {
    expect((await post(postEvent, { direction: "INCOME", accountId: owner.accountIds.daily, amount: "20000", businessDate: "2026-09-02" })).status).toBe(201);
    const rejected = await post(postEvent, { direction: "EXPENSE", accountId: owner.accountIds.daily, amount: "1000", businessDate: "2026-09-02" });
    expect(rejected.body.error!.details).toEqual({ issues: ["USE_SPECIAL_EXPENSE_FOR_WEEKLY_ACCOUNT"] });
    expect((await balances()).DANA.personal).toBe("20000");
  });
});

describe("open-period corrections", () => {
  async function specialExpense(amount: string) {
    const result = await post(postSpecial, { amount, categoryId: await vapeId(), sourceAccountId: owner.accountIds.monthly, businessDate: "2026-09-02" });
    return result.body.data.entryId as string;
  }

  it("corrects Rp150.000 to Rp120.000 with a linked reversal and replacement", async () => {
    const id = await specialExpense("150000");
    const result = await call(correct, { method: "POST", params: { id }, body: { action: "REPLACE", amount: "120000", businessDate: "2026-09-02" } });
    expect(result.status).toBe(201);
    expect(result.body.data).toMatchObject({ mode: "OPEN_PERIOD" });
    expect(result.body.data.entryIds).toHaveLength(2);
    expect((await balances()).BCA.personal).toBe("280000");

    const { body } = await call(getActivity);
    const byId = Object.fromEntries(body.data.items.filter((i: { type: string }) => i.type === "LEDGER_ENTRY").map((i: { id: string }) => [i.id, i]));
    expect(byId[id].status).toBe("CORRECTED");
    const [reversal, replacement] = result.body.data.entryIds.map((entryId: string) => byId[entryId]);
    expect(reversal).toMatchObject({ correctionRole: "REVERSAL", correctsEntryId: id, businessDate: "2026-09-02", category: { displayName: "Vape" } });
    expect(replacement).toMatchObject({ correctionRole: "REPLACEMENT", correctsEntryId: id });

    const again = await call(correct, { method: "POST", params: { id }, body: { action: "VOID" } });
    expect(again.body.error!.details).toEqual({ issues: ["ALREADY_CORRECTED"] });
    const onReversal = await call(correct, { method: "POST", params: { id: reversal.id }, body: { action: "VOID" } });
    expect(onReversal.body.error!.details).toEqual({ issues: ["NOT_A_CORRECTABLE_RECORD"] });
    const onReplacement = await call(correct, { method: "POST", params: { id: replacement.id }, body: { action: "VOID" } });
    expect(onReplacement.status).toBe(201);
    expect((await balances()).BCA.personal).toBe("400000");
  });

  it("voids an event that did not happen", async () => {
    const created = await post(postEvent, { direction: "INCOME", accountId: owner.accountIds.monthly, amount: "5000", businessDate: "2026-09-02" });
    await call(correct, { method: "POST", params: { id: created.body.data.entryId }, body: { action: "VOID" } });
    expect((await balances()).BCA.personal).toBe("400000");
    const { body } = await call(getActivity);
    expect(body.data.items.find((i: { id: string }) => i.id === created.body.data.entryId).status).toBe("VOIDED");
  });

  it("checks external holdings only after both correction entries exist", async () => {
    const receipt = await post(postExternal, { type: "RECEIPT", subjectName: "Bu Rina", accountId: owner.accountIds.reserve, amount: "100000", businessDate: "2026-09-02" });
    const rina = await subject("Bu Rina");
    await post(postExternal, { type: "RETURN", subjectId: rina.id, accountId: owner.accountIds.reserve, amount: "80000", businessDate: "2026-09-03" });

    const ok = await call(correct, { method: "POST", params: { id: receipt.body.data.entryId }, body: { action: "REPLACE", amount: "90000", businessDate: "2026-09-02" } });
    expect(ok.status).toBe(201);
    expect((await subject("Bu Rina")).total).toBe("10000");

    const replacementId = ok.body.data.entryIds[1];
    const tooLow = await call(correct, { method: "POST", params: { id: replacementId }, body: { action: "REPLACE", amount: "50000", businessDate: "2026-09-02" } });
    expect(tooLow.body.error!.code).toBe("INVARIANT_VIOLATION");
    expect((await subject("Bu Rina")).total).toBe("10000");
  });
});

describe("idempotency", () => {
  it("replays a retried request, rejects key reuse with another body, and requires a key", async () => {
    const key = randomUUID();
    const body = { direction: "INCOME", accountId: owner.accountIds.monthly, amount: "1000", businessDate: "2026-09-02" };
    const first = await post(postEvent, body, key);
    const retry = await post(postEvent, body, key);
    expect(retry.status).toBe(201);
    expect(retry.headers.get("idempotency-replayed")).toBe("true");
    expect(retry.body.data.entryId).toBe(first.body.data.entryId);
    expect((await balances()).BCA.personal).toBe("401000");

    expect((await post(postEvent, { ...body, amount: "2000" }, key)).body.error!.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect((await post(postEvent, body, null)).status).toBe(428);
  });
});

describe("activity timeline", () => {
  it("lists entries newest first with the opening snapshot and pages with a cursor", async () => {
    for (const amount of ["1000", "2000", "3000"]) {
      await post(postEvent, { direction: "INCOME", accountId: owner.accountIds.monthly, amount, businessDate: "2026-09-02" });
    }
    const first = await call(getActivity, { query: "?limit=2" });
    const entries = first.body.data.items.filter((i: { type: string }) => i.type === "LEDGER_ENTRY");
    expect(entries.map((i: { legs: { physical: string }[] }) => i.legs[0].physical)).toEqual(["3000", "2000"]);
    expect(first.body.data.items.some((i: { type: string }) => i.type === "OPENING_SNAPSHOT")).toBe(true);

    const next = await call(getActivity, { query: `?limit=2&before=${encodeURIComponent(first.body.data.nextCursor)}` });
    expect(next.body.data.items.map((i: { legs: { physical: string }[] }) => i.legs[0].physical)).toEqual(["1000"]);
    expect(next.body.data.nextCursor).toBeNull();
  });
});
