// Ledger core (S3): posting guards, balances, append-only storage, and opening
// snapshot correction, driven by the locked external-funds fixture.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET as getAccounts } from "@/app/api/v1/accounts/route";
import { POST as correctOpening } from "@/app/api/v1/onboarding/opening-corrections/route";
import { parseIdrDecimal as rp } from "@/lib/money";
import { accountBalances, postLedgerEntry, type CutoverDayAnswer } from "@/server/application/ledger";
import type { LedgerEntryDraft, LedgerLeg } from "@/server/domain/ledger";

import {
  asOwner,
  closeClients,
  createAuthUser,
  resetWithConfirmedFixture,
  testClients,
  type ConfirmedOwner,
  type TestUser,
} from "../helpers/owner";

const clients = testClients();
const CUTOVER = "2026-09-01T10:00:00+07:00";
let user: TestUser;
let owner: ConfirmedOwner;

const now = () => new Date();

function leg(account: "reserve" | "monthly" | "daily", physical: string, external = "0"): LedgerLeg {
  return {
    accountId: owner.accountIds[account],
    physicalEffect: rp(physical),
    externalEffect: rp(external),
    holdingId: external === "0" ? null : owner.dosenHoldingId,
  };
}

function post(draft: LedgerEntryDraft, cutoverDayAnswer?: CutoverDayAnswer) {
  return asOwner(clients.runtime, user.id, (tx, principal) =>
    postLedgerEntry(tx, principal.ownerId, draft, { now: now(), cutoverDayAnswer }),
  );
}

const step = (date: string, kind: LedgerEntryDraft["kind"], legs: LedgerLeg[], classification: LedgerEntryDraft["reportingClassification"] = null) =>
  ({ kind, effectiveBusinessDate: date, reportingClassification: classification, legs }) satisfies LedgerEntryDraft;

/** PRD fixture steps 1–7 on consecutive days after the cutover. */
function fixtureSteps(): LedgerEntryDraft[] {
  return [
    step("2026-09-02", "EXTERNAL_MOVEMENT", [leg("monthly", "200000", "200000")]),
    step("2026-09-03", "EXTERNAL_MOVEMENT", [leg("monthly", "-150000", "-150000")]),
    step("2026-09-04", "EXTERNAL_MOVEMENT", [leg("monthly", "-80000", "-80000")]),
    step("2026-09-05", "TRANSFER", [leg("monthly", "-250000", "-150000"), leg("reserve", "250000", "150000")]),
    step("2026-09-06", "EXPENSE", [leg("monthly", "-350000")]),
    step("2026-09-07", "TRANSFER", [leg("reserve", "-70000"), leg("monthly", "70000")]),
    step("2026-09-08", "EXTERNAL_MOVEMENT", [leg("reserve", "0", "-60000")], "OTHER_GIFT_INCOME"),
  ];
}

/** End-of-day position: every entry of that business date counts. */
async function balancesAt(date: string) {
  const instant = new Date(`${date}T23:59:00+07:00`);
  const recordedAt = new Date("9999-12-31T00:00:00Z");
  return asOwner(clients.runtime, user.id, (tx, principal) => accountBalances(tx, principal.ownerId, { instant, recordedAt }));
}

