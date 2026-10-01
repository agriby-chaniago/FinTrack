import { describe, expect, it } from "vitest";

import { chartEligibility, obligationProgress, progressPercent, stripSummary, taskKey, weekStrip } from "./dashboard-view";

const day = (date: string, extra: Partial<{ state: string; amount: bigint; overridden: boolean }> = {}) => ({ date, state: "ACTIVE", amount: 5_000_000n, overridden: false, ...extra });

describe("weekStrip", () => {
  it("classifies each day of the open week and marks future days upcoming", () => {
    const strip = weekStrip({
      periodStart: "2026-09-28",
      normalEnd: "2026-10-04",
      today: "2026-10-02",
      days: [day("2026-09-28"), day("2026-09-29", { overridden: true, amount: 3_000_000n }), day("2026-09-30", { overridden: true, amount: 0n }), day("2026-10-01", { state: "PAUSED", amount: 0n }), day("2026-10-02")],
    });
    expect(strip.map((d) => d.marker)).toEqual(["RECEIVED", "ADJUSTED", "MISSED", "INACTIVE", "RECEIVED", "UPCOMING", "UPCOMING"]);
    expect(strip.map((d) => d.weekday)).toEqual(["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"]);
  });

  it("covers only the days of a short first period", () => {
    const strip = weekStrip({ periodStart: "2026-10-01", normalEnd: "2026-10-04", today: "2026-10-01", days: [day("2026-10-01")] });
    expect(strip).toHaveLength(4);
    expect(strip[0]).toEqual({ date: "2026-10-01", weekday: "Kam", marker: "RECEIVED" });
  });

  it("has no upcoming days for an overdue period", () => {
    const strip = weekStrip({ periodStart: "2026-09-14", normalEnd: "2026-09-20", today: "2026-10-01", days: ["14", "15", "16", "17", "18", "19", "20"].map((d) => day(`2026-09-${d}`)) });
    expect(strip.every((d) => d.marker === "RECEIVED")).toBe(true);
  });

  it("treats a past day without income data as inactive", () => {
    const strip = weekStrip({ periodStart: "2026-09-28", normalEnd: "2026-09-29", today: "2026-09-29", days: [day("2026-09-29")] });
    expect(strip.map((d) => d.marker)).toEqual(["INACTIVE", "RECEIVED"]);
  });
});

describe("stripSummary", () => {
  it("lists non-zero counts in a fixed order", () => {
    expect(
      stripSummary([
        { date: "a", weekday: "Sen", marker: "RECEIVED" },
        { date: "b", weekday: "Sel", marker: "RECEIVED" },
        { date: "c", weekday: "Rab", marker: "ADJUSTED" },
        { date: "d", weekday: "Kam", marker: "UPCOMING" },
      ]),
    ).toBe("2 hari diterima · 1 nominal disesuaikan · 1 hari belum terjadi");
  });
});

describe("progressPercent", () => {
  it("floors to whole percent", () => expect(progressPercent("600000", "1000000.01")).toBe(59));
  it("clamps above 100", () => expect(progressPercent("1500000", "1000000")).toBe(100));
  it("returns 0 for a zero or negative whole", () => {
    expect(progressPercent("10", "0")).toBe(0);
    expect(progressPercent("10", "-5")).toBe(0);
  });
  it("returns 0 for a negative part", () => expect(progressPercent("-1", "10")).toBe(0));
});

describe("obligationProgress", () => {
  it("counts CONFIRMED and NOT_CHARGED as resolved", () => {
    expect(obligationProgress([{ status: "CONFIRMED" }, { status: "NOT_CHARGED" }, { status: "PENDING" }])).toEqual({ resolved: 2, total: 3 });
  });
  it("handles a month without obligations", () => expect(obligationProgress([])).toEqual({ resolved: 0, total: 0 }));
});

describe("chartEligibility", () => {
  it("applies the PRD thresholds of four settlements and three cycles", () => {
    expect(chartEligibility({ settlements: 3, cycles: 3 })).toEqual({
      weekly: { count: 3, needed: 4, eligible: false },
      monthly: { count: 3, needed: 3, eligible: true },
    });
  });
});

describe("taskKey", () => {
  it("names each task by what it is about, so keys survive list changes", () => {
    expect(taskKey({ type: "SETTLEMENT" })).toBe("settlement");
    expect(taskKey({ type: "CONFIRM_INCOME", occurrenceId: "o1" })).toBe("occurrence:o1");
    expect(taskKey({ type: "CONFIRM_OBLIGATION", occurrenceId: "o2" })).toBe("occurrence:o2");
    expect(taskKey({ type: "TRANSFER", targetId: "t1" })).toBe("target:t1");
    expect(taskKey({ type: "RECONCILE", accountId: "a1" })).toBe("reconcile:a1");
  });
});
