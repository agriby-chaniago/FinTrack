"use client";

// The only module that imports Chart.js, and only the parts these charts use (PRD: Chart).
import { BarController, BarElement, CategoryScale, Chart, LinearScale, LineController, LineElement, PointElement, Tooltip, type ChartConfiguration } from "chart.js";
import { useEffect, useRef } from "react";

import { money } from "@/lib/format";

import type { TrendChartProps } from "./trend-chart";

Chart.register(LineController, LineElement, PointElement, BarController, BarElement, CategoryScale, LinearScale, Tooltip);

const compact = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", notation: "compact", maximumFractionDigits: 1 });
const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function config({ kind, labels, series, unit }: TrendChartProps): ChartConfiguration {
  // Geist is the only typeface (PRD: Typography), on the canvas too.
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  const colors = [token("--primary"), token("--plum")];
  const muted = token("--muted");
  const line = token("--line");
  return {
    type: kind,
    data: {
      labels,
      datasets: series.map((s, i) => ({
        label: s.label,
        // Numbers are plot coordinates only; every amount a person reads comes from the decimal strings.
        data: s.values.map(Number),
        borderColor: colors[i],
        backgroundColor: s.style === "solid" ? colors[i] : "transparent",
        borderWidth: 2,
        ...(kind === "line" ? { pointStyle: "rect", pointRadius: 4, pointBackgroundColor: colors[i], tension: 0 } : {}),
      })),
    },
    options: {
      animation: matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 200 },
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false }, ticks: { color: muted }, border: { color: line } },
        y: {
          beginAtZero: true,
          grid: { color: line },
          border: { color: line },
          ticks: { color: muted, callback: (value) => compact.format(Number(value)) },
          title: { display: true, text: unit, color: muted },
        },
      },
      plugins: { tooltip: { callbacks: { label: (item) => `${item.dataset.label}: ${money(series[item.datasetIndex].values[item.dataIndex])}` } } },
    },
  } as ChartConfiguration;
}

export default function ChartCanvas(props: TrendChartProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const chart = new Chart(canvas.current!, config(props));
    // A theme switch recolors the chart.
    const recolor = () => {
      const next = config(props);
      chart.data = next.data;
      chart.options = next.options ?? {};
      chart.update();
    };
    const observer = new MutationObserver(recolor);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", recolor);
    return () => {
      observer.disconnect();
      scheme.removeEventListener("change", recolor);
      chart.destroy();
    };
  }, [props]);
  return (
    <div className="relative h-64">
      <canvas ref={canvas} role="img" aria-label={props.summary} />
    </div>
  );
}
