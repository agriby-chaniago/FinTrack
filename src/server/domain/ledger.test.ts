import { describe, expect, it } from "vitest";

import { parseIdrDecimal as rp } from "@/lib/money";

import {
  balancesFrom,
  cutoverRelation,
  includedAsOf,
  ledgerIssues,
  negativeHoldingPositions,
  reportingContribution,
  type LedgerEntryDraft,
  type LedgerLeg,
} from "./ledger";

const BCA = "bca";
const JAGO = "jago";
const DOSEN = "dosen-holding";

const leg = (accountId: string, physical: string, external = "0", holdingId: string | null = null): LedgerLeg => ({
  accountId,
  physicalEffect: rp(physical),
  externalEffect: rp(external),
  holdingId: external === "0" ? holdingId : (holdingId ?? DOSEN),
});

const classOf: Record<string, LedgerEntryDraft["eventClass"]> = {
  INCOME: "OTHER_INCOME",
  EXPENSE: "OTHER_EXPENSE",
  TRANSFER: "PERSONAL_TRANSFER",
  EXTERNAL_MOVEMENT: "EXTERNAL_MOVEMENT",
};

const entry = (
  kind: LedgerEntryDraft["kind"],
  legs: LedgerLeg[],
  reportingClassification: LedgerEntryDraft["reportingClassification"] = null,
  movementType: LedgerEntryDraft["movementType"] = null,
): LedgerEntryDraft => ({
  kind,
  eventClass: classOf[kind] ?? "ADJUSTMENT",
  effectiveBusinessDate: "2027-03-01",
  reportingClassification,
  movementType,
  legs,
});

/** PRD "Locked onboarding and external-funds fixture", steps 1–7. */
const fixtureSteps: LedgerEntryDraft[] = [
  entry("EXTERNAL_MOVEMENT", [leg(BCA, "200000", "200000")], null, "RECEIPT"),
  entry("EXTERNAL_MOVEMENT", [leg(BCA, "-150000", "-150000")], null, "RETURN"),
  entry("EXTERNAL_MOVEMENT", [leg(BCA, "-80000", "-80000")], null, "OWNER_USE"),
  entry("TRANSFER", [leg(BCA, "-250000", "-150000"), leg(JAGO, "250000", "150000")]), // mixed transfer
  entry("EXPENSE", [leg(BCA, "-350000")]), // personal expense
  entry("TRANSFER", [leg(JAGO, "-70000"), leg(BCA, "70000")]), // personal replenishment
  entry("EXTERNAL_MOVEMENT", [leg(JAGO, "0", "-60000")], "OTHER_GIFT_INCOME", "CONVERT_TO_PERSONAL"),
];

const openings = new Map([
  [BCA, { physical: rp("831999.93"), external: rp("431999.93") }],
  [JAGO, { physical: 0n, external: 0n }],
]);

describe("locked external-funds fixture", () => {
  it("passes the generic ledger invariants at every step", () => {
    for (const step of fixtureSteps) expect(ledgerIssues(step)).toEqual([]);
  });

  it("shows the BCA shortfall after the personal expense without clamping", () => {
    const afterStep5 = balancesFrom(openings, fixtureSteps.slice(0, 5).flatMap((step) => step.legs));
    expect(afterStep5.get(BCA)).toEqual({
      physical: rp("201999.93"),
      external: rp("251999.93"),
      personal: rp("-50000"),
      shortfall: rp("50000"),
    });
  });

  it("ends with the locked physical, external, and personal totals", () => {
    const final = balancesFrom(openings, fixtureSteps.flatMap((step) => step.legs));
    expect(final.get(BCA)).toMatchObject({ physical: rp("271999.93"), external: rp("251999.93"), personal: rp("20000") });
    expect(final.get(JAGO)).toMatchObject({ physical: rp("180000"), external: rp("90000"), personal: rp("90000") });

    const totals = [...final.values()].reduce(
      (sum, b) => ({ physical: sum.physical + b.physical, external: sum.external + b.external, personal: sum.personal + b.personal }),
      { physical: 0n, external: 0n, personal: 0n },
    );
    expect(totals).toEqual({ physical: rp("451999.93"), external: rp("341999.93"), personal: rp("110000") });
  });

  it("never lets an external holding go negative", () => {
    const effects = fixtureSteps.flatMap((step) =>
      step.legs.filter((l) => l.holdingId).map((l) => ({ accountId: l.accountId, holdingId: l.holdingId!, externalEffect: l.externalEffect })),
    );
    const opening = [{ accountId: BCA, holdingId: DOSEN, amount: rp("431999.93") }];
    expect(negativeHoldingPositions(opening, effects)).toEqual([]);

    const overReturn = [...effects, { accountId: JAGO, holdingId: DOSEN, externalEffect: rp("-90000.01") }];
    expect(negativeHoldingPositions(opening, overReturn)).toEqual([`${JAGO}:${DOSEN}`]);
  });
});

