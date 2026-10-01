import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert, Card, EmptyState, LinkButton, Money, PageHeader, Row, SectionTitle, Tag, type Tone } from "@/components/ui";
import { approx, formatCycle, formatDate } from "@/lib/format";
import { cycleNoteLabel, cycleStateLabel, occurrenceStatusLabel, occurrenceTagLabel, progressLabel, settlementModeLabel } from "@/lib/labels";
import { parseIdrDecimal } from "@/lib/money";
import { dailyIncomeView } from "@/server/application/daily-income";
import { listMonthlyCycles } from "@/server/application/monthly";
import { settlementHistory } from "@/server/application/reports";
import { settlementRouter } from "@/server/application/settlement";
import { listTargets, transferSuggestions, type TargetView } from "@/server/application/transfers";
import { runAsPageOwner } from "@/server/auth/page-owner";

import { CloseTargetButton, OccurrenceActions, OverrideForm } from "./actions";

const stateTone: Record<string, Tone> = {
  COMPLETE: "success",
  CLOSED_NO_INCOME: "neutral",
  READY_TO_TRANSFER: "info",
  PARTIALLY_TRANSFERRED: "info",
  WAITING_FOR_PRIOR_CYCLE: "review",
};

function targetContext(target: TargetView): string {
  return target.contextType === "BCA_CYCLE" ? `Siklus ${formatCycle(target.contextKey)}` : `Settlement s.d. ${formatDate(target.contextOrder)}`;
}

