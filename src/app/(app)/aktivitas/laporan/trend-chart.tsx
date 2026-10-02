"use client";

// Trend chart wrapper (PRD v0.20 P4). Below md nothing renders and Chart.js is
// never imported; at md and wider, chart-canvas loads on demand without SSR.
import dynamic from "next/dynamic";
import { useMemo } from "react";
import { Skeleton } from "@/components/skeletons";
import { useMediaQuery } from "@/components/use-media-query";

export type TrendChartProps = {
  kind: "line" | "bar";
  labels: string[];
  series: { label: string; values: string[]; style: "solid" | "outline" }[];
  summary: string;
  unit: string;
};

const ChartCanvas = dynamic(() => import("./chart-canvas"), { ssr: false, loading: () => <Skeleton className="h-64" /> });

export function TrendChart(props: TrendChartProps) {
  const isWide = useMediaQuery("(min-width: 48rem)");
  // A refresh sends equal data as a new object; keeping one object per content keeps the drawn chart.
  const serialized = JSON.stringify(props);
  const trend = useMemo(() => JSON.parse(serialized) as TrendChartProps, [serialized]);
  if (!isWide) return null;
  return (
    <div className="space-y-2">
      <ChartCanvas trend={trend} />
      {props.series.length > 1 ? (
        <ul aria-hidden="true" className="flex flex-wrap gap-4 text-xs text-muted">
          {props.series.map((s, i) => (
            <li key={s.label} className="flex items-center gap-1.5">
              <span className={`size-3 ${s.style === "solid" ? (i === 0 ? "bg-primary" : "bg-plum") : `border-2 ${i === 0 ? "border-primary" : "border-plum"}`}`} />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
