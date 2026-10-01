// Reporting projections (PRD: Metrics dan perhitungan, Calendar-month
// reporting, Dashboard hierarchy). Nothing here writes financial data.
import { and, asc, eq, sql } from "drizzle-orm";

import { businessDateOf, cycleKeyOf, isCycleKey } from "@/lib/business-time";
import { chartEligibility, weekStrip } from "@/lib/dashboard-view";
import { parseIdrDecimal, toIdrDecimal, type MinorUnits } from "@/lib/money";
import { ApiError } from "@/server/api/errors";
import type { OwnerTx } from "@/server/db/owner";
import { settlement } from "@/server/db/schema/settlement";
import { dailyIncomeBetween, daysBetweenInclusive, roundedAverage } from "@/server/domain/daily-income";
import { lastDayOfCycle } from "@/server/domain/monthly";
import { monthCompleteness, prorataByMonth } from "@/server/domain/reporting";

import { accountsOverview } from "./accounts-overview";
import { dailyRuleContext, dailyRuleFor, recognizedIncomeFor } from "./daily-income";
import { listExternalSubjects } from "./external-funds";
import { listMonthlyCycles } from "./monthly";
import { correctedLivingExpenses, settlementRouter } from "./settlement";
import { listTargets, reserveAccountId, transferSuggestions } from "./transfers";
import { sqlRows } from "@/server/db/rows";

export type ReportView = "corrected" | "as_settled";

const amount = (value: MinorUnits) => toIdrDecimal(value);

/**
 * Recorded ledger totals for a business-date range, classified once for every
 * report (month report and the Beranda summary share this function). Living
 * expense is not here: it comes from settlements.
 */
async function ledgerTotals(tx: OwnerTx, ownerId: string, first: string, last: string, reserve: string, view: ReportView) {
  // As-settled: drop settled-history corrections and records added to a settled range after its settlement.
  const asSettledFilter =
    view === "as_settled"
      ? sql`and e.kind <> 'CORRECTION_POSTING' and not exists (
          select 1 from fintrack.settlement s
          where s.owner_id = ${ownerId} and s.status = 'SETTLED'
            and s.account_id = coalesce((select a.settlement_account_id from fintrack.account a where a.id = l.account_id), l.account_id)
            and e.effective_business_date between s.start_date and s.end_date and e.recorded_at > s.settled_at)`
      : sql``;

  const legs = await sqlRows<{
    kind: string;
    event_class: string;
    classification: string | null;
    role: string | null;
    account_id: string;
    category_id: string | null;
    category_name: string | null;
    personal: string;
    original_reserve_inflow: boolean | null;
  }>(tx, sql`
    select e.kind, e.event_class, e.reporting_classification as classification, e.correction_role as role,
           l.account_id, e.category_id, c.display_name as category_name,
           (l.physical_effect_minor - l.external_effect_minor)::text as personal,
           (select sum(o.physical_effect_minor - o.external_effect_minor) > 0 from fintrack.ledger_leg o
             where o.entry_id = e.corrects_entry_id and o.account_id = ${reserve}::uuid) as original_reserve_inflow
    from fintrack.ledger_leg l
    join fintrack.ledger_entry e on e.id = l.entry_id
    left join fintrack.special_expense_category c on c.id = e.category_id
    where e.owner_id = ${ownerId} and l.owner_id = ${ownerId}
      and e.effective_business_date between ${first}::date and ${last}::date
      and e.event_class <> 'LIVING' ${asSettledFilter}`);

  const totals = {
    monthlyIncome: 0n,
    otherIncome: 0n,
    giftIncome: 0n,
    specialOutflow: 0n,
    recurringExpense: 0n,
    otherExpense: 0n,
    ownershipOutflow: 0n,
    grossSaved: 0n,
    netReserveGrowth: 0n,
    adjustments: 0n,
  };
  const specialByCategory = new Map<string, { name: string; amount: MinorUnits }>();
  const specialByAccount = new Map<string, MinorUnits>();

  for (const leg of legs) {
    const p = BigInt(leg.personal);
    if (leg.event_class === "ADJUSTMENT") {
      totals.adjustments += p;
      continue; // never income, expense, or reserve growth
    }
    if (leg.account_id === reserve) totals.netReserveGrowth += p;
    switch (leg.event_class) {
      case "MONTHLY_INCOME":
        totals.monthlyIncome += p;
        break;
      case "OTHER_INCOME":
        totals.otherIncome += p;
        break;
      case "SPECIAL_EXPENSE": {
        totals.specialOutflow -= p;
        const category = specialByCategory.get(leg.category_id!) ?? { name: leg.category_name!, amount: 0n };
        category.amount -= p;
        specialByCategory.set(leg.category_id!, category);
        specialByAccount.set(leg.account_id, (specialByAccount.get(leg.account_id) ?? 0n) - p);
        break;
      }
      case "RECURRING_EXPENSE":
        totals.recurringExpense -= p;
        break;
      case "OTHER_EXPENSE":
        totals.otherExpense -= p;
        break;
      case "EXTERNAL_MOVEMENT":
        if (leg.classification === "OTHER_GIFT_INCOME") totals.giftIncome += p;
        if (leg.classification === "OWNERSHIP_OUTFLOW") totals.ownershipOutflow -= p;
        break;
      case "PERSONAL_TRANSFER": {
        if (leg.account_id !== reserve) break;
        // Gross saved counts personal components flowing into the reserve, net of their corrections.
        const intoReserve =
          leg.kind === "CORRECTION_POSTING" ? leg.original_reserve_inflow === true : leg.role === "REVERSAL" ? p < 0n : p > 0n;
        if (intoReserve) totals.grossSaved += p;
        break;
      }
    }
  }

  return { totals, specialByCategory, specialByAccount };
}

