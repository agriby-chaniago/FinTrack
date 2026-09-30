import { describe, expect, it } from "vitest";

import { parseIdrDecimal as rp } from "@/lib/money";

import { bcaTargetAmount, cycleState, cyclesBetween, expectedDateFor, incomeLabel, obligationLabel } from "./monthly";

describe("expected dates", () => {
  it("falls back to the last day of shorter months and returns to the configured day", () => {
    expect(expectedDateFor("2027-02", 31)).toBe("2027-02-28");
    expect(expectedDateFor("2028-02", 29)).toBe("2028-02-29");
    expect(expectedDateFor("2027-03", 31)).toBe("2027-03-31");
    expect(expectedDateFor("2027-04", 31)).toBe("2027-04-30");
    expect(expectedDateFor("2027-02", null)).toBeNull();
  });

  it("lists cycles across a year boundary", () => {
    expect(cyclesBetween("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });
});

describe("cycle state precedence", () => {
  const ready = { priorBlocked: false, income: "CONFIRMED" as const, obligations: ["CONFIRMED", "NOT_CHARGED"] as const };
  const target = (amount: string) => ({ amount: rp(amount), isActionable: true, retirementReason: null });

  it.each([
    [{ ...ready, priorBlocked: true, target: null, linked: 0n }, "WAITING_FOR_PRIOR_CYCLE"],
    [{ ...ready, income: "PENDING" as const, obligations: ["PENDING"] as const, target: null, linked: 0n }, "WAITING_FOR_INCOME"],
    [{ ...ready, obligations: ["PENDING"] as const, target: null, linked: 0n }, "WAITING_FOR_OBLIGATIONS"],
    [{ ...ready, income: "NOT_RECEIVED" as const, target: null, linked: 0n }, "CLOSED_NO_INCOME"],
    [{ ...ready, target: target("0"), linked: 0n }, "COMPLETE"],
    [{ ...ready, target: target("335000"), linked: 0n }, "READY_TO_TRANSFER"],
    [{ ...ready, target: target("335000"), linked: rp("100000") }, "PARTIALLY_TRANSFERRED"],
    [{ ...ready, target: target("335000"), linked: rp("335000") }, "COMPLETE"],
  ])("row %#", (input, state) => {
    expect(cycleState(input).state).toBe(state);
  });

  it("marks exceeded, zero, obligation-only, and closed cycles", () => {
    expect(cycleState({ ...ready, target: target("100"), linked: rp("200") }).note).toBe("EXCEEDS_SUGGESTION");
    expect(cycleState({ ...ready, target: target("0"), linked: 0n }).note).toBe("NO_TRANSFER_NEEDED");
    expect(cycleState({ ...ready, income: null, target: null, linked: 0n })).toMatchObject({ state: "COMPLETE", note: "NO_AUTOMATIC_SUGGESTION" });
    expect(
      cycleState({ ...ready, target: { amount: rp("100"), isActionable: false, retirementReason: "LIQUIDITY_WRITE_OFF" }, linked: 0n }),
    ).toMatchObject({ state: "COMPLETE", note: "TARGET_CLOSED" });
  });
});

describe("BCA target", () => {
  it("reproduces the locked BCA fixture: Rp735.000 basis − Rp400.000 floor = Rp335.000", () => {
    expect(bcaTargetAmount({ personalBalance: rp("735000"), earlyFulfillment: 0n, floor: rp("400000"), priorOutstanding: 0n })).toBe(rp("335000"));
  });

  it("adds early fulfillment back and never goes below zero", () => {
    expect(bcaTargetAmount({ personalBalance: rp("635000"), earlyFulfillment: rp("100000"), floor: rp("400000"), priorOutstanding: 0n })).toBe(rp("335000"));
    expect(bcaTargetAmount({ personalBalance: rp("300000"), earlyFulfillment: 0n, floor: rp("400000"), priorOutstanding: 0n })).toBe(0n);
  });
});

describe("derived labels", () => {
  it("labels income against the day 1–7 window", () => {
    expect(incomeLabel("2027-02", "PENDING", null, "2027-02-07")).toBeNull();
    expect(incomeLabel("2027-02", "PENDING", null, "2027-02-08")).toBe("OVERDUE");
    expect(incomeLabel("2027-02", "CONFIRMED", "2027-02-10", "2027-02-10")).toBe("LATE");
  });

  it("labels obligations by expected date or month end", () => {
    expect(obligationLabel("2027-02", "PENDING", "2027-02-05", "2027-02-03")).toBe("DUE_SOON");
    expect(obligationLabel("2027-02", "PENDING", "2027-02-05", "2027-02-06")).toBe("OVERDUE");
    expect(obligationLabel("2027-02", "PENDING", null, "2027-02-25")).toBe("NEEDS_REVIEW");
    expect(obligationLabel("2027-02", "PENDING", null, "2027-02-10")).toBeNull();
  });
});
