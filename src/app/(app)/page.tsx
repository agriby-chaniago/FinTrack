import Link from "next/link";
import { redirect } from "next/navigation";

import { AccountTile } from "@/components/account-tile";
import { CountUpMoney } from "@/components/count-up-money";
import { AnimatedItem, AnimatedList } from "@/components/motion";
import { Alert, Card, cardLinkClass, EmptyState, Icon, Money, ProgressBar, Row, SectionTitle, SegmentBar, StatusBadge, Tag, type IconName } from "@/components/ui";
import { markerLabel, obligationProgress, progressPercent, stripSummary, taskKey, taskTitle, type StripDay } from "@/lib/dashboard-view";
import { businessDateOf } from "@/lib/business-time";
import { approx, formatCycle, formatDate, formatDateTime, money } from "@/lib/format";
import { cycleNoteLabel, cycleStateLabel, occurrenceTagLabel } from "@/lib/labels";
import { parseIdrDecimal, toIdrDecimal } from "@/lib/money";
import { dashboard, type DashboardTask } from "@/server/application/reports";
import { runAsPageOwner } from "@/server/auth/page-owner";

type Dashboard = Awaited<ReturnType<typeof dashboard>>;

function taskView(task: DashboardTask, accountName: (id: string) => string): { href: string; title: string; detail: string; tag?: string } {
  switch (task.type) {
    case "SETTLEMENT":
      return { href: "/rutinitas/settlement", title: taskTitle(task, accountName), detail: `${formatDate(task.periodStart)} – ${formatDate(task.normalEnd)}`, tag: task.mode === "OVERDUE" ? "Terlambat" : undefined };
    case "CONFIRM_INCOME":
      return { href: `/rutinitas#siklus-${task.cycleKey}`, title: taskTitle(task, accountName), detail: `${formatCycle(task.cycleKey)} · perkiraan ${money(task.expectedAmount)}`, tag: task.label ? occurrenceTagLabel[task.label] : undefined };
    case "CONFIRM_OBLIGATION":
      return { href: `/rutinitas#siklus-${task.cycleKey}`, title: taskTitle(task, accountName), detail: `${formatCycle(task.cycleKey)}${task.expectedDate ? ` · perkiraan ${formatDate(task.expectedDate)}` : ""}`, tag: task.label ? occurrenceTagLabel[task.label] : undefined };
    case "TRANSFER":
      return { href: `/catat/transfer?target=${task.targetId}`, title: taskTitle(task, accountName), detail: `Sisa saran ${money(task.remaining)} · bisa ditransfer sekarang ${money(task.transferNow)}` };
    case "RECONCILE":
      return { href: `/akun/${task.accountId}#rekonsiliasi`, title: taskTitle(task, accountName), detail: "Konfirmasi saldo sesuai aplikasi bank" };
  }
}

const markerStyle: Record<StripDay["marker"], string> = {
  RECEIVED: "bg-primary text-primary-content",
  ADJUSTED: "border-2 border-plum text-plum",
  MISSED: "border-2 border-danger-fg text-danger-fg",
  INACTIVE: "bg-surface-subtle text-muted",
  UPCOMING: "border-2 border-dashed border-control",
};

const markerIcon: Partial<Record<StripDay["marker"], IconName>> = { RECEIVED: "check", ADJUSTED: "swap", MISSED: "close", INACTIVE: "minus" };

