// Financial onboarding through the REST handlers (PRD: Saldo awal, Konfigurasi
// awal yang dibuat onboarding, Locked onboarding and external-funds fixture).
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as confirm } from "@/app/api/v1/onboarding/confirm/route";
import { PUT as putDraft } from "@/app/api/v1/onboarding/draft/route";
import { GET as getOnboarding } from "@/app/api/v1/onboarding/route";
import { bindOwner } from "@/server/bootstrap/bind-owner";
import { defaultOnboardingDraft, type OnboardingDraft } from "@/server/domain/onboarding";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const authAdmin = createClient(url, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const admin = postgres(process.env.ADMIN_DATABASE_URL!, { max: 1, onnotice: () => {} });

const password = `pw-${randomUUID()}`;
const email = `onboarding-${randomUUID()}@fintrack.test`;
let ownerAuthId = "";
let accessToken = "";

type Handler = (request: Request) => Promise<Response>;

async function call(handler: Handler, method: string, options: { body?: unknown; ifMatch?: string } = {}) {
  const headers: Record<string, string> = { authorization: `Bearer ${accessToken}` };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.ifMatch !== undefined) headers["if-match"] = options.ifMatch;
  const response = await handler(
    new Request("http://127.0.0.1:3000/api/v1/onboarding", {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
  );
  const json = (await response.json()) as { data?: Record<string, unknown>; error?: { code: string; details?: unknown } };
  return { status: response.status, etag: response.headers.get("etag"), ...json };
}

/** The locked fixture: BCA holds Rp831.999,93 including Rp431.999,93 owned by Dosen. */
function fixtureDraft(): OnboardingDraft {
  const draft = defaultOnboardingDraft(new Date("2026-09-29T20:00:00+07:00"));
  draft.accounts[0].physicalBalance = "0";
  draft.accounts[1].physicalBalance = "831999.93";
  draft.accounts[2].physicalBalance = "0";
  draft.externals = [{ accountKey: "monthly", subjectName: "Dosen", amount: "431999.93" }];
  draft.routines.subscriptions = [{ name: "Langganan", expectedDay: 5, expectedAmount: "400000", includeCurrentCycle: false }];
  draft.routines.retainedFloor = "400000";
  return draft;
}

beforeAll(async () => {
  const created = await authAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  ownerAuthId = created.data.user.id;
  const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  accessToken = signedIn.data.session.access_token;
});

beforeEach(async () => {
  await admin`truncate fintrack.app_owner cascade`;
  await bindOwner(admin, ownerAuthId);
});

afterAll(async () => {
  await admin`truncate fintrack.app_owner cascade`;
  await authAdmin.auth.admin.deleteUser(ownerAuthId);
  await admin.end();
});

describe("onboarding draft", () => {
  it("starts with a default draft that is not stored yet", async () => {
    const result = await call(getOnboarding, "GET");

    expect(result.status).toBe(200);
    expect(result.etag).toBe('"0"');
    expect(result.data).toMatchObject({ status: "NOT_STARTED", version: 0 });
    const draft = result.data!.draft as OnboardingDraft;
    expect(draft.accounts.map((account) => account.displayName)).toEqual(["Jago", "BCA", "DANA"]);
    expect(draft.routines.dailyIncome.amount).toBe("50000");
  });

  it("saves drafts with optimistic versioning and returns the review", async () => {
    expect((await call(putDraft, "PUT", { body: fixtureDraft() })).status).toBe(428);

    const saved = await call(putDraft, "PUT", { body: fixtureDraft(), ifMatch: '"0"' });
    expect(saved.status).toBe(200);
    expect(saved.etag).toBe('"1"');
    expect(saved.data!.review).toMatchObject({
      totals: { physical: "831999.93", external: "431999.93", personal: "400000", shortfall: "0" },
    });

    const stale = await call(putDraft, "PUT", { body: fixtureDraft(), ifMatch: '"0"' });
    expect(stale.status).toBe(409);
    expect(stale.error!.code).toBe("STALE_VERSION");

    const state = await call(getOnboarding, "GET");
    expect(state.data).toMatchObject({ status: "DRAFT", version: 1 });
  });

  it("rejects amounts with more than two decimals", async () => {
    const draft = fixtureDraft();
    draft.accounts[1].physicalBalance = "831999.931";
    const result = await call(putDraft, "PUT", { body: draft, ifMatch: '"0"' });

    expect(result.status).toBe(422);
    expect(JSON.stringify(result.error!.details)).toContain("TOO_MANY_DECIMALS");
  });
});

describe("onboarding confirmation", () => {
  it("refuses to confirm before a draft exists", async () => {
    const result = await call(confirm, "POST", { ifMatch: '"0"' });
    expect(result.error!.code).toBe("ONBOARDING_NOT_STARTED");
  });

  it("keeps an incomplete draft editable and lists what is missing", async () => {
    const draft = fixtureDraft();
    draft.routines.retainedFloor = null;
    await call(putDraft, "PUT", { body: draft, ifMatch: '"0"' });

    const result = await call(confirm, "POST", { ifMatch: '"1"' });
    expect(result.status).toBe(422);
    expect(result.error!.details).toEqual({ issues: [{ path: "routines.retainedFloor", code: "REQUIRED" }] });
    expect((await call(getOnboarding, "GET")).data).toMatchObject({ status: "DRAFT" });
  });

  it("atomically creates accounts, opening positions, rules, settings, and the Vape category", async () => {
    await call(putDraft, "PUT", { body: fixtureDraft(), ifMatch: '"0"' });
    const result = await call(confirm, "POST", { ifMatch: '"1"' });

    expect(result.status).toBe(201);
    expect(result.data!.boundaries).toEqual({
      cutoverDate: "2026-09-29",
      dailyIncomeStartDate: "2026-09-30",
      monthlyIncomeFirstCycle: "2026-10",
      subscriptionFirstCycles: ["2026-10"],
      bankFeeFirstCycle: "2026-10",
    });

    const accounts = await admin<{ display_name: string; purpose_label: string; physical: string }[]>`
      select a.display_name, a.purpose_label, p.physical_balance_minor::text as physical
      from fintrack.account a join fintrack.opening_account_position p on p.account_id = a.id
      order by a.sort_order`;
    expect(accounts).toEqual([
      { display_name: "Jago", purpose_label: "Reserve", physical: "0" },
      { display_name: "BCA", purpose_label: "Monthly", physical: "83199993" },
      { display_name: "DANA", purpose_label: "Daily", physical: "0" },
    ]);

    const externals = await admin`
      select s.display_name, a.display_name as account, e.amount_minor::text as amount, h.is_default
      from fintrack.opening_external_position e
      join fintrack.external_holding h on h.id = e.holding_id
      join fintrack.external_subject s on s.id = h.subject_id
      join fintrack.account a on a.id = e.account_id`;
    expect(externals).toEqual([{ display_name: "Dosen", account: "BCA", amount: "43199993", is_default: true }]);

    const [rules] = await admin`
      select
        (select row_to_json(d) from (select a.display_name as account, amount_minor::text as amount, effective_start_date::text as start
           from fintrack.daily_income_rule r join fintrack.account a on a.id = r.account_id) d) as daily,
        (select row_to_json(m) from (select a.display_name as account, expected_amount_minor::text as amount, first_expected_cycle as first
           from fintrack.monthly_income_rule r join fintrack.account a on a.id = r.account_id) m) as monthly,
        (select json_agg(o order by o.kind desc) from (select r.kind, r.display_name, a.display_name as account, r.first_cycle,
           v.expected_day, v.expected_amount_minor::text as amount
           from fintrack.recurring_expense_rule r join fintrack.account a on a.id = r.account_id
           join fintrack.recurring_expense_rule_revision v on v.rule_id = r.id) o) as obligations,
        (select retained_balance_floor_minor::text from fintrack.monthly_account_setting) as floor,
        (select a.display_name from fintrack.owner_setting s join fintrack.account a on a.id = s.default_special_source_account_id) as default_source,
        (select json_agg(display_name) from fintrack.special_expense_category) as categories`;
    expect(rules).toEqual({
      daily: { account: "DANA", amount: "5000000", start: "2026-09-30" },
      monthly: { account: "BCA", amount: "75000000", first: "2026-10" },
      obligations: [
        { kind: "SUBSCRIPTION", display_name: "Langganan", account: "BCA", first_cycle: "2026-10", expected_day: 5, amount: "40000000" },
        { kind: "BANK_FEE", display_name: "Biaya bulanan bank", account: "BCA", first_cycle: "2026-10", expected_day: null, amount: null },
      ],
      floor: "40000000",
      default_source: "Jago",
      categories: ["Vape"],
    });

    expect((await call(getOnboarding, "GET")).data).toMatchObject({ status: "CONFIRMED" });
  });

  it("is final: later edits and repeated confirmations are rejected", async () => {
    await call(putDraft, "PUT", { body: fixtureDraft(), ifMatch: '"0"' });
    await call(confirm, "POST", { ifMatch: '"1"' });

    expect((await call(putDraft, "PUT", { body: fixtureDraft(), ifMatch: '"1"' })).error!.code).toBe(
      "ONBOARDING_ALREADY_CONFIRMED",
    );
    expect((await call(confirm, "POST", { ifMatch: '"1"' })).error!.code).toBe("ONBOARDING_ALREADY_CONFIRMED");
  });

  it("confirms exactly once under concurrent requests", async () => {
    await call(putDraft, "PUT", { body: fixtureDraft(), ifMatch: '"0"' });
    const results = await Promise.all([1, 2, 3].map(() => call(confirm, "POST", { ifMatch: '"1"' })));

    expect(results.filter((result) => result.status === 201)).toHaveLength(1);
    const [{ count }] = await admin<{ count: string }[]>`select count(*)::text as count from fintrack.account`;
    expect(count).toBe("3");
  });

  it("rolls back everything when a later step fails", async () => {
    await call(putDraft, "PUT", { body: fixtureDraft(), ifMatch: '"0"' });
    // A pre-existing category row with a conflicting owner-less name cannot exist,
    // so force a failure by making the monthly setting insert violate its check.
    await admin`alter table fintrack.monthly_account_setting add constraint test_force_failure check (retained_balance_floor_minor < 0) not valid`;
    try {
      const result = await call(confirm, "POST", { ifMatch: '"1"' });
      expect(result.status).toBe(500);
    } finally {
      await admin`alter table fintrack.monthly_account_setting drop constraint test_force_failure`;
    }

    const [{ accounts, drafts }] = await admin<{ accounts: string; drafts: string }[]>`
      select (select count(*) from fintrack.account)::text as accounts,
             (select count(*) from fintrack.onboarding_snapshot where status = 'DRAFT')::text as drafts`;
    expect({ accounts, drafts }).toEqual({ accounts: "0", drafts: "1" });
  });
});