describe("ledgerIssues", () => {
  it.each([
    [entry("INCOME", [leg(BCA, "-1")]), "INCOME_MUST_INCREASE"],
    [entry("EXPENSE", [leg(BCA, "1")]), "EXPENSE_MUST_DECREASE"],
    [entry("EXPENSE", [leg(BCA, "-1"), leg(JAGO, "-1")]), "SINGLE_LEG_REQUIRED"],
    [entry("EXPENSE", [leg(BCA, "-1", "-1")]), "EXTERNAL_NOT_ALLOWED"],
    [entry("TRANSFER", [leg(BCA, "-100"), leg(JAGO, "90")]), "TRANSFER_MUST_BALANCE"],
    [entry("TRANSFER", [leg(BCA, "-100"), leg(BCA, "100")]), "TRANSFER_NEEDS_TWO_ACCOUNTS"],
    [entry("EXTERNAL_MOVEMENT", [leg(BCA, "100")], null, "RECEIPT"), "EXTERNAL_EFFECT_REQUIRED"],
    [entry("EXTERNAL_MOVEMENT", [leg(JAGO, "0", "-60000")], null, "CONVERT_TO_PERSONAL"), "CLASSIFICATION_MISMATCH"],
    [entry("EXTERNAL_MOVEMENT", [leg(BCA, "100", "100")], "OTHER_GIFT_INCOME", "RECEIPT"), "CLASSIFICATION_MISMATCH"],
    [entry("EXTERNAL_MOVEMENT", [leg(BCA, "-100", "-100")], null, "RECEIPT"), "MOVEMENT_TYPE_MISMATCH"],
    [entry("EXTERNAL_MOVEMENT", [leg(BCA, "100", "100")]), "MOVEMENT_TYPE_MISMATCH"],
    [entry("INCOME", [leg(BCA, "0")]), "EMPTY_LEG"],
    [entry("INCOME", []), "NO_LEGS"],
  ])("rejects %#", (draft, code) => {
    expect(ledgerIssues(draft)).toContain(code);
  });

  it("requires a holding exactly when the external effect is non-zero", () => {
    expect(ledgerIssues(entry("EXTERNAL_MOVEMENT", [{ accountId: BCA, physicalEffect: 1n, externalEffect: 1n, holdingId: null }], null, "RECEIPT"))).toContain(
      "HOLDING_REQUIRED",
    );
    expect(ledgerIssues(entry("INCOME", [{ accountId: BCA, physicalEffect: 1n, externalEffect: 0n, holdingId: DOSEN }]))).toContain(
      "HOLDING_NOT_ALLOWED",
    );
  });

  it("requires a reference for reversals and settled-history corrections, skipping sign rules", () => {
    const reversal = { ...entry("EXPENSE", [leg(BCA, "100")]), correctionRole: "REVERSAL" as const };
    expect(ledgerIssues(reversal)).toEqual(["CORRECTION_REFERENCE_REQUIRED"]);
    expect(ledgerIssues({ ...reversal, correctsEntryId: "original" })).toEqual([]);
  });

  it("classifies personal → external conversions as ownership outflow", () => {
    expect(ledgerIssues(entry("EXTERNAL_MOVEMENT", [leg(BCA, "0", "25000")], "OWNERSHIP_OUTFLOW", "CONVERT_TO_EXTERNAL"))).toEqual([]);
  });
});

describe("reportingContribution", () => {
  it("follows the PRD correction example: Rp150.000 → Rp120.000 is +Rp30.000 cash and −Rp30.000 expense", () => {
    expect(reportingContribution("EXPENSE", rp("30000"))).toBe(rp("-30000"));
    expect(reportingContribution("INCOME", rp("50000"))).toBe(rp("50000"));
    expect(reportingContribution("TRANSFER", rp("-70000"))).toBe(0n);
  });
});

describe("time rules", () => {
  const confirmation = { instant: new Date("2027-03-01T21:00:00+07:00"), recordedAt: new Date("2027-03-01T21:05:00+07:00") };

  it("includes same-day events only when recorded before the confirmation record", () => {
    expect(includedAsOf({ effectiveBusinessDate: "2027-02-28", recordedAt: new Date("2027-03-02T08:00:00+07:00") }, confirmation)).toBe(true);
    expect(includedAsOf({ effectiveBusinessDate: "2027-03-01", recordedAt: new Date("2027-03-01T20:00:00+07:00") }, confirmation)).toBe(true);
    expect(includedAsOf({ effectiveBusinessDate: "2027-03-01", recordedAt: new Date("2027-03-01T22:00:00+07:00") }, confirmation)).toBe(false);
    expect(includedAsOf({ effectiveBusinessDate: "2027-03-02", recordedAt: new Date("2027-03-01T20:00:00+07:00") }, confirmation)).toBe(false);
  });

  it("classifies dates against the Jakarta cutover date", () => {
    const cutover = new Date("2026-10-07T12:00:00+07:00");
    expect(cutoverRelation("2026-10-06", cutover)).toBe("BEFORE_CUTOVER");
    expect(cutoverRelation("2026-10-07", cutover)).toBe("CUTOVER_DAY");
    expect(cutoverRelation("2026-10-08", cutover)).toBe("AFTER_CUTOVER");
    // 23:30 UTC on 6 October is already 7 October in Jakarta.
    expect(cutoverRelation("2026-10-06", new Date("2026-10-06T23:30:00Z"))).toBe("BEFORE_CUTOVER");
  });
});
