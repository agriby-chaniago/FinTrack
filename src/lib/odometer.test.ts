import { describe, expect, it } from "vitest";

import { odometerCells } from "./odometer";

const digits = (from: string, to: string) =>
  odometerCells(from, to).map((cell) => (cell.digit ? `${cell.from}>${cell.to}@${cell.place}` : cell.text)).join(" ");

describe("odometerCells", () => {
  it("rolls each digit from the digit in the same place", () => {
    expect(digits("Rp9.800.000", "Rp9.715.000")).toBe("R p 9>9@6 . 8>7@5 0>1@4 0>5@3 . 0>0@2 0>0@1 0>0@0");
  });

  it("rolls a new leading digit up from 0", () => {
    expect(digits("Rp950.000", "Rp1.050.000")).toBe("R p 0>1@6 . 9>0@5 5>5@4 0>0@3 . 0>0@2 0>0@1 0>0@0");
  });

  it("counts fraction digits as places", () => {
    expect(digits("Rp831.999,93", "Rp831.999,95")).toBe("R p 8>8@7 3>3@6 1>1@5 . 9>9@4 9>9@3 9>9@2 , 9>9@1 3>5@0");
  });

  it("keeps the minus sign as text", () => {
    expect(digits("Rp20.000", "−Rp50.000")).toBe("− R p 2>5@4 0>0@3 . 0>0@2 0>0@1 0>0@0");
  });
});
