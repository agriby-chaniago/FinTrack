// Guards the square geometry (PRD v0.20 P7): UI code carries no rounded
// utilities or inline radii, and daisyUI radii are zero in both themes.
// The daisyUI radio keeps its built-in round shape, the one allowed exception.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const src = fileURLToPath(new URL("..", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(tsx|css)$/.test(entry.name) ? [path] : [];
  });
}

describe("square geometry", () => {
  it("uses no rounded utilities or inline radii in UI code", () => {
    const offenders = sources(src).flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(/(?<![\w-])rounded(?:-[\w.[\]/%-]+)?(?![\w-])|borderRadius|border-radius/g)].map((m) => `${path.slice(src.length)}: ${m[0]}`),
    );
    expect(offenders).toEqual([]);
  });

  it("sets every daisyUI radius to zero in both themes", () => {
    const css = readFileSync(join(src, "app/globals.css"), "utf8");
    const radii = [...css.matchAll(/--radius-(selector|field|box):\s*([^;]+);/g)].map((m) => `${m[1]}=${m[2].trim()}`);
    expect(radii).toEqual(["selector=0", "field=0", "box=0", "selector=0", "field=0", "box=0"]);
  });
});
