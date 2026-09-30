import { describe, expect, it } from "vitest";

import { parseIdrDecimal as rp } from "@/lib/money";

import {
  classifyFlow,
  dailyIncomeBetween,
  defaultTransitionDate,
  reconstruct,
  roundedAverage,
  settlementPlan,
  settlementRangeIssues,
  stateOn,
  transitionIssues,
  weekEndOn,
  type Transition,
} from "./daily-income";

const rule = { amount: rp("50000"), startDate: "2027-02-01" };

describe("daily income", () => {
  it("applies inclusive pause and resume dates", () => {
    const transitions: Transition[] = [
      { id: "p", toState: "PAUSED", effectiveDate: "2027-02-26" },
      { id: "r", toState: "ACTIVE", effectiveDate: "2027-02-28" },
    ];
    expect(stateOn("2027-02-25", rule.startDate, transitions)).toBe("ACTIVE");
    expect(stateOn("2027-02-26", rule.startDate, transitions)).toBe("PAUSED");
    expect(stateOn("2027-02-27", rule.startDate, transitions)).toBe("PAUSED");
    expect(stateOn("2027-02-28", rule.startDate, transitions)).toBe("ACTIVE");
    expect(stateOn("2027-01-31", rule.startDate, transitions)).toBe("NOT_STARTED");
  });

  it("reproduces the locked February fixture income per week", () => {
    const week1 = dailyIncomeBetween(rule, [], [], "2027-02-01", "2027-02-07");
    const week2 = dailyIncomeBetween(rule, [], [{ businessDate: "2027-02-10", amount: 0n }], "2027-02-08", "2027-02-14");
    const pause: Transition[] = [
      { id: "p", toState: "PAUSED", effectiveDate: "2027-02-24" },
      { id: "r", toState: "ACTIVE", effectiveDate: "2027-02-26" },
    ];
    const week4 = dailyIncomeBetween(rule, pause, [], "2027-02-22", "2027-02-28");

    expect(week1).toMatchObject({ recognized: rp("350000"), eligibleDays: 7, receivedDays: 7 });
    // Override Rp0 keeps the day ACTIVE: eligible 7, received 6.
    expect(week2).toMatchObject({ scheduled: rp("350000"), recognized: rp("300000"), eligibleDays: 7, receivedDays: 6 });
    expect(week4).toMatchObject({ recognized: rp("250000"), eligibleDays: 5 });
  });

  it("ignores overrides on paused dates", () => {
    const paused: Transition[] = [{ id: "p", toState: "PAUSED", effectiveDate: "2027-02-03" }];
    expect(dailyIncomeBetween(rule, paused, [{ businessDate: "2027-02-04", amount: rp("99000") }], "2027-02-01", "2027-02-07").recognized).toBe(rp("100000"));
  });
});

describe("transition rules", () => {
  const base = { startDate: "2027-02-01", lastSettledEnd: "2027-02-07", today: "2027-02-10", transitions: [] as Transition[] };

  it("defaults to today, or the first open date after settlement", () => {
    expect(defaultTransitionDate("2027-02-01", "2027-02-07", "2027-02-10")).toBe("2027-02-10");
    expect(defaultTransitionDate("2027-02-01", "2027-02-14", "2027-02-14")).toBe("2027-02-15");
  });

  it("rejects backdating into a settled period, no-ops, duplicates, and a second upcoming transition", () => {
    expect(transitionIssues({ ...base, toState: "PAUSED", effectiveDate: "2027-02-07" })).toContain("BEFORE_OPEN_PERIOD");
    expect(transitionIssues({ ...base, toState: "ACTIVE", effectiveDate: "2027-02-09" })).toContain("NO_OP");
    const upcoming: Transition[] = [{ id: "u", toState: "PAUSED", effectiveDate: "2027-02-20" }];
    expect(transitionIssues({ ...base, transitions: upcoming, toState: "ACTIVE", effectiveDate: "2027-02-25" })).toContain("UPCOMING_EXISTS");
    expect(transitionIssues({ ...base, transitions: upcoming, toState: "PAUSED", effectiveDate: "2027-02-20" })).toContain("DUPLICATE_DATE");
    expect(transitionIssues({ ...base, transitions: upcoming, toState: "PAUSED", effectiveDate: "2027-02-12" })).toContain(
      "CONFLICTS_WITH_LATER_TRANSITION",
    );
    expect(transitionIssues({ ...base, transitions: upcoming, toState: "ACTIVE", effectiveDate: "2027-02-22" })).toEqual(["UPCOMING_EXISTS"]);
    expect(transitionIssues({ ...base, toState: "PAUSED", effectiveDate: "2027-02-08" })).toEqual([]);
  });
});

