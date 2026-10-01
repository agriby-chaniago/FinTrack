import Link from "next/link";
import { redirect } from "next/navigation";

import { buttonClass, Card, Money, PageHeader, ProgressBar, Row, SectionTitle, Tag } from "@/components/ui";
import { businessDateOf, cycleKeyOf, isCycleKey, nextCycleKey } from "@/lib/business-time";
import { approx, formatCycle, formatDate } from "@/lib/format";
import { completenessLabel } from "@/lib/labels";
import { categoryShares } from "@/lib/report-view";
import { reportPage } from "@/server/application/reports";
import { runAsPageOwner } from "@/server/auth/page-owner";

import { AktivitasTabs } from "../tabs";
import { TrendChart } from "./trend-chart";

function Stat({ label, value, delta, previousMonth, signed }: { label: string; value: string; delta: string; previousMonth: string; signed?: boolean }) {
  return (
    <div className="border border-border bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold">
        <Money value={value} signed={signed} />
      </p>
      <p className="mt-1 text-xs text-muted">
        <Money value={delta} signed /> dari {formatCycle(previousMonth)}
      </p>
    </div>
  );
}

/** Before the history threshold (PRD: Chart) the card says when the chart appears. */
function EligibilityNote({ text, count, needed, unit, label }: { text: string; count: number; needed: number; unit: string; label: string }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">{text}</p>
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <ProgressBar percent={Math.min(100, Math.floor((count * 100) / needed))} label={label} />
        </div>
        <span className="text-xs text-muted tabular">
          {count}/{needed} {unit}
        </span>
      </div>
    </div>
  );
}

