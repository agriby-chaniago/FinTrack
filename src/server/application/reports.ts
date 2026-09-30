// Reporting projections (PRD: Metrics dan perhitungan, Calendar-month
// reporting, Dashboard hierarchy). Nothing here writes financial data.
import { and, asc, eq, sql } from "drizzle-orm";

import { businessDateOf, cycleKeyOf, isCycleKey } from "@/lib/business-time";
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
import { correctedComputation, settlementRouter } from "./settlement";
import { listTargets, reserveAccountId, transferSuggestions } from "./transfers";

export type ReportView = "corrected" | "as_settled";

const amount = (value: MinorUnits) => toIdrDecimal(value);

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

  // As-settled: drop settled-history corrections and records added to a settled range after its settlement.
  const asSettledFilter =
    view === "as_settled"
      ? sql`and e.kind <> 'CORRECTION_POSTING' and not exists (
          select 1 from fintrack.settlement s
          where s.owner_id = ${ownerId} and s.status = 'SETTLED' and s.account_id = l.account_id
            and e.effective_business_date between s.start_date and s.end_date and e.recorded_at > s.settled_at)`
      : sql``;

  const legs = await tx.execute<{
    kind: string;
    event_class: string;
    classification: string | null;
    role: string | null;
    account_id: string;
    category_id: string | null;
    category_name: string | null;
    personal: string;
    original_reserve_inflow: boolean | null;
  }>(sql`
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
  let living = 0n;
  const livingParts: { settlementId: string; startDate: string; endDate: string; allocated: string }[] = [];
  for (const row of settledRows) {
    if (row.endDate < first || row.startDate > last) continue;
    const total =
      view === "as_settled" ? row.livingExpenseMinor! : (await correctedComputation(tx, ownerId, row)).reconstruction.livingExpense;
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
  | { type: "TRANSFER"; targetId: string; route: string; remaining: string; transferNow: string; contextKey: string }
  | { type: "RECONCILE"; accountId: string; reason: string };

/** Everything Beranda shows, in the locked reading order (PRD: Dashboard hierarchy). */
export async function dashboard(tx: OwnerTx, ownerId: string, now: Date) {
  const today = businessDateOf(now);
  const overview = await accountsOverview(tx, ownerId, now);
  const confirmedPersonalCash = overview.accounts.reduce((sum, a) => sum + parseIdrDecimal(a.confirmedPersonal), 0n);

  const warnings = overview.accounts.flatMap((a) => {
    const list: { type: string; accountId: string; amount?: string }[] = [];
    if (a.status === "DISCREPANCY") list.push({ type: "DISCREPANCY", accountId: a.id });
    if (parseIdrDecimal(a.shortfall) > 0n) list.push({ type: "EXTERNAL_FUND_SHORTFALL", accountId: a.id, amount: a.shortfall });
    else if (parseIdrDecimal(a.personal) < 0n) list.push({ type: "NEGATIVE_PERSONAL", accountId: a.id, amount: a.personal });
    return list;
  });

  const tasks: DashboardTask[] = [];
  const router = await settlementRouter(tx, ownerId, now);
  if (router.mode === "NORMAL" || router.mode === "OVERDUE" || router.mode === "DRAFT") {
    tasks.push({ type: "SETTLEMENT", mode: router.mode, periodStart: router.periodStart, normalEnd: router.normalEnd, draftId: router.draftId });
  }
  const cycles = await listMonthlyCycles(tx, ownerId, now);
  for (const cycle of [...cycles].reverse()) {
    if (cycle.income?.status === "PENDING") {
      tasks.push({ type: "CONFIRM_INCOME", cycleKey: cycle.cycleKey, occurrenceId: cycle.income.occurrenceId, name: "Income bulanan", label: cycle.income.label, expectedAmount: cycle.income.expectedAmount, expectedDate: null });
    }
    for (const o of cycle.obligations.filter((o) => o.status === "PENDING")) {
      tasks.push({ type: "CONFIRM_OBLIGATION", cycleKey: cycle.cycleKey, occurrenceId: o.occurrenceId, name: o.name, label: o.label, expectedAmount: o.expectedAmount, expectedDate: o.expectedDate });
    }
  }
  const suggestions = await transferSuggestions(tx, ownerId);
  for (const target of await listTargets(tx, ownerId)) {
    if (target.version?.isActionable && parseIdrDecimal(target.remaining) > 0n) {
      const suggestion = suggestions.find((s) => s.route.sourceAccountId === target.route.sourceAccountId);
      tasks.push({
        type: "TRANSFER",
        targetId: target.id,
        route: `${target.route.sourceName} → ${target.route.destinationName}`,
        remaining: target.remaining,
        transferNow: suggestion?.transferNow ?? "0",
        contextKey: target.contextKey,
      });
    }
  }
  for (const prompt of overview.prompts) tasks.push({ type: "RECONCILE", accountId: prompt.accountId, reason: prompt.reason });

  // DANA: the open week shows known values only; living cost waits for settlement.
  let dana: unknown = null;
  const rule = await dailyRuleFor(tx, ownerId);
  if (rule) {
    const completed = await tx
      .select()
      .from(settlement)
      .where(and(eq(settlement.ownerId, ownerId), eq(settlement.accountId, rule.accountId), eq(settlement.status, "SETTLED")))
      .orderBy(sql`${settlement.endDate} desc`)
      .limit(1);
    const openFrom = router.mode === "NO_WEEKLY_ACCOUNT" ? null : router.periodStart;
    const incomeToDate = openFrom && openFrom <= today ? await recognizedIncomeFor(tx, ownerId, rule.accountId, openFrom, today) : null;
    let latest = null;
    if (completed[0]) {
      const corrected = (await correctedComputation(tx, ownerId, completed[0])).reconstruction;
      latest = {
        settlementId: completed[0].id,
        startDate: completed[0].startDate,
        endDate: completed[0].endDate,
        livingExpense: amount(corrected.livingExpense),
        averagePerDay: amount(corrected.averagePerDay),
        settlementDays: corrected.settlementDays,
        hasCorrections: completed[0].livingExpenseMinor !== corrected.livingExpense,
      };
    }
    dana = {
      accountId: rule.accountId,
      openWeek: openFrom && openFrom <= today ? { periodStart: openFrom, recognizedIncomeToDate: amount(incomeToDate?.recognized ?? 0n), livingExpense: null } : null,
      latestCompleted: latest,
    };
  }

  const currentCycle = cycles.find((c) => c.cycleKey === cycleKeyOf(today)) ?? null;
  const latestCompletedCycle = cycles.find((c) => c.cycleKey < cycleKeyOf(today) && (c.state === "COMPLETE" || c.state === "CLOSED_NO_INCOME")) ?? null;
  const month = await monthReport(tx, ownerId, cycleKeyOf(today), "corrected", now);
  const external = (await listExternalSubjects(tx, ownerId)).filter((s) => s.status === "OPEN");

  return {
    personalCashRecorded: overview.personalCashRecorded,
    confirmedPersonalCash: amount(confirmedPersonalCash),
    danaDisclosure: overview.accounts.some((a) => a.openWeekDisclosure),
    warnings,
    tasks,
    accounts: overview.accounts,
    dana,
    bca: { currentCycle, latestCompletedCycle },
    reserve: { monthToDate: month.reserve, specialOutflowMonthToDate: month.outflow.special, month: month.month },
    external,
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
  const history = [];
  for (const row of rows) {
    const corrected = (await correctedComputation(tx, ownerId, row)).reconstruction;
    history.push({
      settlementId: row.id,
      startDate: row.startDate,
      endDate: row.endDate,
      livingExpense: amount(corrected.livingExpense),
      averagePerDay: amount(roundedAverage(corrected.livingExpense, daysBetweenInclusive(row.startDate, row.endDate))),
    });
  }
  return history;
}