/** Beranda's month-to-date reserve and special-expense figures, without the full month report. */
export async function monthLedgerSummary(tx: OwnerTx, ownerId: string, month: string) {
  if (!isCycleKey(month)) throw new ApiError("VALIDATION_FAILED", { issues: ["INVALID_MONTH"] });
  const first = `${month}-01`;
  const last = `${month}-${String(lastDayOfCycle(month)).padStart(2, "0")}`;
  const reserve = await reserveAccountId(tx, ownerId);
  const { totals } = await ledgerTotals(tx, ownerId, first, last, reserve, "corrected");
  return {
    month,
    reserve: { accountId: reserve, grossSaved: amount(totals.grossSaved), netGrowth: amount(totals.netReserveGrowth) },
    specialOutflow: amount(totals.specialOutflow),
  };
}

/**
 * Calendar-month report. Events sit on their actual business dates; DANA
 * living expense is allocated with CALENDAR_DAY_PRORATA_V1. The as-settled
 * view ignores every change made to settled history after settlement.
 */
export async function monthReport(tx: OwnerTx, ownerId: string, month: string, view: ReportView, now: Date) {
  if (!isCycleKey(month)) throw new ApiError("VALIDATION_FAILED", { issues: ["INVALID_MONTH"] });
  const first = `${month}-01`;
  const last = `${month}-${String(lastDayOfCycle(month)).padStart(2, "0")}`;
  const today = businessDateOf(now);
  const reserve = await reserveAccountId(tx, ownerId);
  const rule = await dailyRuleFor(tx, ownerId);

  const settledRows = rule
    ? await tx
        .select()
        .from(settlement)
        .where(and(eq(settlement.ownerId, ownerId), eq(settlement.accountId, rule.accountId), eq(settlement.status, "SETTLED")))
        .orderBy(asc(settlement.startDate))
    : [];

  const { totals, specialByCategory, specialByAccount } = await ledgerTotals(tx, ownerId, first, last, reserve, view);

  // Daily income per business date in the month.
  let dailyIncome = 0n;
  if (rule) {
    const context = await dailyRuleContext(tx, ownerId, rule.id);
    const current = dailyIncomeBetween({ amount: rule.amountMinor, startDate: rule.effectiveStartDate }, context.transitions, context.overrides, first, last < today ? last : today);
    const snapshotDays = new Map<string, MinorUnits>();
    if (view === "as_settled") {
      for (const row of settledRows) {
        for (const day of (row.snapshot as { days: { date: string; amount: string }[] }).days) snapshotDays.set(day.date, parseIdrDecimal(day.amount));
      }
    }
    for (const day of current.days) dailyIncome += snapshotDays.get(day.date) ?? day.amount;
  }

  // Living expense: prorata of each settlement touching the month.
  const correctedLiving = view === "as_settled" ? null : await correctedLivingExpenses(tx, ownerId);
  let living = 0n;
  const livingParts: { settlementId: string; startDate: string; endDate: string; allocated: string }[] = [];
  for (const row of settledRows) {
    if (row.endDate < first || row.startDate > last) continue;
    const total = correctedLiving ? (correctedLiving.get(row.id) ?? 0n) : row.livingExpenseMinor!;
    const share = prorataByMonth(total, row.startDate, row.endDate).get(month) ?? 0n;
    living += share;
    livingParts.push({ settlementId: row.id, startDate: row.startDate, endDate: row.endDate, allocated: amount(share) });
  }

  const coverage = rule
    ? monthCompleteness(month, rule.effectiveStartDate, settledRows.map((r) => ({ startDate: r.startDate, endDate: r.endDate })), today)
    : null;

  const totalIncome = dailyIncome + totals.monthlyIncome + totals.otherIncome + totals.giftIncome;
  const actualTotalOutflow = living + totals.specialOutflow + totals.recurringExpense + totals.otherExpense + totals.ownershipOutflow;

  return {
    month,
    view,
    completeness: coverage?.completeness ?? "SEMENTARA",
    coverage,
    income: {
      total: amount(totalIncome),
      daily: amount(dailyIncome),
      monthly: amount(totals.monthlyIncome),
      other: amount(totals.otherIncome),
      gift: amount(totals.giftIncome),
    },
    outflow: {
      actualTotal: amount(actualTotalOutflow),
      /** Estimasi alokasi biaya hidup dari settlement mingguan (≈). */
      living: amount(living),
      livingAllocations: livingParts,
      special: amount(totals.specialOutflow),
      specialByCategory: [...specialByCategory].map(([id, c]) => ({ categoryId: id, name: c.name, amount: amount(c.amount) })),
      specialByAccount: [...specialByAccount].map(([accountId, value]) => ({ accountId, amount: amount(value) })),
      recurring: amount(totals.recurringExpense),
      other: amount(totals.otherExpense),
      ownership: amount(totals.ownershipOutflow),
    },
    reserve: { accountId: reserve, grossSaved: amount(totals.grossSaved), netGrowth: amount(totals.netReserveGrowth) },
    unexplainedAdjustments: amount(totals.adjustments),
  };
}

