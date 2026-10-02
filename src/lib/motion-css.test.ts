// Guards the expressive-calm motion rules (PRD v0.21 P9) in globals.css.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");
const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));

describe("motion css", () => {
  it("defines every P9 keyframe", () => {
    for (const name of ["rise", "fill", "pop", "draw", "drain"]) expect(css).toContain(`@keyframes ${name} {`);
  });

  it("staggers sections 50 ms apart and never waits longer than 300 ms", () => {
    const delays = [...css.matchAll(/\.stagger > [^{]+\{\s*animation-delay: (\d+)ms;/g)].map((m) => Number(m[1]));
    expect(delays).toEqual([50, 100, 150, 200, 250, 300]);
  });

  it("removes every delay and the toast countdown under reduced motion", () => {
    expect(reduced).toContain("animation-delay: 0s !important;");
    expect(reduced).toContain("transition-delay: 0s !important;");
    expect(reduced).toMatch(/\.toast-timer \{\s*display: none;/);
  });
});
