import { describe, expect, it } from "vitest";

import { addDays, businessDateOf, cycleKeyOf, isBusinessDate, nextCycleKey } from "./business-time";

describe("businessDateOf", () => {
  it("uses Asia/Jakarta regardless of the server time zone", () => {
    // 2027-02-28T17:30:00Z is 2027-03-01 00:30 in Jakarta.
    expect(businessDateOf(new Date("2027-02-28T17:30:00Z"))).toBe("2027-03-01");
    expect(businessDateOf(new Date("2027-02-28T16:59:59Z"))).toBe("2027-02-28");
  });
});

describe("calendar arithmetic", () => {
  it("adds days across month and leap-year boundaries", () => {
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
  });

  it("validates real calendar dates only", () => {
    expect(isBusinessDate("2028-02-29")).toBe(true);
    expect(isBusinessDate("2027-02-29")).toBe(false);
    expect(isBusinessDate("2027-13-01")).toBe(false);
    expect(isBusinessDate("27-01-01")).toBe(false);
  });

  it("derives cycle keys", () => {
    expect(cycleKeyOf("2027-02-15")).toBe("2027-02");
    expect(nextCycleKey("2027-02")).toBe("2027-03");
    expect(nextCycleKey("2026-12")).toBe("2027-01");
  });
});
