import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert, Card, EmptyState, Icon, Money, Row, SectionTitle, StatusBadge, Tag } from "@/components/ui";
import { approx, formatCycle, formatDate, formatDateTime, money } from "@/lib/format";
import { cycleNoteLabel, cycleStateLabel, occurrenceTagLabel, settlementModeLabel } from "@/lib/labels";
import { parseIdrDecimal, toIdrDecimal } from "@/lib/money";
import { dashboard, type DashboardTask } from "@/server/application/reports";
import { runAsPageOwner } from "@/server/auth/page-owner";

type Dashboard = Awaited<ReturnType<typeof dashboard>>;

function taskView(task: DashboardTask, accountName: (id: string) => string): { href: string; title: string; detail: string; tag?: string } {
  switch (task.type) {
    case "SETTLEMENT":
      return { href: "/rutinitas/settlement", title: settlementModeLabel[task.mode] ?? "Settlement DANA", detail: `${formatDate(task.periodStart)} – ${formatDate(task.normalEnd)}`, tag: task.mode === "OVERDUE" ? "Terlambat" : undefined };
    case "CONFIRM_INCOME":
      return { href: `/rutinitas#siklus-${task.cycleKey}`, title: `Konfirmasi ${task.name.toLowerCase()}`, detail: `${formatCycle(task.cycleKey)} · perkiraan ${money(task.expectedAmount)}`, tag: task.label ? occurrenceTagLabel[task.label] : undefined };
    case "CONFIRM_OBLIGATION":
      return { href: `/rutinitas#siklus-${task.cycleKey}`, title: `Konfirmasi ${task.name}`, detail: `${formatCycle(task.cycleKey)}${task.expectedDate ? ` · perkiraan ${formatDate(task.expectedDate)}` : ""}`, tag: task.label ? occurrenceTagLabel[task.label] : undefined };
    case "TRANSFER":
      return { href: `/catat/transfer?target=${task.targetId}`, title: `Transfer ${task.route}`, detail: `Sisa saran ${money(task.remaining)} · bisa ditransfer sekarang ${money(task.transferNow)}` };
    case "RECONCILE":
      return { href: `/akun/${task.accountId}#rekonsiliasi`, title: `Periksa saldo ${accountName(task.accountId)}`, detail: "Konfirmasi saldo sesuai aplikasi bank" };
  }
}

