// Guards the motion rules (PRD v0.21 P9, intensity Meriah from v0.22 P10) in globals.css.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");
const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));

describe("motion css", () => {
  it("uses the Meriah tokens", () => {
    expect(css).toContain("--rise-distance: 40px;");
    expect(css).toContain("--rise-duration: 520ms;");
    expect(css).toContain("--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);");
  });

  it("defines every P9 and P10 keyframe", () => {
    for (const name of ["rise", "rise-small", "fill", "pop", "draw", "drain", "shine-pass", "shimmer", "sweep-line", "ping", "hop", "rise-sheet", "pop-icon", "flash-success", "strike", "ripple", "tab-leave", "tab-enter"]) {
      expect(css).toContain(`@keyframes ${name} {`);
    }
  });

  it("staggers sections 90 ms apart and never waits longer than 450 ms", () => {
    const delays = [...css.matchAll(/\.stagger > :nth-child\([^)]+\) \{\s*--stagger-delay: (\d+)ms;/g)].map((m) => Number(m[1]));
    expect(delays).toEqual([90, 180, 270, 360, 450]);
  });

  it("cascades list items in at most eight steps", () => {
    const steps = [...css.matchAll(/\.cascade > :nth-child\([^)]+\) \{\s*--cascade-step: (\d+);/g)].map((m) => Number(m[1]));
    expect(steps).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("stops every animation, loop, and view transition under reduced motion", () => {
    expect(reduced).toContain("animation-delay: 0s !important;");
    expect(reduced).toContain("transition-delay: 0s !important;");
    expect(reduced).toContain("animation-iteration-count: 1 !important;");
    expect(reduced).toMatch(/::view-transition-group\(\*\) \{\s*animation-duration: 0s !important;/);
    expect(reduced).toMatch(/\.toast-timer,\s*\.ripple-wave \{\s*display: none;/);
  });
});
