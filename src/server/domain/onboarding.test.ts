import { describe, expect, it } from "vitest";

import {
  confirmationIssues,
  defaultOnboardingDraft,
  onboardingDraftSchema,
  reviewOnboarding,
  serializeReview,
  type OnboardingDraft,
} from "./onboarding";

const now = new Date("2026-10-07T12:00:00+07:00"); // Wednesday

/** PRD "Locked onboarding and external-funds fixture": BCA with Dosen funds. */
function fixtureDraft(): OnboardingDraft {
  const draft = defaultOnboardingDraft(now);
  draft.cutoverAt = "2026-10-07T12:00:00+07:00";
  draft.accounts[0].physicalBalance = "0";
  draft.accounts[1].physicalBalance = "831999.93";
  draft.accounts[2].physicalBalance = "0";
  draft.externals = [{ accountKey: "monthly", subjectName: "Dosen", amount: "431999.93" }];
  draft.routines.subscriptions = [{ name: "Langganan", expectedDay: 5, expectedAmount: "400000", includeCurrentCycle: false }];
  draft.routines.retainedFloor = "400000";
  return draft;
}

describe("onboarding draft schema", () => {
  it("accepts the default draft", () => {
    expect(onboardingDraftSchema.safeParse(defaultOnboardingDraft(now)).success).toBe(true);
  });

  it("rejects amounts with more than two decimals instead of rounding", () => {
    const draft = fixtureDraft();
    draft.accounts[1].physicalBalance = "831999.931";
    const result = onboardingDraftSchema.safeParse(draft);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("TOO_MANY_DECIMALS");
  });

  it("rejects duplicate account keys", () => {
    const draft = fixtureDraft();
    draft.accounts[2].key = "monthly";
    expect(onboardingDraftSchema.safeParse(draft).success).toBe(false);
  });
});

describe("reviewOnboarding", () => {
  it("reproduces the locked onboarding fixture exactly", () => {
    const review = serializeReview(reviewOnboarding(fixtureDraft()));

    expect(review.accounts).toEqual([
      { key: "reserve", physical: "0", external: "0", personal: "0", shortfall: "0" },
      { key: "monthly", physical: "831999.93", external: "431999.93", personal: "400000", shortfall: "0" },
      { key: "daily", physical: "0", external: "0", personal: "0", shortfall: "0" },
    ]);
    expect(review.totals).toEqual({ physical: "831999.93", external: "431999.93", personal: "400000", shortfall: "0" });
  });

  it("shows a negative personal balance and shortfall without clamping", () => {
    const draft = fixtureDraft();
    draft.externals[0].amount = "900000";
    const review = serializeReview(reviewOnboarding(draft));

    expect(review.accounts[1]).toMatchObject({ personal: "-68000.07", shortfall: "68000.07" });
  });

  it("derives automation boundaries from the Asia/Jakarta cutover date", () => {
    const draft = fixtureDraft();
    expect(reviewOnboarding(draft).boundaries).toEqual({
      cutoverDate: "2026-10-07",
      dailyIncomeStartDate: "2026-10-08",
      monthlyIncomeFirstCycle: "2026-11",
      subscriptionFirstCycles: ["2026-11"],
      bankFeeFirstCycle: "2026-11",
    });

    draft.routines.dailyIncome.startOnCutoverDay = true;
    draft.routines.subscriptions[0].includeCurrentCycle = true;
    expect(reviewOnboarding(draft).boundaries).toMatchObject({
      dailyIncomeStartDate: "2026-10-07",
      monthlyIncomeFirstCycle: "2026-11",
      subscriptionFirstCycles: ["2026-10"],
    });
  });

  it("uses the Jakarta date even when the cutover instant is still the previous UTC day", () => {
    const draft = fixtureDraft();
    draft.cutoverAt = "2026-10-31T18:30:00Z"; // 1 November 01:30 in Jakarta
    expect(reviewOnboarding(draft).boundaries).toMatchObject({
      cutoverDate: "2026-11-01",
      dailyIncomeStartDate: "2026-11-02",
      monthlyIncomeFirstCycle: "2026-12",
    });
  });
});

describe("confirmationIssues", () => {
  it("accepts a complete draft", () => {
    expect(confirmationIssues(fixtureDraft(), now)).toEqual([]);
  });

  it("requires every balance, the floor, and complete subscriptions", () => {
    const draft = defaultOnboardingDraft(now);
    const paths = confirmationIssues(draft, now).map((issue) => `${issue.path}:${issue.code}`);

    expect(paths).toEqual(
      expect.arrayContaining([
        "accounts.0.physicalBalance:REQUIRED",
        "accounts.1.physicalBalance:REQUIRED",
        "accounts.2.physicalBalance:REQUIRED",
        "routines.subscriptions.0.name:REQUIRED",
        "routines.subscriptions.0.expectedAmount:REQUIRED",
        "routines.retainedFloor:REQUIRED",
      ]),
    );
  });

  it("accepts Rp0 as an explicit floor but rejects negative balances and a future cutover", () => {
    const draft = fixtureDraft();
    draft.routines.retainedFloor = "0";
    draft.accounts[0].physicalBalance = "-1";
    draft.cutoverAt = "2026-10-08T12:00:00+07:00";

    expect(confirmationIssues(draft, now)).toEqual([
      { path: "cutoverAt", code: "CUTOVER_IN_FUTURE" },
      { path: "accounts.0.physicalBalance", code: "MUST_NOT_BE_NEGATIVE" },
    ]);
  });

  it("rejects duplicate subscriptions and duplicate external subjects per account", () => {
    const draft = fixtureDraft();
    draft.routines.subscriptions.push({ name: "  langganan ", expectedDay: 10, expectedAmount: "1000", includeCurrentCycle: false });
    draft.externals.push({ accountKey: "monthly", subjectName: "DOSEN", amount: "1" });

    expect(confirmationIssues(draft, now)).toEqual([
      { path: "externals.1.subjectName", code: "DUPLICATE_NAME" },
      { path: "routines.subscriptions.1.name", code: "DUPLICATE_NAME" },
    ]);
  });

  it("allows an empty bank-fee expectation but rejects a non-positive amount", () => {
    const draft = fixtureDraft();
    expect(confirmationIssues(draft, now)).toEqual([]);
    draft.routines.bankFee.expectedAmount = "0";
    expect(confirmationIssues(draft, now)).toEqual([{ path: "routines.bankFee.expectedAmount", code: "MUST_BE_POSITIVE" }]);
  });
});