async function api(handler: (request: Request) => Promise<Response>, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${user.accessToken}`);
  const response = await handler(new Request("http://127.0.0.1:3000/api/v1", { ...init, headers }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response shapes vary per route in these tests
  type Body = { data?: any; error?: { code: string; details?: unknown } };
  return { status: response.status, body: (await response.json()) as Body };
}

async function entryCount(): Promise<number> {
  const [{ count }] = await clients.admin<{ count: number }[]>`select count(*)::int as count from fintrack.ledger_entry`;
  return count;
}

beforeAll(async () => {
  user = await createAuthUser(clients.authAdmin, "ledger");
});

beforeEach(async () => {
  owner = await resetWithConfirmedFixture(clients, user.id, CUTOVER);
});

afterAll(async () => {
  await clients.admin`truncate fintrack.app_owner cascade`;
  await clients.authAdmin.auth.admin.deleteUser(user.id);
  await closeClients(clients);
});

describe("posting the locked external-funds fixture", () => {
  it("reproduces the locked balances through the accounts API", async () => {
    for (const draft of fixtureSteps()) expect(await post(draft)).toMatchObject({ recorded: true });

    const { status, body } = await api(getAccounts);
    expect(status).toBe(200);
    const byName = Object.fromEntries(body.data.accounts.map((a: { displayName: string }) => [a.displayName, a]));
    expect(byName.BCA).toMatchObject({ physical: "271999.93", external: "251999.93", personal: "20000", shortfall: "0" });
    expect(byName.Jago).toMatchObject({ physical: "180000", external: "90000", personal: "90000" });
    expect(byName.DANA).toMatchObject({ physical: "0", personal: "0", status: "OPEN_WEEK", openWeekDisclosure: true });
    expect(byName.BCA.status).toBe("CALCULATED_AFTER_CONFIRMATION");
    expect(byName.BCA.confirmedPersonal).toBe("400000");
    expect(body.data.personalCashRecorded).toBe("110000");
    expect(body.data.accounts.map((a: { displayName: string }) => a.displayName)).toEqual(["Jago", "BCA", "DANA"]);
  });

  it("shows the BCA shortfall as of the day of the personal expense", async () => {
    for (const draft of fixtureSteps()) await post(draft);

    const { accounts } = await balancesAt("2026-09-06");
    expect(accounts.find((a) => a.displayName === "BCA")).toMatchObject({ personal: "-50000", shortfall: "50000" });
  });

  it("rejects a return that would make the Dosen holding negative and writes nothing", async () => {
    const before = await entryCount();
    await expect(post(step("2026-09-02", "EXTERNAL_MOVEMENT", [leg("monthly", "-432000", "-432000")]))).rejects.toMatchObject({
      code: "INVARIANT_VIOLATION",
    });
    expect(await entryCount()).toBe(before);
  });

  it("rejects a backdated return that breaks a later movement's history", async () => {
    for (const draft of fixtureSteps().slice(0, 4)) await post(draft);
    // Moving Rp150.000 to Jago on 5 September needs that much still at BCA on that date.
    await expect(post(step("2026-09-02", "EXTERNAL_MOVEMENT", [leg("monthly", "-400000", "-400000")]))).rejects.toMatchObject({
      code: "INVARIANT_VIOLATION",
    });
  });
});

describe("posting guards", () => {
  it("asks whether a cutover-day event is already in the opening balance", async () => {
    const expense = step("2026-09-01", "EXPENSE", [leg("monthly", "-10000")]);

    await expect(post(expense)).rejects.toMatchObject({ code: "CUTOVER_DAY_CONFIRMATION_REQUIRED" });
    expect(await post(expense, "ALREADY_IN_OPENING")).toEqual({ recorded: false, reason: "ALREADY_IN_OPENING" });
    expect(await entryCount()).toBe(0);
    expect(await post(expense, "NOT_IN_OPENING")).toMatchObject({ recorded: true });
    expect(await entryCount()).toBe(1);
  });

  it("rejects dates before the cutover or in the future", async () => {
    await expect(post(step("2026-08-31", "EXPENSE", [leg("monthly", "-1")]))).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: { issues: ["BUSINESS_DATE_BEFORE_CUTOVER"] },
    });
    await expect(post(step("2099-01-01", "EXPENSE", [leg("monthly", "-1")]))).rejects.toMatchObject({
      details: { issues: ["BUSINESS_DATE_IN_FUTURE"] },
    });
  });

  it("rejects unbalanced transfers before touching the database", async () => {
    await expect(post(step("2026-09-02", "TRANSFER", [leg("monthly", "-100"), leg("reserve", "90")]))).rejects.toMatchObject({
      details: { issues: ["TRANSFER_MUST_BALANCE"] },
    });
  });

  it("keeps the ledger append-only for the runtime role", async () => {
    await post(step("2026-09-02", "EXPENSE", [leg("monthly", "-10000")]));
    for (const statement of ["update fintrack.ledger_entry set note = 'x'", "delete from fintrack.ledger_leg"]) {
      const error = await asOwner(clients.runtime, user.id, (tx) => tx.execute(statement as never)).catch((e: Error) => e);
      expect(String((error as Error).cause ?? error)).toMatch(/permission denied/);
    }
  });

  it("orders same-day events by recorded time for as-of balances", async () => {
    const first = await post(step("2026-09-02", "EXPENSE", [leg("monthly", "-10000")]));
    await post(step("2026-09-02", "EXPENSE", [leg("monthly", "-5000")]));

    // The as-of record time comes from the database clock, as a real confirmation would.
    const [{ recorded_at }] = await clients.admin<{ recorded_at: Date }[]>`
      select recorded_at from fintrack.ledger_entry where id = ${first.recorded ? first.entryId : ""}`;
    const asOf = { instant: new Date("2026-09-02T21:00:00+07:00"), recordedAt: recorded_at };
    const { accounts } = await asOwner(clients.runtime, user.id, (tx, principal) => accountBalances(tx, principal.ownerId, asOf));
    expect(accounts.find((a) => a.displayName === "BCA")!.physical).toBe("821999.93");
  });
});

describe("opening snapshot correction", () => {
  const correction = (bca: string, dosen: string) => ({
    accounts: [
      { accountId: owner.accountIds.reserve, physicalBalance: "0" },
      { accountId: owner.accountIds.monthly, physicalBalance: bca },
      { accountId: owner.accountIds.daily, physicalBalance: "0" },
    ],
    externals: [{ accountId: owner.accountIds.monthly, subjectName: "Dosen", amount: dosen }],
  });

  const send = (ifMatch: string | null, body: unknown) =>
    api(correctOpening, {
      method: "POST",
      headers: { "content-type": "application/json", ...(ifMatch ? { "if-match": `"${ifMatch}"` } : {}) },
      body: JSON.stringify(body),
    });

  it("supersedes the opening without creating any financial event", async () => {
    const result = await send(owner.snapshotId, correction("832000", "432000"));
    expect(result.status).toBe(201);
    expect(result.body.data.supersedesId).toBe(owner.snapshotId);

    const snapshots = await clients.admin<{ id: string; superseded_by_id: string | null }[]>`
      select id, superseded_by_id from fintrack.onboarding_snapshot order by created_at`;
    expect(snapshots).toEqual([
      { id: owner.snapshotId, superseded_by_id: result.body.data.snapshotId },
      { id: result.body.data.snapshotId, superseded_by_id: null },
    ]);
    expect(await entryCount()).toBe(0);

    const { accounts } = await balancesAt("2026-09-01");
    expect(accounts.find((a) => a.displayName === "BCA")).toMatchObject({ physical: "832000", external: "432000", personal: "400000" });
  });

  it("requires the current snapshot in If-Match and rejects no-op corrections", async () => {
    expect((await send(null, correction("832000", "432000"))).status).toBe(428);
    expect((await send(owner.snapshotId, correction("831999.93", "431999.93"))).body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: { issues: ["NO_CHANGE"] },
    });

    await send(owner.snapshotId, correction("832000", "432000"));
    expect((await send(owner.snapshotId, correction("833000", "432000"))).body.error!.code).toBe("STALE_VERSION");
  });

  it("refuses a correction that would make later external movements go negative", async () => {
    for (const draft of fixtureSteps()) await post(draft);
    // Later movements take Rp150.000 + Rp80.000 + Rp150.000 out of the Dosen holding at BCA.
    const result = await send(owner.snapshotId, correction("831999.93", "100000"));
    expect(result.body.error!.code).toBe("INVARIANT_VIOLATION");
  });
});
