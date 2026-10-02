// Chart draw-in (PRD v0.21 P9): a line draws from left to right and bars grow one
// after another, 700 ms in total; no animation under reduced motion.
import type { Chart } from "chart.js";

export const CHART_DRAW_MS = 700;
const BAR_GROW_MS = 400;

type DrawContext = { type: string; mode?: string; index: number; dataIndex: number; datasetIndex: number; chart: Chart; xStarted?: boolean; yStarted?: boolean };

export function chartMotion(kind: "line" | "bar", points: number, reduced: boolean) {
  if (reduced) return { animation: false as const };
  if (kind === "bar") {
    // The last bar starts growing early enough to finish at CHART_DRAW_MS.
    const gap = (CHART_DRAW_MS - BAR_GROW_MS) / Math.max(points - 1, 1);
    return {
      animation: {
        duration: BAR_GROW_MS,
        easing: "easeOutCubic" as const,
        delay: (ctx: DrawContext) => (ctx.type === "data" && ctx.mode === "default" ? ctx.dataIndex * gap : 0),
      },
    };
  }
  const step = CHART_DRAW_MS / Math.max(points, 1);
  // Each point appears in turn and rises from the previous one, so the line extends to the right.
  const once = (flag: "xStarted" | "yStarted") => (ctx: DrawContext) => {
    if (ctx.type !== "data" || ctx[flag]) return 0;
    ctx[flag] = true;
    return ctx.index * step;
  };
  const previousY = (ctx: DrawContext) =>
    ctx.index === 0 ? ctx.chart.scales.y.getPixelForValue(0) : ctx.chart.getDatasetMeta(ctx.datasetIndex).data[ctx.index - 1].getProps(["y"], true).y;
  return {
    animation: { duration: CHART_DRAW_MS },
    animations: {
      x: { type: "number" as const, easing: "linear" as const, duration: step, from: NaN, delay: once("xStarted") },
      y: { type: "number" as const, easing: "linear" as const, duration: step, from: previousY, delay: once("yStarted") },
    },
  };
}