describe("settlement plan", () => {
  it("uses Monday–Sunday weeks with a partial first period", () => {
    expect(weekEndOn("2027-02-03")).toBe("2027-02-07");
    expect(weekEndOn("2027-02-07")).toBe("2027-02-07");
    expect(settlementPlan("2027-02-03", null, "2027-02-05")).toEqual({ periodStart: "2027-02-03", normalEnd: "2027-02-07", status: "INFORMATIONAL" });
    expect(settlementPlan("2027-02-03", "2027-02-07", "2027-02-14").status).toBe("DUE");
    expect(settlementPlan("2027-02-03", "2027-02-07", "2027-02-20").status).toBe("OVERDUE");
  });

  it("allows a catch-up range only when overdue", () => {
    const overdue = settlementPlan("2027-02-01", "2027-02-07", "2027-02-24");
    expect(settlementRangeIssues(overdue, "2027-02-14", "2027-02-24")).toEqual([]);
    expect(settlementRangeIssues(overdue, "2027-02-23", "2027-02-24")).toEqual([]);
    expect(settlementRangeIssues(overdue, "2027-02-12", "2027-02-24")).toEqual(["NONSTANDARD_RANGE"]);
    expect(settlementRangeIssues(overdue, "2027-02-25", "2027-02-24")).toEqual(["END_IN_FUTURE"]);
    const due = settlementPlan("2027-02-01", "2027-02-07", "2027-02-14");
    expect(settlementRangeIssues(due, "2027-02-13", "2027-02-14")).toEqual(["NONSTANDARD_RANGE"]);
  });
});

describe("reconstruction", () => {
  const income = (amount: string) => ({ days: [], scheduled: rp(amount), recognized: rp(amount), eligibleDays: 7, receivedDays: 7 });

  it("derives living expense and the rounded average for the locked week 1", () => {
    const result = reconstruct({ openingPersonal: 0n, income: income("350000"), flows: [], settlementDays: 7, closingPhysical: rp("110000"), closingExternal: 0n });
    expect(result).toMatchObject({ livingExpense: rp("240000"), averagePerDay: rp("34286"), availableRemainder: rp("110000") });
  });

  it("excludes special expense and ownership-neutral movements from living cost and allows a negative result", () => {
    const special = classifyFlow({ kind: "EXPENSE", eventClass: "SPECIAL_EXPENSE", reportingClassification: null, correctionRole: null }, rp("-150000"));
    const neutral = classifyFlow({ kind: "EXTERNAL_MOVEMENT", eventClass: "EXTERNAL_MOVEMENT", reportingClassification: null, correctionRole: null }, 0n);
    const result = reconstruct({
      openingPersonal: 0n,
      income: income("350000"),
      flows: [special, neutral],
      settlementDays: 7,
      closingPhysical: rp("300000"),
      closingExternal: 0n,
    });
    expect(result).toMatchObject({ nonLivingDeductions: rp("150000"), livingExpense: rp("-100000"), averagePerDay: rp("-14286") });
  });

  it("subtracts reversals from the bucket of the transfer they reverse", () => {
    const out = classifyFlow({ kind: "TRANSFER", eventClass: "PERSONAL_TRANSFER", reportingClassification: null, correctionRole: null }, rp("-100"));
    const reversal = classifyFlow({ kind: "TRANSFER", eventClass: "PERSONAL_TRANSFER", reportingClassification: null, correctionRole: "REVERSAL" }, rp("100"));
    expect(out).toEqual({ bucket: "TRANSFER_OUT", amount: rp("100") });
    expect(reversal).toEqual({ bucket: "TRANSFER_OUT", amount: rp("-100") });
  });

  it("counts the wallet in the pool so cash left over is not living cost (PRD v0.19)", () => {
    // Opening: DANA Rp50.000 + wallet Rp20.000. Rp200.000 withdrawn to the wallet (unrecorded).
    // Closing: DANA Rp100.000 + wallet Rp30.000 → living = 70.000 + 350.000 − 130.000 = 290.000.
    const result = reconstruct({
      openingPersonal: rp("50000"),
      income: income("350000"),
      flows: [],
      settlementDays: 7,
      closingPhysical: rp("100000"),
      closingExternal: 0n,
      cash: { openingPersonal: rp("20000"), closingPhysical: rp("30000"), closingExternal: 0n },
    });
    expect(result).toMatchObject({
      cashTracked: true,
      cashClosingPersonal: rp("30000"),
      closingPersonal: rp("100000"),
      livingExpense: rp("290000"),
      availableRemainder: rp("100000"),
    });
  });

  it("leaves the DANA-only formula unchanged before Tunai is activated", () => {
    const result = reconstruct({ openingPersonal: 0n, income: income("350000"), flows: [], settlementDays: 7, closingPhysical: rp("110000"), closingExternal: 0n });
    expect(result).toMatchObject({ cashTracked: false, cashOpeningPersonal: 0n, cashClosingPersonal: 0n, livingExpense: rp("240000") });
  });

  it("rounds averages half away from zero to whole rupiah", () => {
    expect(roundedAverage(rp("930000"), 28)).toBe(rp("33214"));
    expect(roundedAverage(rp("190000"), 7)).toBe(rp("27143"));
    expect(roundedAverage(rp("3.50"), 1)).toBe(rp("4"));
    expect(roundedAverage(rp("-3.50"), 1)).toBe(rp("-4"));
  });
});
