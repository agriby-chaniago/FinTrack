import { describe, expect, it } from "vitest";

import { chartMotion } from "./chart-motion";

type Delay = (ctx: Record<string, unknown>) => number;

describe("chartMotion", () => {
  it("turns animation off under reduced motion", () => {
    expect(chartMotion("line", 4, true)).toEqual({ animation: false });
    expect(chartMotion("bar", 6, true)).toEqual({ animation: false });
  });

  it("draws a line from the left within 700 ms", () => {
    const motion = chartMotion("line", 4, false) as unknown as { animations: { x: { duration: number; delay: Delay } } };
    expect(motion.animations.x.duration).toBe(175);
    const ctx = { type: "data", index: 3 };
    expect(motion.animations.x.delay(ctx)).toBe(525);
    expect(motion.animations.x.delay(ctx)).toBe(0);
    expect(motion.animations.x.delay({ type: "dataset", index: 0 })).toBe(0);
  });

  it("grows bars one after another within 700 ms", () => {
    const motion = chartMotion("bar", 6, false) as unknown as { animation: { duration: number; delay: Delay } };
    expect(motion.animation.duration).toBe(400);
    expect(motion.animation.delay({ type: "data", mode: "default", dataIndex: 5 })).toBe(300);
    expect(motion.animation.delay({ type: "data", mode: "resize", dataIndex: 5 })).toBe(0);
  });
});
