// Guards the Petrol & Paper tokens (PRD v0.20 P1): exact values, matching
// dark blocks, and the WCAG floors from PRD `Accessibility`.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function block(selector: RegExp): Record<string, string> {
  const match = css.match(selector);
  if (!match) throw new Error(`block not found: ${selector}`);
  return Object.fromEntries([...match[1].matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map(([, k, v]) => [k, v.toLowerCase()]));
}

const light = block(/:root,\s*\[data-theme="fintrack-light"\]\s*\{([^}]*)\}/);
const dark = block(/\[data-theme="fintrack-dark"\]\s*\{([^}]*)\}/);
const systemDark = block(/:root:not\(\[data-theme\]\)\s*\{([^}]*)\}/);

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("Petrol & Paper tokens", () => {
  it("uses the PRD values", () => {
    expect(light).toMatchObject({ canvas: "#f6f5f1", surface: "#ffffff", "surface-subtle": "#eeece6", border: "#e3e0d8", "control-boundary": "#7a8589", text: "#1a1f22", muted: "#5f6b70", primary: "#0e6170", "primary-hover": "#0b4f5b", "primary-pressed": "#083e48", "primary-content": "#ffffff", "primary-soft": "#e3f2f3", plum: "#7a5aa6", "mono-1": "#0e6170", "mono-2": "#7a5aa6", "mono-3": "#7d5f27", "mono-4": "#4d6b57" });
    expect(dark).toMatchObject({ canvas: "#0d1316", surface: "#141b1f", "surface-subtle": "#1b2428", border: "#2a353b", "control-boundary": "#6b7c84", text: "#f2f4f3", muted: "#9aa8ad", primary: "#4fc3cf", "primary-hover": "#7dd6de", "primary-pressed": "#a8e5ea", "primary-content": "#0d1316", "primary-soft": "#0f2e33", plum: "#b9a3e0", "mono-1": "#4fc3cf", "mono-2": "#b9a3e0", "mono-3": "#e0b872", "mono-4": "#9cc9a9" });
  });

  it("keeps the system-dark block identical to the explicit dark theme", () => {
    expect(systemDark).toEqual(dark);
  });

  for (const [name, t] of [["light", light], ["dark", dark]] as const) {
    it(`meets the contrast floors in ${name}`, () => {
      for (const bg of [t.canvas, t.surface, t["surface-subtle"]]) {
        expect(contrast(t.text, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.muted, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t["control-boundary"], bg)).toBeGreaterThanOrEqual(3);
        expect(contrast(t.primary, bg)).toBeGreaterThanOrEqual(4.5);
        for (const mono of [t["mono-1"], t["mono-2"], t["mono-3"], t["mono-4"]]) expect(contrast(mono, bg)).toBeGreaterThanOrEqual(4.5);
      }
      for (const fill of [t.primary, t["primary-hover"], t["primary-pressed"]]) expect(contrast(t["primary-content"], fill)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.primary, t["primary-soft"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.text, t["primary-soft"])).toBeGreaterThanOrEqual(4.5);
    });
  }
});