export type DashboardTask =
  | { type: "SETTLEMENT"; mode: string; periodStart: string; normalEnd: string; draftId: string | null }
  | { type: "CONFIRM_INCOME" | "CONFIRM_OBLIGATION"; cycleKey: string; occurrenceId: string; name: string; label: string | null; expectedAmount: string | null; expectedDate: string | null }
  | { type: "TRANSFER"; targetId: string; route: string; amount: string; linked: string; remaining: string; transferNow: string; contextKey: string }
  | { type: "RECONCILE"; accountId: string; reason: string };

/** DANA card: the open week shows known values only; living cost waits for settlement. */
async function danaCard(tx: OwnerTx, ownerId: string, router: Awaited<ReturnType<typeof settlementRouter>>, today: string) {
  const rule = await dailyRuleFor(tx, ownerId);
  if (!rule) return null;
  // The window count rides on the latest-settlement query, so chart eligibility costs no extra round trip.
  const [latestRow] = await tx
    .select({ row: settlement, total: sql<number>`count(*) over ()`.mapWith(Number) })
    .from(settlement)
    .where(and(eq(settlement.ownerId, ownerId), eq(settlement.accountId, rule.accountId), eq(settlement.status, "SETTLED")))
    .orderBy(sql`${settlement.endDate} desc`)
    .limit(1);
  const completed = latestRow?.row;
  const openFrom = router.mode === "NO_WEEKLY_ACCOUNT" ? null : router.periodStart;
  const incomeToDate = openFrom && openFrom <= today ? await recognizedIncomeFor(tx, ownerId, rule.accountId, openFrom, today, rule) : null;
  let latest = null;
  if (completed) {
    const livingExpense = (await correctedLivingExpenses(tx, ownerId)).get(completed.id) ?? 0n;
    const settlementDays = daysBetweenInclusive(completed.startDate, completed.endDate);
    latest = {
      settlementId: completed.id,
      startDate: completed.startDate,
      endDate: completed.endDate,
      livingExpense: amount(livingExpense),
      averagePerDay: amount(roundedAverage(livingExpense, settlementDays)),
      settlementDays,
      hasCorrections: completed.livingExpenseMinor !== livingExpense,
    };
  }
  const normalEnd = router.mode === "NO_WEEKLY_ACCOUNT" ? null : router.normalEnd;
  const open = openFrom !== null && openFrom <= today;
  return {
    accountId: rule.accountId,
    openWeek: open ? { periodStart: openFrom, recognizedIncomeToDate: amount(incomeToDate?.recognized ?? 0n), livingExpense: null } : null,
    week: open && normalEnd ? { periodStart: openFrom, normalEnd, days: weekStrip({ periodStart: openFrom, normalEnd, today, days: incomeToDate?.days ?? [] }) } : null,
    latestCompleted: latest,
    completedCount: latestRow?.total ?? 0,
  };
}

