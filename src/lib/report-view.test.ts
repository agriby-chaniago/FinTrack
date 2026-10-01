import { describe, expect, it } from "vitest";

import { categoryShares, monthlySummary, signedDelta, weeklySummary } from "./report-view";

describe("signedDelta", () => {
  it("subtracts exactly in minor units", () => expect(signedDelta("1000000.50", "999999.75")).toBe("0.75"));
  it("goes negative", () => expect(signedDelta("100", "250")).toBe("-150"));
  it("treats a missing previous month as zero", () => expect(signedDelta("400000", null)).toBe("400000"));
});

describe("categoryShares", () => {
  it("orders by amount and floors each share", () => {
    expect(categoryShares([{ name: "Vape", amount: "100000" }, { name: "Buku", amount: "200000" }])).toEqual([
      { name: "Buku", amount: "200000", percent: 66 },
      { name: "Vape", amount: "100000", percent: 33 },
    ]);
  });
  it("gives zero shares when the total is zero", () => {
    expect(categoryShares([{ name: "Vape", amount: "0" }])).toEqual([{ name: "Vape", amount: "0", percent: 0 }]);
  });
});

describe("weeklySummary", () => {
  it("names the latest average and the change from the settlement before", () => {
    expect(
      weeklySummary([
        { endDate: "2026-09-20", averagePerDay: "61000" },
        { endDate: "2026-09-27", averagePerDay: "58000" },
      ]),
    ).toBe("Rata-rata biaya hidup terakhir Rp58.000 per hari (settlement sampai 27 Sep 2026), turun Rp3.000 dari settlement sebelumnya.");
  });
  it("handles a single point", () => {
    expect(weeklySummary([{ endDate: "2026-09-27", averagePerDay: "58000" }])).toBe("Rata-rata biaya hidup terakhir Rp58.000 per hari (settlement sampai 27 Sep 2026).");
  });
});

describe("monthlySummary", () => {
  it("names the latest month's reserve growth and outflow", () => {
    expect(
      monthlySummary([
        { month: "2026-08", reserveGrowth: "500000", outflow: "2000000" },
        { month: "2026-09", reserveGrowth: "-100000", outflow: "2300000" },
      ]),
    ).toBe("September 2026: reserve -Rp100.000, pengeluaran Rp2.300.000.");
  });
});
