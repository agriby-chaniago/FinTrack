import { describe, expect, it } from "vitest";

import { formatIdr, formatIdrNumber, parseIdrDecimal, parseIdrInput, toIdrDecimal } from "./money";

describe("parseIdrDecimal", () => {
  it.each([
    ["831999.93", 83_199_993n],
    ["831999.9", 83_199_990n],
    ["400000", 40_000_000n],
    ["0", 0n],
    ["-50000", -5_000_000n],
  ])("parses %s", (input, expected) => {
    expect(parseIdrDecimal(input)).toBe(expected);
  });

  it("rejects more than two fractional digits instead of rounding", () => {
    expect(() => parseIdrDecimal("831999.931")).toThrow("TOO_MANY_DECIMALS");
  });

  it.each(["", "abc", "1,000", "1.2.3", "Rp100", "+5", "1e5"])("rejects %j", (input) => {
    expect(() => parseIdrDecimal(input)).toThrow("INVALID_FORMAT");
  });

  it("rejects values beyond the database range", () => {
    expect(() => parseIdrDecimal("92233720368547758.08")).toThrow("OUT_OF_RANGE");
  });
});

describe("parseIdrInput", () => {
  it.each([
    ["Rp831.999,93", 83_199_993n],
    ["831.999,93", 83_199_993n],
    ["831999,93", 83_199_993n],
    ["400.000", 40_000_000n],
    ["400000", 40_000_000n],
    [" Rp 1.234.567 ", 123_456_700n],
    ["−50.000", -5_000_000n],
    ["-Rp50.000", -5_000_000n],
    ["0,5", 50n],
  ])("parses %j", (input, expected) => {
    expect(parseIdrInput(input)).toBe(expected);
  });

  it.each(["831.99", "1.2345", "12.34.567", "1,2,3", "abc", ""])("rejects malformed grouping %j", (input) => {
    expect(() => parseIdrInput(input)).toThrow("INVALID_FORMAT");
  });

  it("rejects three fractional digits", () => {
    expect(() => parseIdrInput("1.000,123")).toThrow("TOO_MANY_DECIMALS");
  });
});

describe("formatting", () => {
  it.each([
    [40_000_000n, "Rp400.000", "400000"],
    [83_199_993n, "Rp831.999,93", "831999.93"],
    [83_199_990n, "Rp831.999,90", "831999.90"],
    [-5_000_000n, "−Rp50.000", "-50000"],
    [0n, "Rp0", "0"],
    [5n, "Rp0,05", "0.05"],
  ])("formats %s", (minor, display, canonical) => {
    expect(formatIdr(minor)).toBe(display);
    expect(toIdrDecimal(minor)).toBe(canonical);
    expect(parseIdrDecimal(toIdrDecimal(minor))).toBe(minor);
  });

  it("formats input values without the currency prefix", () => {
    expect(formatIdrNumber(83_199_993n)).toBe("831.999,93");
    expect(parseIdrInput(formatIdrNumber(-123_456_700n))).toBe(-123_456_700n);
  });
});