/** Everything Beranda shows, in the locked reading order (PRD: Dashboard hierarchy). */
export async function dashboard(tx: OwnerTx, ownerId: string, now: Date) {
  const today = businessDateOf(now);
  // Cycles first: they may create the occurrences of a newly started month.
  const cycles = await listMonthlyCycles(tx, ownerId, now);
  // One transaction runs one query at a time (pg would reject overlapping ones), so load in order.
  const overview = await accountsOverview(tx, ownerId, now, { cycles });
  const router = await settlementRouter(tx, ownerId, now);
  const dana = await danaCard(tx, ownerId, router, today);
  const targets = await listTargets(tx, ownerId);
  const month = await monthLedgerSummary(tx, ownerId, cycleKeyOf(today));
  const externalSubjects = await listExternalSubjects(tx, ownerId);
  const confirmedPersonalCash = overview.accounts.reduce((sum, a) => sum + parseIdrDecimal(a.confirmedPersonal), 0n);

  const warnings = overview.accounts.flatMap((a) => {
    const list: { type: string; accountId: string; amount?: string }[] = [];
    if (a.status === "DISCREPANCY") list.push({ type: "DISCREPANCY", accountId: a.id });
    if (parseIdrDecimal(a.shortfall) > 0n) list.push({ type: "EXTERNAL_FUND_SHORTFALL", accountId: a.id, amount: a.shortfall });
    else if (parseIdrDecimal(a.personal) < 0n) list.push({ type: "NEGATIVE_PERSONAL", accountId: a.id, amount: a.personal });
    return list;
  });

  const tasks: DashboardTask[] = [];
  if (router.mode === "NORMAL" || router.mode === "OVERDUE" || router.mode === "DRAFT") {
    tasks.push({ type: "SETTLEMENT", mode: router.mode, periodStart: router.periodStart, normalEnd: router.normalEnd, draftId: router.draftId });
  }
  for (const cycle of [...cycles].reverse()) {
    if (cycle.income?.status === "PENDING") {
      tasks.push({ type: "CONFIRM_INCOME", cycleKey: cycle.cycleKey, occurrenceId: cycle.income.occurrenceId, name: "Income bulanan", label: cycle.income.label, expectedAmount: cycle.income.expectedAmount, expectedDate: null });
    }
    for (const o of cycle.obligations.filter((o) => o.status === "PENDING")) {
      tasks.push({ type: "CONFIRM_OBLIGATION", cycleKey: cycle.cycleKey, occurrenceId: o.occurrenceId, name: o.name, label: o.label, expectedAmount: o.expectedAmount, expectedDate: o.expectedDate });
    }
  }
  const suggestions = await transferSuggestions(tx, ownerId, { balances: overview.accounts, targets });
  for (const target of targets) {
    if (target.version?.isActionable && parseIdrDecimal(target.remaining) > 0n) {
      const suggestion = suggestions.find((s) => s.route.sourceAccountId === target.route.sourceAccountId);
      tasks.push({
        type: "TRANSFER",
        targetId: target.id,
        route: `${target.route.sourceName} → ${target.route.destinationName}`,
        amount: target.version.amount,
        linked: target.linked,
        remaining: target.remaining,
        transferNow: suggestion?.transferNow ?? "0",
        contextKey: target.contextKey,
      });
    }
  }
  for (const prompt of overview.prompts) tasks.push({ type: "RECONCILE", accountId: prompt.accountId, reason: prompt.reason });

  const currentCycle = cycles.find((c) => c.cycleKey === cycleKeyOf(today)) ?? null;
  const latestCompletedCycle = cycles.find((c) => c.cycleKey < cycleKeyOf(today) && (c.state === "COMPLETE" || c.state === "CLOSED_NO_INCOME")) ?? null;
  const external = externalSubjects.filter((s) => s.status === "OPEN");

  return {
    personalCashRecorded: overview.personalCashRecorded,
    confirmedPersonalCash: amount(confirmedPersonalCash),
    danaDisclosure: overview.accounts.some((a) => a.openWeekDisclosure),
    warnings,
    tasks,
    accounts: overview.accounts,
    dana,
    bca: { currentCycle, latestCompletedCycle },
    reserve: { monthToDate: month.reserve, specialOutflowMonthToDate: month.specialOutflow, month: month.month },
    external,
    chart: chartEligibility({
      settlements: dana?.completedCount ?? 0,
      cycles: cycles.filter((c) => c.state === "COMPLETE" || c.state === "CLOSED_NO_INCOME").length,
    }),
  };
}

/** Weekly history for trends (chart eligibility needs at least four completed settlements). */
export async function settlementHistory(tx: OwnerTx, ownerId: string) {
  const rule = await dailyRuleFor(tx, ownerId);
  if (!rule) return [];
  const rows = await tx
    .select()
    .from(settlement)
    .where(and(eq(settlement.ownerId, ownerId), eq(settlement.accountId, rule.accountId), eq(settlement.status, "SETTLED")))
    .orderBy(asc(settlement.startDate));
  const living = await correctedLivingExpenses(tx, ownerId);
  return rows.map((row) => {
    const livingExpense = living.get(row.id) ?? 0n;
    return {
      settlementId: row.id,
      startDate: row.startDate,
      endDate: row.endDate,
      livingExpense: amount(livingExpense),
      averagePerDay: amount(roundedAverage(livingExpense, daysBetweenInclusive(row.startDate, row.endDate))),
    };
  });
}

