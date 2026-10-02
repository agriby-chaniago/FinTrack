import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COUNT_UP_MS, countUpText, runCountUp } from "./count-up";

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

/** A stand-in for the headline element: hidden until `show()`. */
function fakeHeadline(minor: string, text: string) {
  const attributes = new Map<string, string>([["data-count-up", minor]]);
  let visible = false;
  return {
    textContent: text as string | null,
    isConnected: true,
    hasAttribute: (name: string) => attributes.has(name),
    setAttribute: (name: string, value: string) => void attributes.set(name, value),
    getAttribute: (name: string) => attributes.get(name) ?? null,
    getClientRects: () => (visible ? [{}] : []),
    show: () => {
      visible = true;
    },
  };
}

describe("runCountUp while the headline is still hidden", () => {
  const frames: FrameRequestCallback[] = [];
  let notify: (() => void) | null = null;
  let disconnected = false;

  beforeEach(() => {
    frames.length = 0;
    notify = null;
    disconnected = false;
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          notify = callback;
        }
        observe() {}
        disconnect() {
          disconnected = true;
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("waits for the headline to appear instead of checking every frame", () => {
    const headline = fakeHeadline("1245000000", "Rp12.450.000");
    runCountUp(headline as unknown as HTMLElement, countUpText, COUNT_UP_MS);
    expect(headline.textContent).toBe("Rp0");
    expect(frames).toHaveLength(0);

    headline.show();
    notify!();
    expect(disconnected).toBe(true);
    let now = 0;
    while (frames.length > 0) {
      now += 100;
      frames.shift()!(now);
    }
    expect(headline.textContent).toBe("Rp12.450.000");
  });

  it("lands on the exact amount if the headline stays hidden", () => {
    vi.useFakeTimers();
    const headline = fakeHeadline("1245000000", "Rp12.450.000");
    runCountUp(headline as unknown as HTMLElement, countUpText, COUNT_UP_MS);
    vi.advanceTimersByTime(10_000);
    expect(headline.textContent).toBe("Rp12.450.000");
    expect(disconnected).toBe(true);
    expect(frames).toHaveLength(0);
  });
});