export default async function BerandaPage() {
  const result = await runAsPageOwner((tx, principal) => dashboard(tx, principal.ownerId, new Date()));
  if (result.status !== "OWNER") redirect("/login");
  const data: Dashboard = result.value;
  const accountName = (id: string) => data.accounts.find((a) => a.id === id)?.displayName ?? "akun";
  const tasks = data.tasks.map((task) => ({ task, view: taskView(task, accountName) }));
  const dana = data.dana as {
    accountId: string;
    openWeek: { periodStart: string; recognizedIncomeToDate: string } | null;
    latestCompleted: { settlementId: string; startDate: string; endDate: string; livingExpense: string; averagePerDay: string; hasCorrections: boolean } | null;
  } | null;

  return (
    <div className="space-y-8">
      <section aria-labelledby="headline" className="space-y-3">
        <p id="headline" className="text-sm text-muted">
          Personal cash tercatat
        </p>
        <p className="text-[2rem] font-semibold leading-tight md:text-[2.5rem]">
          <Money value={data.personalCashRecorded} />
        </p>
        <p className="text-sm text-muted">
          Total terkonfirmasi terakhir <Money value={data.confirmedPersonalCash} />. Nilai tercatat bukan saldo realtime dari bank.
        </p>
        {data.danaDisclosure ? <Alert tone="info">Biaya hidup minggu berjalan belum direkonstruksi.</Alert> : null}
        {data.warnings.map((warning, index) => (
          <Alert key={index} tone="danger" title={warning.type === "DISCREPANCY" ? "Ada selisih saldo" : warning.type === "EXTERNAL_FUND_SHORTFALL" ? "Kekurangan dana titipan" : "Uang pribadi negatif"}>
            {accountName(warning.accountId)}
            {warning.amount ? <> · <Money value={warning.amount} /></> : null}
          </Alert>
        ))}
      </section>

      {tasks.length > 0 ? (
        <section aria-labelledby="tasks-title">
          <SectionTitle>
            <span id="tasks-title">Perlu dilakukan</span>
          </SectionTitle>
          <ul className="divide-y divide-border border border-border bg-surface">
            {tasks.slice(0, 6).map(({ task, view }, index) => (
              <li key={index}>
                <Link href={view.href} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 hover:bg-surface-subtle">
                  <span>
                    <span className="block font-medium">{view.title}</span>
                    <span className="block text-sm text-muted">{view.detail}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {view.tag ? <Tag tone="review">{view.tag}</Tag> : null}
                    <Icon name="chevron" className="size-4 text-muted" />
                  </span>
                </Link>
                {task.type === "TRANSFER" && parseIdrDecimal(task.transferNow) < parseIdrDecimal(task.remaining) ? (
                  <p className="px-4 pb-3 text-sm text-review-fg">Saldo sumber belum cukup untuk seluruh saran.</p>
                ) : null}
              </li>
            ))}
          </ul>
          {tasks.length > 6 ? (
            <Link href="/rutinitas" className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-primary">
              Lihat semua di Rutinitas ({tasks.length})
            </Link>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="accounts-title">
        <SectionTitle>
          <span id="accounts-title">Akun</span>
        </SectionTitle>
        <div className="grid gap-3 md:grid-cols-3">
          {data.accounts.map((account) => {
            const recordedChanges = parseIdrDecimal(account.personal) - parseIdrDecimal(account.confirmedPersonal);
            return (
              <Link key={account.id} href={`/akun/${account.id}`} className="block border border-border bg-surface p-4 hover:border-control md:p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{account.displayName}</p>
                    <p className="text-xs text-muted">{account.purposeLabel}</p>
                  </div>
                  <StatusBadge status={account.status} />
                </div>
                <p className="mt-3 text-xl font-semibold md:text-2xl">
                  <Money value={account.personal} />
                </p>
                <p className="mt-1 text-xs text-muted">
                  Terkonfirmasi <Money value={account.confirmedPersonal} /> · {formatDateTime(account.lastConfirmedAt)}
                </p>
                {account.openWeekDisclosure ? (
                  <p className="mt-1 text-xs text-calculated-fg">
                    Perubahan tercatat <Money value={toIdrDecimal(recordedChanges)} signed /> · biaya hidup minggu berjalan belum direkonstruksi
                  </p>
                ) : null}
                {account.external !== "0" ? (
                  <p className="mt-1 text-xs text-muted">
                    Fisik <Money value={account.physical} /> · titipan <Money value={account.external} />
                  </p>
                ) : null}
                {account.shortfall !== "0" ? (
                  <p className="mt-2">
                    <Tag tone="danger" icon="alert">
                      Kekurangan titipan <Money value={account.shortfall} />
                    </Tag>
                  </p>
                ) : null}
              </Link>
            );
          })}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {dana ? (
          <Card>
            <SectionTitle>DANA mingguan</SectionTitle>
            {dana.openWeek ? (
              <dl>
                <Row label={`Minggu berjalan sejak ${formatDate(dana.openWeek.periodStart)}`}>
                  <Tag tone="info" icon="clock">Menunggu settlement</Tag>
                </Row>
                <Row label="Income tercatat">
                  <Money value={dana.openWeek.recognizedIncomeToDate} />
                </Row>
                <Row label="Biaya hidup">Menunggu settlement</Row>
              </dl>
            ) : null}
            {dana.latestCompleted ? (
              <dl className="mt-3 border-t border-border pt-3">
                <Row label={`Selesai ${formatDate(dana.latestCompleted.startDate)} – ${formatDate(dana.latestCompleted.endDate)}`}>
                  <Link href={`/rutinitas/settlement/${dana.latestCompleted.settlementId}`} className="text-primary">
                    Detail
                  </Link>
                </Row>
                <Row label="Biaya hidup" emphasis>
                  <Money value={dana.latestCompleted.livingExpense} />
                </Row>
                <Row label="Rata-rata per hari">{approx(dana.latestCompleted.averagePerDay)}</Row>
                {dana.latestCompleted.hasCorrections ? <p className="text-xs text-muted">Termasuk koreksi setelah settlement.</p> : null}
              </dl>
            ) : (
              <p className="mt-2 text-sm text-muted">Belum ada settlement yang selesai.</p>
            )}
          </Card>
        ) : null}

        <Card>
          <SectionTitle>BCA bulanan</SectionTitle>
          {data.bca.currentCycle ? (
            <dl>
              <Row label={formatCycle(data.bca.currentCycle.cycleKey)}>
                <Tag tone={data.bca.currentCycle.state === "COMPLETE" ? "success" : "info"}>{cycleStateLabel[data.bca.currentCycle.state]}</Tag>
              </Row>
              {data.bca.currentCycle.income ? (
                <Row label="Income">{data.bca.currentCycle.income.actual ? <Money value={data.bca.currentCycle.income.actual.amount} /> : "Menunggu"}</Row>
              ) : null}
              {data.bca.currentCycle.obligations.map((o) => (
                <Row key={o.occurrenceId} label={o.name}>
                  {o.actual ? <Money value={o.actual.amount} /> : o.status === "NOT_CHARGED" ? "Tidak ditagih" : "Menunggu"}
                </Row>
              ))}
              {data.bca.currentCycle.state !== "COMPLETE" ? <p className="text-xs text-muted">Belum final</p> : null}
            </dl>
          ) : (
            <p className="text-sm text-muted">Belum ada siklus bulan ini.</p>
          )}
          {data.bca.latestCompletedCycle ? (
            <dl className="mt-3 border-t border-border pt-3">
              <Row label={`Selesai ${formatCycle(data.bca.latestCompletedCycle.cycleKey)}`}>
                {data.bca.latestCompletedCycle.note ? cycleNoteLabel[data.bca.latestCompletedCycle.note] : cycleStateLabel[data.bca.latestCompletedCycle.state]}
              </Row>
              {data.bca.latestCompletedCycle.target ? (
                <Row label="Target transfer">
                  <Money value={data.bca.latestCompletedCycle.target.amount} />
                </Row>
              ) : null}
            </dl>
          ) : null}
        </Card>

        <Card>
          <SectionTitle>Reserve dan pengeluaran khusus</SectionTitle>
          <dl>
            <Row label={`Pertumbuhan bersih reserve · ${formatCycle(data.reserve.month)}`} emphasis>
              <Money value={data.reserve.monthToDate.netGrowth} signed />
            </Row>
            <Row label="Masuk ke reserve (gross saved)">
              <Money value={data.reserve.monthToDate.grossSaved} />
            </Row>
            <Row label="Pengeluaran khusus semua akun">
              <Money value={data.reserve.specialOutflowMonthToDate} />
            </Row>
          </dl>
        </Card>

        {data.external.length > 0 ? (
          <Card>
            <SectionTitle>Dana titipan</SectionTitle>
            <dl>
              {data.external.map((subject) => (
                <Row key={subject.id} label={<Link href={`/akun/dana-titipan/${subject.id}`} className="text-primary">{subject.displayName}</Link>}>
                  <Money value={subject.total} />
                </Row>
              ))}
            </dl>
          </Card>
        ) : null}
      </div>

      {data.accounts.length === 0 ? <EmptyState title="Belum ada akun aktif" /> : null}
    </div>
  );
}
