// Skeletons shimmer instead of pulsing (PRD v0.22 P10).
import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

it("skeleton blocks shimmer instead of pulsing", () => {
  const source = readFileSync(new URL("./skeletons.tsx", import.meta.url), "utf8");
  expect(source).toContain("shimmer");
  expect(source).not.toContain("animate-pulse");
});
