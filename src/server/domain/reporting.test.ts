import { describe, expect, it } from "vitest";

import { parseIdrDecimal as rp } from "@/lib/money";

import { monthCompleteness, prorataByMonth } from "./reporting";

describe("CALENDAR_DAY_PRORATA_V1", () => {
  it("splits the PRD example exactly: Rp171.428,57 to October and Rp68.571,43 to November", () => {
    const shares = prorataByMonth(rp("240000"), "2026-10-27", "2026-11-02");
    expect(shares).toEqual(new Map([["2026-10", rp("171428.57")], ["2026-11", rp("68571.43")]]));
  });

  it("keeps an indivisible Rp100 exact and deterministic", () => {
    const shares = prorataByMonth(rp("100"), "2026-10-27", "2026-11-02");
    expect([...shares.values()].reduce((a, b) => a + b, 0n)).toBe(rp("100"));
    expect(shares).toEqual(new Map([["2026-10", rp("71.43")], ["2026-11", rp("28.57")]]));
  });

  it("spans three months for a catch-up settlement and restores the sign for negative living cost", () => {
    const shares = prorataByMonth(rp("-100000"), "2026-10-30", "2026-12-02");
    expect([...shares.keys()]).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect([...shares.values()].reduce((a, b) => a + b, 0n)).toBe(rp("-100000"));
    expect(shares.get("2026-11")! < 0n).toBe(true);
  });

  it("breaks equal remainders toward the earlier month", () => {
    const shares = prorataByMonth(1n, "2026-10-31", "2026-11-01");
    expect(shares).toEqual(new Map([["2026-10", 1n], ["2026-11", 0n]]));
  });
});

describe("month completeness", () => {
  it("is provisional until every day is settled, then complete", () => {
    const weeks = [{ startDate: "2027-02-01", endDate: "2027-02-21" }];
    expect(monthCompleteness("2027-02", "2027-02-01", weeks, "2027-03-05")).toMatchObject({ completeness: "SEMENTARA", coveredDays: 21, expectedDays: 28 });
    const all = [...weeks, { startDate: "2027-02-22", endDate: "2027-02-28" }];
    expect(monthCompleteness("2027-02", "2027-02-01", all, "2027-03-05").completeness).toBe("LENGKAP");
  });

  it("marks the onboarding month partial once its covered days are settled", () => {
    expect(monthCompleteness("2027-02", "2027-02-10", [{ startDate: "2027-02-10", endDate: "2027-02-28" }], "2027-03-01").completeness).toBe("PERIODE_PARSIAL");
  });

  it("reports gaps instead of treating missing coverage as Rp0", () => {
    const result = monthCompleteness("2027-02", "2027-02-01", [{ startDate: "2027-02-01", endDate: "2027-02-07" }, { startDate: "2027-02-10", endDate: "2027-02-14" }], "2027-03-01");
    expect(result.gaps).toEqual(["2027-02-08", "2027-02-09"]);
    expect(result.completeness).toBe("SEMENTARA");
  });
});
