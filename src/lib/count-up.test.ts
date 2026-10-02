import { describe, expect, it } from "vitest";

import { countUpText } from "./count-up";

describe("countUpText", () => {
  it("starts at Rp0", () => {
    expect(countUpText(1_245_000_000n, 0)).toBe("Rp0");
  });

  it("eases out and shows whole thousands while counting", () => {
    // ease-out cubic at 0.5 is 0.875 → 10.893.750 rupiah, shown as 10.893.000.
    expect(countUpText(1_245_000_000n, 0.5)).toBe("Rp10.893.000");
  });

  it("reaches the whole-thousand amount at the end and clamps beyond it", () => {
    expect(countUpText(83_199_993n, 1)).toBe("Rp831.000");
    expect(countUpText(1_245_000_000n, 1.4)).toBe("Rp12.450.000");
  });

  it("counts toward a negative amount with the leading minus sign", () => {
    expect(countUpText(-5_000_000n, 0)).toBe("Rp0");
    expect(countUpText(-5_000_000n, 1)).toBe("−Rp50.000");
  });

  it("is self-contained, so it can run from an inline script", () => {
    const rebuilt = new Function(`return (${countUpText})`)() as typeof countUpText;
    expect(rebuilt(1_245_000_000n, 0.5)).toBe("Rp10.893.000");
  });
});