export default async function RutinitasPage() {
  const now = new Date();
  const result = await runAsPageOwner(async (tx, { ownerId }) => {
    // Cycles may create a new month's occurrences; the rest only reads.
    const cycles = await listMonthlyCycles(tx, ownerId, now);
    const targets = await listTargets(tx, ownerId);
    const router = await settlementRouter(tx, ownerId, now);
    const history = await settlementHistory(tx, ownerId);
    const daily = await dailyIncomeView(tx, ownerId, now);
    return { router, history, cycles, targets, suggestions: await transferSuggestions(tx, ownerId, { targets }), daily };
  });
  if (result.status !== "OWNER") redirect("/login");
  const { router, history, cycles, targets, suggestions, daily } = result.value;
  const openTargets = targets.filter((t) => t.version?.isActionable && parseIdrDecimal(t.remaining) > 0n);
  const doneTargets = targets.filter((t) => !openTargets.includes(t) && t.version).reverse().slice(0, 8);
  const recent = [...history].reverse().slice(0, 8);
  const maxLiving = recent.reduce((max, row) => (parseIdrDecimal(row.livingExpense) > max ? parseIdrDecimal(row.livingExpense) : max), 1n);

  return (
    <div className="space-y-8">
      <PageHeader title="Rutinitas" description="Settlement mingguan, konfirmasi bulanan, dan transfer ke reserve." />

      {router.mode !== "NO_WEEKLY_ACCOUNT" ? (
        <section aria-labelledby="dana-title" className="space-y-3">
          <Card>
            <SectionTitle>
              <span id="dana-title">Settlement DANA</span>
            </SectionTitle>
            <p className="font-medium">{settlementModeLabel[router.mode]}</p>
            <p className="mt-1 text-sm text-muted">
              Periode {formatDate(router.periodStart)} – {formatDate(router.normalEnd)}
              {router.mode === "INFORMATIONAL" ? ` · settlement tersedia ${formatDate(router.normalEnd)}` : ""}
            </p>
            <div className="mt-4">
              {router.mode === "INFORMATIONAL" ? (
                <LinkButton href="/rutinitas/settlement">Lihat status</LinkButton>
              ) : (
                <LinkButton href="/rutinitas/settlement" variant="primary">
                  {router.mode === "DRAFT" ? "Lanjutkan settlement" : "Mulai settlement"}
                </LinkButton>
              )}
            </div>
          </Card>

          {recent.length > 0 ? (
            <Card>
              <SectionTitle>Riwayat biaya hidup mingguan</SectionTitle>
              <table className="w-full text-sm">
                <caption className="sr-only">Biaya hidup per settlement, terbaru di atas</caption>
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th scope="col" className="py-1 font-medium">Periode</th>
                    <th scope="col" className="py-1 text-right font-medium">Biaya hidup</th>
                    <th scope="col" className="hidden py-1 text-right font-medium sm:table-cell">Rata-rata/hari</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((row) => {
                    const living = parseIdrDecimal(row.livingExpense);
                    const width = living > 0n ? Number((living * 100n) / maxLiving) : 0;
                    return (
                      <tr key={row.settlementId} className="border-t border-border">
                        <td className="py-2">
                          <Link href={`/rutinitas/settlement/${row.settlementId}`} className="text-primary">
                            {formatDate(row.startDate)} – {formatDate(row.endDate)}
                          </Link>
                          <span aria-hidden="true" className="mt-1 block h-1.5 bg-primary-soft">
                            <span className="block h-1.5 bg-primary" style={{ width: `${width}%` }} />
                          </span>
                        </td>
                        <td className="py-2 text-right align-top">
                          <Money value={row.livingExpense} />
                        </td>
                        <td className="hidden py-2 text-right align-top sm:table-cell">{approx(row.averagePerDay)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          ) : null}

          {daily && daily.currentState === "ACTIVE" ? (
            <Card>
              <details>
                <summary className="flex min-h-11 cursor-pointer items-center font-medium">Income harian hari tertentu berbeda?</summary>
                <p className="mb-3 text-sm text-muted">
                  Default <Money value={daily.amount} /> per hari aktif. Catat pengecualian untuk hari dengan income berbeda atau tidak diterima.
                </p>
                <OverrideForm ruleId={daily.ruleId} minDate={daily.minimumTransitionDate} />
              </details>
            </Card>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="transfer-title">
        <SectionTitle>
          <span id="transfer-title">Transfer ke reserve</span>
        </SectionTitle>
        {suggestions.length > 0 ? (
          <div className="mb-3 grid gap-3 md:grid-cols-2">
            {suggestions.map((s) => (
              <Card key={s.route.sourceAccountId}>
                <p className="font-medium">{s.sourceName} → reserve</p>
                <dl className="mt-2">
                  <Row label="Sisa saran">
                    <Money value={s.outstanding} />
                  </Row>
                  <Row label="Bisa ditransfer sekarang" emphasis>
                    <Money value={s.transferNow} />
                  </Row>
                </dl>
                {s.liquidityWarning ? <p className="mt-2 text-sm text-review-fg">Saldo pribadi {s.sourceName} belum cukup untuk seluruh saran.</p> : null}
              </Card>
            ))}
          </div>
        ) : null}
        {openTargets.length === 0 ? (
          <EmptyState title="Tidak ada transfer yang menunggu" />
        ) : (
          <ul className="space-y-3">
            {openTargets.map((target) => (
              <li key={target.id}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {target.route.sourceName} → {target.route.destinationName}
                      </p>
                      <p className="text-sm text-muted">{targetContext(target)}</p>
                    </div>
                    <Tag tone={target.progress === "PARTIALLY_TRANSFERRED" ? "info" : "review"}>{progressLabel[target.progress]}</Tag>
                  </div>
                  <dl className="mt-2">
                    <Row label="Saran">
                      <Money value={target.version?.amount} />
                    </Row>
                    <Row label="Sudah ditransfer">
                      <Money value={target.linked} />
                    </Row>
                    <Row label="Sisa" emphasis>
                      <Money value={target.remaining} />
                    </Row>
                  </dl>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <LinkButton href={`/catat/transfer?target=${target.id}`} variant="primary">
                      Catat transfer
                    </LinkButton>
                    <CloseTargetButton targetId={target.id} />
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
        {doneTargets.length > 0 ? (
          <details className="mt-3">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-primary">Target sebelumnya</summary>
            <ul className="divide-y divide-border border border-border bg-surface">
              {doneTargets.map((target) => (
                <li key={target.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span>
                    {targetContext(target)} · {target.route.sourceName}
                  </span>
                  <span className="flex items-center gap-2">
                    <Money value={target.linked} />
                    <Tag tone={target.progress === "CLOSED" ? "neutral" : "success"}>
                      {target.version?.retirementReason === "INCOME_NOT_RECEIVED" ? "Tidak ada saran" : progressLabel[target.progress]}
                    </Tag>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section aria-labelledby="bca-title" className="space-y-3">
        <SectionTitle>
          <span id="bca-title">Siklus bulanan</span>
        </SectionTitle>
        {cycles.length === 0 ? <EmptyState title="Belum ada siklus bulanan" /> : null}
        {cycles.map((cycle) => (
          <Card key={`${cycle.accountId}-${cycle.cycleKey}`}>
            <div id={`siklus-${cycle.cycleKey}`} className="scroll-mt-20">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{formatCycle(cycle.cycleKey)}</h3>
                  <p className="text-sm text-muted">{cycle.accountName}</p>
                </div>
                <Tag tone={stateTone[cycle.state] ?? "info"}>{cycleStateLabel[cycle.state]}</Tag>
              </div>
              {cycle.note ? <p className="mt-1 text-sm text-muted">{cycleNoteLabel[cycle.note]}</p> : null}

              <ul className="mt-3 space-y-4">
                {cycle.income ? (
                  <li className="bg-surface-subtle p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">Income bulanan</p>
                      <span className="flex items-center gap-2">
                        {cycle.income.label ? <Tag tone="review">{occurrenceTagLabel[cycle.income.label]}</Tag> : null}
                        <Tag tone={cycle.income.status === "CONFIRMED" ? "success" : "neutral"}>{occurrenceStatusLabel[cycle.income.status]}</Tag>
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      {cycle.income.actual ? (
                        <>
                          <Money value={cycle.income.actual.amount} /> · {formatDate(cycle.income.actual.date)}
                        </>
                      ) : (
                        <>
                          Perkiraan <Money value={cycle.income.expectedAmount} />
                        </>
                      )}
                    </p>
                    <div className="mt-3">
                      <OccurrenceActions
                        type="monthly-income"
                        occurrenceId={cycle.income.occurrenceId}
                        cycleKey={cycle.cycleKey}
                        status={cycle.income.status}
                        expectedDate={null}
                        expectedDay={null}
                        suggestedAmount={cycle.income.expectedAmount}
                        confirmedEntryId={cycle.income.actual?.entryId ?? null}
                      />
                    </div>
                  </li>
                ) : null}
                {cycle.obligations.map((o) => (
                  <li key={o.occurrenceId} className="bg-surface-subtle p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{o.name}</p>
                      <span className="flex items-center gap-2">
                        {o.label ? <Tag tone="review">{occurrenceTagLabel[o.label]}</Tag> : null}
                        <Tag tone={o.status === "CONFIRMED" ? "success" : "neutral"}>{occurrenceStatusLabel[o.status]}</Tag>
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      {o.actual ? (
                        <>
                          <Money value={o.actual.amount} /> · {formatDate(o.actual.date)}
                        </>
                      ) : (
                        <>
                          {o.expectedDate ? `Perkiraan ${formatDate(o.expectedDate)}` : "Tanggal belum pasti"}
                          {o.suggestedAmount ? (
                            <>
                              {" "}
                              · saran <Money value={o.suggestedAmount} />
                            </>
                          ) : null}
                        </>
                      )}
                    </p>
                    <div className="mt-3">
                      <OccurrenceActions
                        type="recurring-expense"
                        occurrenceId={o.occurrenceId}
                        ruleId={o.ruleId}
                        cycleKey={cycle.cycleKey}
                        status={o.status}
                        expectedDate={o.expectedDate}
                        expectedDay={o.expectedDate ? Number(o.expectedDate.slice(8, 10)) : null}
                        suggestedAmount={o.suggestedAmount}
                        confirmedEntryId={o.actual?.entryId ?? null}
                      />
                    </div>
                  </li>
                ))}
              </ul>

              {cycle.target ? (
                <dl className="mt-3 border-t border-border pt-3">
                  <Row label="Target transfer ke reserve">
                    <Money value={cycle.target.amount} />
                  </Row>
                  <Row label="Sudah ditransfer">
                    <Money value={cycle.target.linked} />
                  </Row>
                  <Row label="Status">{progressLabel[cycle.target.progress]}</Row>
                </dl>
              ) : cycle.state === "WAITING_FOR_PRIOR_CYCLE" ? (
                <Alert tone="review">Selesaikan siklus sebelumnya terlebih dahulu.</Alert>
              ) : null}
            </div>
          </Card>
        ))}
      </section>
    </div>
  );
}
