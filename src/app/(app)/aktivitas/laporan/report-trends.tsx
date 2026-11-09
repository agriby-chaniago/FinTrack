"use client";

import { useState } from "react";

import { SelectField } from "@/components/form";
import { Money } from "@/components/ui";
import { formatCycle, formatDate, money } from "@/lib/format";
import { completenessLabel } from "@/lib/labels";
import { parseIdrDecimal, toIdrDecimal } from "@/lib/money";
import type { reportPage } from "@/server/application/reports";

import { TrendChart } from "./trend-chart";

type Report = Awaited<ReturnType<typeof reportPage>>;

/** Controls change the displayed window; all values come from one report load. */
export function WeeklyTrend({ points }: { points: Report["weekly"]["points"] }) {
  const [window, setWindow] = useState("8");
  const [metric, setMetric] = useState("average");
  const visible = points.slice(-Number(window));
  const daily = metric === "average";
  const value = (point: typeof points[number]) => daily ? point.averagePerDay : point.livingExpense;
  const unit = daily ? "Rupiah per hari" : "Rupiah per settlement";
  const label = daily ? "Rata-rata biaya hidup per hari" : "Total biaya hidup";
  const last = visible.at(-1);
  const summary = last ? `${label} terakhir ${money(value(last))}${daily ? " per hari" : ""}, settlement sampai ${formatDate(last.endDate)}. ${visible.length} settlement ditampilkan.` : "Belum ada settlement.";
  const sorted = [...visible].sort((a, b) => parseIdrDecimal(value(a)) < parseIdrDecimal(value(b)) ? -1 : parseIdrDecimal(value(a)) > parseIdrDecimal(value(b)) ? 1 : 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Ukuran biaya hidup" value={metric} onChange={setMetric} options={[{ value: "average", label: "Rata-rata per hari" }, { value: "total", label: "Total per settlement" }]} />
        <SelectField label="Rentang settlement" value={window} onChange={setWindow} options={[{ value: "4", label: "4 settlement terakhir" }, { value: "8", label: "8 settlement terakhir" }, { value: "12", label: "12 settlement terakhir" }]} />
      </div>
      <p className="text-sm text-muted">{summary}</p>
      <TrendChart kind="line" labels={visible.map((point) => formatDate(point.endDate))} series={[{ label, values: visible.map(value), style: "solid" }]} summary={summary} unit={unit} />
      {sorted.length > 0 ? (
        <dl className="grid grid-cols-2 gap-3 border-y border-border py-3 text-sm">
          <div><dt className="text-muted">Terendah dalam rentang</dt><dd className="font-medium"><Money value={value(sorted[0])} />{daily ? " / hari" : ""}</dd></div>
          <div><dt className="text-muted">Tertinggi dalam rentang</dt><dd className="font-medium"><Money value={value(sorted[sorted.length - 1])} />{daily ? " / hari" : ""}</dd></div>
        </dl>
      ) : null}
      <ul aria-label="Data tren mingguan" className="divide-y divide-border text-sm">
        {visible.map((point) => (
          <li key={point.settlementId} className="flex flex-wrap justify-between gap-x-3 gap-y-1 py-2">
            <span className="text-muted">{formatDate(point.startDate)} – {formatDate(point.endDate)}</span>
            <span className="tabular"><Money value={point.averagePerDay} /> / hari · total <Money value={point.livingExpense} /></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MonthlyTrend({ points }: { points: Report["monthly"]["points"] }) {
  const [window, setWindow] = useState("6");
  const [metric, setMetric] = useState("cashflow");
  const visible = points.slice(-Number(window));
  const cashflow = metric === "cashflow";
  const incoming = visible.reduce((sum, p) => sum + parseIdrDecimal(p.income), 0n);
  const outgoing = visible.reduce((sum, p) => sum + parseIdrDecimal(p.outflow), 0n);
  const growth = visible.reduce((sum, p) => sum + parseIdrDecimal(p.reserveGrowth), 0n);
  const summary = visible.length ? `${formatCycle(visible[0].month)} – ${formatCycle(visible[visible.length - 1].month)}: pemasukan ${money(toIdrDecimal(incoming))}, pengeluaran ${money(toIdrDecimal(outgoing))}. Pertumbuhan reserve ${money(toIdrDecimal(growth))}.` : "Belum ada data bulanan.";
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Perbandingan bulanan" value={metric} onChange={setMetric} options={[{ value: "cashflow", label: "Pemasukan dan pengeluaran" }, { value: "reserve", label: "Reserve dan pengeluaran" }]} />
        <SelectField label="Rentang bulan" value={window} onChange={setWindow} options={[{ value: "3", label: "3 bulan terakhir" }, { value: "6", label: "6 bulan terakhir" }, { value: "12", label: "12 bulan terakhir" }]} />
      </div>
      <p className="text-sm text-muted">{summary}</p>
      <TrendChart kind="bar" labels={visible.map((p) => formatCycle(p.month))} series={[
        { label: cashflow ? "Pemasukan" : "Pertumbuhan reserve", values: visible.map((p) => cashflow ? p.income : p.reserveGrowth), style: "solid" },
        { label: "Pengeluaran", values: visible.map((p) => p.outflow), style: "outline" },
      ]} summary={summary} unit="Rupiah" />
      <dl className="grid grid-cols-2 gap-3 border-y border-border py-3 text-sm">
        <div><dt className="text-muted">Selisih pemasukan − pengeluaran</dt><dd className="font-medium"><Money value={toIdrDecimal(incoming - outgoing)} signed /></dd></div>
        <div><dt className="text-muted">Pertumbuhan reserve</dt><dd className="font-medium"><Money value={toIdrDecimal(growth)} signed /></dd></div>
      </dl>
      <p className="text-xs text-muted">Bulan belum lengkap tetap diberi label. Biaya hidup memakai alokasi settlement; selisih arus kas bukan saldo rekening atau pertumbuhan reserve.</p>
      <ul aria-label="Data tren bulanan" className="divide-y divide-border text-sm">
        {visible.map((point) => (
          <li key={point.month} className="space-y-1 py-2">
            <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{formatCycle(point.month)}</span><span className="text-xs text-muted">{completenessLabel[point.completeness]}</span></div>
            <p className="tabular">Masuk <Money value={point.income} /> · keluar <Money value={point.outflow} /> · reserve <Money value={point.reserveGrowth} signed /></p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Largest categories plus one exact remainder; the full list stays beside it. */
export function CategoryChart({ categories }: { categories: { name: string; amount: string }[] }) {
  const rows = categories.slice(0, 7);
  if (categories.length > 7) {
    rows.push({ name: "Kategori lainnya", amount: toIdrDecimal(categories.slice(7).reduce((sum, c) => sum + parseIdrDecimal(c.amount), 0n)) });
  }
  const summary = `Pengeluaran khusus per kategori. ${categories.length} kategori. ${rows.map((r) => `${r.name} ${money(r.amount)}`).join("; ")}.`;
  return <TrendChart kind="bar" horizontal labels={rows.map((r) => r.name)} series={[{ label: "Pengeluaran khusus", values: rows.map((r) => r.amount), style: "solid" }]} summary={summary} unit="Rupiah" />;
}