/** Square day markers for the open DANA period (PRD v0.20 P2); each kind is named, not only colored. */
function WeekStrip({ days, today }: { days: StripDay[]; today: string }) {
  return (
    <div className="space-y-2">
      <ul aria-label="Income harian minggu berjalan" className="flex justify-between gap-1">
        {days.map((day, index) => {
          const icon = markerIcon[day.marker];
          const isToday = day.date === today;
          return (
            <li key={day.date} aria-label={`${day.weekday} ${markerLabel[day.marker]}${isToday ? ", hari ini" : ""}`} className="flex flex-1 flex-col items-center gap-1.5">
              {/* Today is outlined and pulses once (PRD v0.22 P10); markers pop in after their section. */}
              <span
                className={`pop-in flex size-8 items-center justify-center ${markerStyle[day.marker]} ${isToday ? "today-ping outline-2 outline-offset-2 outline-primary" : ""}`}
                style={{ animationDelay: `calc(var(--stagger-delay, 0ms) + ${300 + index * 40}ms)` }}
              >
                {icon ? <Icon name={icon} className="size-3.5" /> : null}
              </span>
              <span aria-hidden="true" className="text-xs text-muted">
                {day.weekday}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted">{stripSummary(days)}</p>
    </div>
  );
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
    week: { periodStart: string; normalEnd: string; days: StripDay[] } | null;
    latestCompleted: { settlementId: string; startDate: string; endDate: string; livingExpense: string; averagePerDay: string; hasCorrections: boolean } | null;
  } | null;
  const obligations = data.bca.currentCycle ? obligationProgress(data.bca.currentCycle.obligations) : null;

  return (
    <div className="stagger space-y-8">
      <section aria-labelledby="headline" className="space-y-3 bg-primary-soft p-5 md:p-6">
        <p id="headline" className="text-sm text-muted">
          Personal cash tercatat
        </p>
        <p className="text-[2rem] font-semibold leading-tight md:text-[2.5rem]">
          <CountUpMoney value={data.personalCashRecorded} />
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
          <SectionTitle icon="checklist">
            <span id="tasks-title">Perlu dilakukan</span>
          </SectionTitle>
          <AnimatedList className="cascade divide-y divide-border border border-border bg-surface">
            {tasks.slice(0, 6).map(({ task, view }) => (
              <AnimatedItem key={taskKey(task)}>
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
                {task.type === "TRANSFER" ? (
                  <div className="space-y-1 px-4 pb-3">
                    <ProgressBar percent={progressPercent(task.linked, task.amount)} label={`Progres ${view.title}`} />
                    <p className="text-xs text-muted tabular">
                      <Money value={task.linked} /> dari <Money value={task.amount} /> · {progressPercent(task.linked, task.amount)}% terpenuhi
                    </p>
                  </div>
                ) : null}
                {task.type === "TRANSFER" && parseIdrDecimal(task.transferNow) < parseIdrDecimal(task.remaining) ? (
                  <p className="px-4 pb-3 text-sm text-review-fg">Saldo sumber belum cukup untuk seluruh saran.</p>
                ) : null}
              </AnimatedItem>
            ))}
          </AnimatedList>
          {tasks.length > 6 ? (
            <Link href="/rutinitas" className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-primary">
              Lihat semua di Rutinitas ({tasks.length})
            </Link>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="accounts-title">
        <SectionTitle icon="wallet">
          <span id="accounts-title">Akun</span>
        </SectionTitle>
        <div className="cascade grid gap-3 md:grid-cols-3">
          {data.accounts.map((account, index) => {
            const recordedChanges = parseIdrDecimal(account.personal) - parseIdrDecimal(account.confirmedPersonal);
            return (
              <Link key={account.id} href={`/akun/${account.id}`} className={cardLinkClass}>
                {/* In the three-column grid every badge sits on its own row, so names never shrink;
                    on a phone it stays beside the name and drops below only when it does not fit. */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <AccountTile account={account} index={index} />
                  <div className="min-w-24 flex-1">
                    <p className="truncate font-medium">{account.displayName}</p>
                    <p className="text-xs text-muted">{account.purposeLabel}</p>
                  </div>
                  <div className="md:basis-full">
                    <StatusBadge status={account.status} />
                  </div>
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
            <SectionTitle icon="calendar">DANA mingguan</SectionTitle>
            {dana.week ? (
              <div className="mb-3">
                <WeekStrip days={dana.week.days} today={businessDateOf(new Date())} />
              </div>
            ) : null}
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
          <SectionTitle icon="bars">BCA bulanan</SectionTitle>
          {data.bca.currentCycle ? (
            <>
              {obligations && obligations.total > 0 ? (
                <div className="mb-3 space-y-1.5">
                  <p className="flex justify-between text-xs text-muted">
                    <span>Kewajiban {formatCycle(data.bca.currentCycle.cycleKey)}</span>
                    <span className="tabular">
                      {obligations.resolved}/{obligations.total} selesai
                    </span>
                  </p>
                  <SegmentBar done={obligations.resolved} total={obligations.total} label="Kewajiban bulan ini yang selesai" />
                </div>
              ) : null}
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
            </>
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
          <SectionTitle icon="arrowUp">Reserve dan pengeluaran khusus</SectionTitle>
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
            <SectionTitle icon="user">Dana titipan</SectionTitle>
            <dl>
              {data.external.map((subject) => (
                <Row key={subject.id} label={<Link href={`/akun/dana-titipan/${subject.id}`} className="text-primary">{subject.displayName}</Link>}>
                  <Money value={subject.total} />
                </Row>
              ))}
            </dl>
          </Card>
        ) : null}

        {!data.chart.weekly.eligible ? (
          <section aria-labelledby="trend-title" className="flex gap-3 border border-dashed border-control p-4 md:col-span-2 md:p-5">
            <span className="flex size-9 shrink-0 items-center justify-center bg-primary-soft text-primary">
              <Icon name="trend" className="size-4.5" />
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <div>
                <h2 id="trend-title" className="font-medium">
                  Tren mingguan
                </h2>
                <p className="text-sm text-muted">Muncul di Laporan setelah {data.chart.weekly.needed} settlement selesai.</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <ProgressBar percent={Math.floor((data.chart.weekly.count * 100) / data.chart.weekly.needed)} label="Kelayakan tren mingguan" />
                </div>
                <span className="text-xs text-muted tabular">
                  {data.chart.weekly.count}/{data.chart.weekly.needed} settlement
                </span>
              </div>
            </div>
          </section>
        ) : null}
      </div>

      {data.accounts.length === 0 ? <EmptyState icon="wallet" title="Belum ada akun aktif" /> : null}
    </div>
  );
}