export default async function LaporanPage({ searchParams }: { searchParams: Promise<{ bulan?: string }> }) {
  const { bulan } = await searchParams;
  const current = cycleKeyOf(businessDateOf(new Date()));
  const month = bulan && isCycleKey(bulan) && bulan <= current ? bulan : current;
  const result = await runAsPageOwner((tx, { ownerId }) => reportPage(tx, ownerId, month, new Date()));
  if (result.status !== "OWNER") redirect("/login");
  const { report, previousMonth, firstMonth, deltas, weekly, monthly } = result.value;
  const next = nextCycleKey(month);
  const shares = categoryShares(report.outflow.specialByCategory.map((c) => ({ name: c.name, amount: c.amount })));

  return (
    <div>
      <PageHeader title="Aktivitas" description="Laporan bulan kalender: pemasukan, pengeluaran, dan reserve." />
      <AktivitasTabs active="laporan" />

      <div className="space-y-6">
        <nav aria-label="Pilih bulan" className="flex flex-wrap items-center justify-between gap-3">
          {month > firstMonth ? (
            <Link href={`/aktivitas/laporan?bulan=${previousMonth}`} className={buttonClass.link}>
              ‹ Bulan sebelumnya ({formatCycle(previousMonth)})
            </Link>
          ) : (
            <span />
          )}
          {month < current ? (
            <Link href={`/aktivitas/laporan?bulan=${next}`} className={buttonClass.link}>
              Bulan berikutnya ({formatCycle(next)}) ›
            </Link>
          ) : null}
        </nav>

        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold">{formatCycle(month)}</h2>
          <Tag tone={report.completeness === "LENGKAP" ? "success" : "info"}>{completenessLabel[report.completeness] ?? report.completeness}</Tag>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <Stat label="Pemasukan" value={report.income.total} delta={deltas.income} previousMonth={previousMonth} />
          <Stat label="Pengeluaran" value={report.outflow.actualTotal} delta={deltas.outflow} previousMonth={previousMonth} />
          <Stat label="Pertumbuhan reserve" value={report.reserve.netGrowth} delta={deltas.reserve} previousMonth={previousMonth} signed />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <SectionTitle icon="plus">Pemasukan</SectionTitle>
            <dl>
              <Row label="Income harian">
                <Money value={report.income.daily} />
              </Row>
              <Row label="Income bulanan">
                <Money value={report.income.monthly} />
              </Row>
              <Row label="Pemasukan lain">
                <Money value={report.income.other} />
              </Row>
              <Row label="Dana titipan yang direlakan">
                <Money value={report.income.gift} />
              </Row>
              <Row label="Total" emphasis>
                <Money value={report.income.total} />
              </Row>
            </dl>
          </Card>

          <Card>
            <SectionTitle icon="minus">Pengeluaran</SectionTitle>
            <dl>
              <Row label="Biaya hidup (alokasi settlement)">{approx(report.outflow.living)}</Row>
              <Row label="Kewajiban bulanan">
                <Money value={report.outflow.recurring} />
              </Row>
              <Row label="Pengeluaran khusus">
                <Money value={report.outflow.special} />
              </Row>
              <Row label="Pengeluaran lain">
                <Money value={report.outflow.other} />
              </Row>
              <Row label="Dana titipan dipakai pemiliknya">
                <Money value={report.outflow.ownership} />
              </Row>
              <Row label="Total" emphasis>
                <Money value={report.outflow.actualTotal} />
              </Row>
            </dl>
            {shares.length > 0 ? (
              <div className="mt-4 space-y-3 border-t border-border pt-4">
                <p className="text-sm font-medium">Pengeluaran khusus per kategori</p>
                <ul className="space-y-3">
                  {shares.map((share) => (
                    <li key={share.name} className="space-y-1">
                      <p className="flex justify-between text-sm">
                        <span>{share.name}</span>
                        <span>
                          <Money value={share.amount} /> · {share.percent}%
                        </span>
                      </p>
                      <ProgressBar percent={share.percent} label={`Bagian ${share.name}`} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>
        </div>

        <section aria-labelledby="tren-title" className="space-y-3">
          <SectionTitle icon="trend">
            <span id="tren-title">Tren</span>
          </SectionTitle>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <h3 className="mb-3 font-medium">Biaya hidup per hari</h3>
              {weekly.eligibility.eligible ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted">{weekly.summary}</p>
                  <TrendChart
                    kind="line"
                    labels={weekly.points.map((point) => formatDate(point.endDate))}
                    series={[{ label: "Rata-rata biaya hidup per hari", values: weekly.points.map((point) => point.averagePerDay), style: "solid" }]}
                    summary={weekly.summary}
                    unit="Rupiah per hari"
                  />
                  <ul aria-label="Data tren mingguan" className="divide-y divide-border text-sm">
                    {weekly.points.map((point) => (
                      <li key={point.settlementId} className="flex justify-between gap-3 py-1.5">
                        <span className="text-muted">
                          {formatDate(point.startDate)} – {formatDate(point.endDate)}
                        </span>
                        <span className="tabular">
                          <Money value={point.averagePerDay} /> / hari
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <EligibilityNote
                  text={`Grafik muncul setelah ${weekly.eligibility.needed} settlement selesai.`}
                  count={weekly.eligibility.count}
                  needed={weekly.eligibility.needed}
                  unit="settlement"
                  label="Kelayakan tren mingguan"
                />
              )}
            </Card>
            <Card>
              <h3 className="mb-3 font-medium">Reserve dan pengeluaran per bulan</h3>
              {monthly.eligibility.eligible ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted">{monthly.summary}</p>
                  <TrendChart
                    kind="bar"
                    labels={monthly.points.map((point) => formatCycle(point.month))}
                    series={[
                      { label: "Pertumbuhan reserve", values: monthly.points.map((point) => point.reserveGrowth), style: "solid" },
                      { label: "Pengeluaran", values: monthly.points.map((point) => point.outflow), style: "outline" },
                    ]}
                    summary={monthly.summary}
                    unit="Rupiah"
                  />
                  <ul aria-label="Data tren bulanan" className="divide-y divide-border text-sm">
                    {monthly.points.map((point) => (
                      <li key={point.month} className="flex flex-wrap justify-between gap-x-3 py-1.5">
                        <span className="text-muted">{formatCycle(point.month)}</span>
                        <span className="tabular">
                          reserve <Money value={point.reserveGrowth} signed /> · keluar <Money value={point.outflow} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <EligibilityNote
                  text={`Grafik muncul setelah ${monthly.eligibility.needed} siklus BCA selesai.`}
                  count={monthly.eligibility.count}
                  needed={monthly.eligibility.needed}
                  unit="siklus"
                  label="Kelayakan tren bulanan"
                />
              )}
            </Card>
          </div>
        </section>
      </div>
    </div>
  );
}
