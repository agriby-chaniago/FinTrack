// A corrected, explained projection beside the lossless portability datasets.
// All database reads use the caller's export snapshot; no lazy writes occur.
import { businessDateOf, cycleKeyOf } from "@/lib/business-time";
import { analysisInstructions, type AnalysisRow } from "@/lib/export-contract";
import { parseIdrDecimal, toIdrDecimal } from "@/lib/money";
import type { OwnerTx } from "@/server/db/owner";
import { dailyIncomeBetween, settlementPlan, type RuleState } from "@/server/domain/daily-income";
import { cyclesBetween, expectedDateFor, lastDayOfCycle } from "@/server/domain/monthly";
import { prorataByMonth } from "@/server/domain/reporting";

import type { ExportDataset } from "./export";
import { accountBalances } from "./ledger";
import { addReportLeg, emptyLedgerTotals, monthReports, type MonthReport } from "./reports";
import { correctedLivingExpenses } from "./settlement";
import { listTargets, type TargetView } from "./transfers";

type Row = ExportDataset["rows"][number];
const text = (row: Row, key: string): string => row[key] === null || row[key] === undefined ? "" : String(row[key]);
const minor = (row: Row, key: string): bigint => BigInt(text(row, key) || "0");
const current = (row: Row) => !row.superseded_by_id;
const refs = (table: string, ids: string[]) => [...new Set(ids)].map((id) => `${table}:${id}`).join(" | ");
const tableOf = (datasets: ExportDataset[]) => {
  const tables = new Map(datasets.map((d) => [d.table, d.rows]));
  return (name: string): Row[] => tables.get(name) ?? [];
};

export type AnalysisInputs = {
  reports: MonthReport[];
  balances: Awaited<ReturnType<typeof accountBalances>> | null;
  living: Map<string, bigint>;
  targets: TargetView[];
};

export type AnalysisProjection = { rows: AnalysisRow[]; failedChecks: number; warningChecks: number };

export function exportMonths(datasets: ExportDataset[], now: Date): string[] {
  const table = tableOf(datasets);
  const today = businessDateOf(now);
  const starts = [today];
  for (const row of table("onboarding_snapshot")) {
    if (row.status === "CONFIRMED" && current(row)) starts.push(businessDateOf(new Date(text(row, "cutover_at"))));
  }
  for (const row of table("ledger_entry")) starts.push(text(row, "effective_business_date"));
  for (const row of table("daily_income_rule")) starts.push(text(row, "effective_start_date"));
  return cyclesBetween(cycleKeyOf(starts.filter((date) => date && date <= today).sort()[0]), cycleKeyOf(today));
}

/** Reuses the same corrected projections as the app, with a fixed export clock. */
export async function readExportAnalysis(tx: OwnerTx, ownerId: string, datasets: ExportDataset[], now: Date): Promise<AnalysisProjection> {
  const initialized = tableOf(datasets)("onboarding_snapshot").some((r) => r.status === "CONFIRMED" && current(r));
  if (!initialized) return buildExportAnalysis(datasets, now, { reports: [], balances: null, living: new Map(), targets: [] });
  // Sequential: one pg transaction must never overlap queries.
  const reports = await monthReports(tx, ownerId, exportMonths(datasets, now), "corrected", now);
  const balances = await accountBalances(tx, ownerId, undefined, now);
  const living = await correctedLivingExpenses(tx, ownerId);
  const targets = await listTargets(tx, ownerId);
  return buildExportAnalysis(datasets, now, { reports: [...reports.values()], balances, living, targets });
}

function monetaryMetrics(report: MonthReport): Record<string, string> {
  return {
    "income.total": report.income.total, "income.daily": report.income.daily,
    "income.monthly": report.income.monthly, "income.other": report.income.other, "income.gift": report.income.gift,
    "outflow.total": report.outflow.actualTotal, "outflow.living": report.outflow.living,
    "outflow.special": report.outflow.special, "outflow.recurring": report.outflow.recurring,
    "outflow.other": report.outflow.other, "outflow.ownership": report.outflow.ownership,
    "reserve.gross_saved": report.reserve.grossSaved, "reserve.net_growth": report.reserve.netGrowth,
    "adjustments": report.unexplainedAdjustments,
  };
}

/** Pure assembly makes correction, ownership, and cross-file checks testable. */
export function buildExportAnalysis(datasets: ExportDataset[], now: Date, inputs: AnalysisInputs): AnalysisProjection {
  const table = tableOf(datasets);
  const today = businessDateOf(now);
  const thisMonth = cycleKeyOf(today);
  const rows: AnalysisRow[] = [];
  const snapshot = table("onboarding_snapshot").find((s) => s.status === "CONFIRMED" && current(s));
  const trackingStart = snapshot ? businessDateOf(new Date(text(snapshot, "cutover_at"))) : null;
  // A next-month daily rule has zero expected days in the onboarding month.
  // That vacuous weekly coverage does not make a partial cashflow month full.
  const completenessFor = (report: MonthReport) => report.completeness === "LENGKAP" && trackingStart && cycleKeyOf(trackingStart) === report.month && trackingStart > `${report.month}-01` ? "PERIODE_PARSIAL" : report.completeness;
  const names = new Map(table("account").map((r) => [text(r, "id"), text(r, "display_name")]));
  const categories = new Map(table("special_expense_category").map((r) => [text(r, "id"), text(r, "display_name")]));
  const reserve = text(table("owner_setting")[0] ?? {}, "reserve_account_id");
  const heldMonths = new Set<string>();
  const check = (id: string, status: "PASS" | "FAIL" | "WARN" | "INFO", explanation: string, month = "") => {
    if (status === "FAIL" && month) heldMonths.add(month);
    rows.push({ row_type: "CHECK", aggregation_role: "QUALITY_NOT_FLOW", record_id: id, status, period_start: month && `${month}-01`, explanation });
  };
  const add = (row: AnalysisRow) => rows.push({ ...row, account_name: row.account_name ?? names.get(row.account_id ?? "") ?? "" });
  analysisInstructions.forEach((explanation, i) => add({ row_type: "INSTRUCTION", aggregation_role: "INSTRUCTION_NOT_FLOW", record_id: `instruction:${i + 1}`, explanation }));
  add({ row_type: "METADATA", aggregation_role: "CONTEXT_NOT_FLOW", metric: "business_date", value: today, unit: "DATE", explanation: "Seluruh riwayat sampai snapshot ekspor. Baca READ_ME_FIRST.md dan manifest.json dalam pasangan ZIP." });
  if (!inputs.balances) check("ONBOARDING", "WARN", "Onboarding belum dikonfirmasi. Saldo dan cashflow aktual belum dapat disimpulkan; draft bukan transaksi.");

  // Economic details collapse a correction family, preserving signed effects.
  // An open-period reversal cancels its original; a settled posting is a delta.
  const entries = table("ledger_entry");
  const byId = new Map(entries.map((e) => [text(e, "id"), e]));
  const roots = new Map<string, string>();
  function rootOf(id: string): string {
    if (roots.has(id)) return roots.get(id)!;
    const seen = new Set<string>();
    let cursor = id;
    while (byId.get(cursor)?.corrects_entry_id) {
      if (seen.has(cursor)) {
        check(`CHAIN:${id}`, "FAIL", "Siklus pada rantai koreksi; kesimpulan terkait harus ditahan.", cycleKeyOf(text(byId.get(id)!, "effective_business_date")));
        break;
      }
      seen.add(cursor);
      const parent = text(byId.get(cursor)!, "corrects_entry_id");
      if (!byId.has(parent)) {
        check(`CHAIN:${id}`, "FAIL", "Referensi koreksi tidak tersedia dalam snapshot.", cycleKeyOf(text(byId.get(id)!, "effective_business_date")));
        break;
      }
      cursor = parent;
    }
    roots.set(id, cursor);
    return cursor;
  }
  const familyIds = new Map<string, string[]>();
  for (const e of entries) {
    const root = rootOf(text(e, "id"));
    familyIds.set(root, [...(familyIds.get(root) ?? []), text(e, "id")]);
  }
  const legsByEntry = new Map<string, Row[]>();
  for (const leg of table("ledger_leg")) {
    const id = text(leg, "entry_id");
    legsByEntry.set(id, [...(legsByEntry.get(id) ?? []), leg]);
  }
  type Effect = { root: string; entry: Row; account: string; holding: string; physical: bigint; external: bigint; note: string };
  const effects = new Map<string, Effect>();
  const depths = new Map<string, number>();
  const depthOf = (row: Row) => {
    const id = text(row, "id");
    if (depths.has(id)) return depths.get(id)!;
    const seen = new Set<string>();
    let cursor = row;
    while (cursor.corrects_entry_id && !seen.has(text(cursor, "id"))) {
      seen.add(text(cursor, "id"));
      const parent = byId.get(text(cursor, "corrects_entry_id"));
      if (!parent) break;
      cursor = parent;
    }
    depths.set(id, seen.size);
    return seen.size;
  };
  const roleOrder = (row: Row) => row.correction_role === "REPLACEMENT" ? 2 : row.correction_role === "REVERSAL" ? 1 : 0;
  // Parent before child, and reversal before replacement even when pg gives
  // both the same transaction timestamp. UUID order must not pick old labels.
  for (const entry of [...entries].sort((a, b) => depthOf(a) - depthOf(b) || text(a, "recorded_at").localeCompare(text(b, "recorded_at")) || roleOrder(a) - roleOrder(b) || text(a, "id").localeCompare(text(b, "id")))) {
    if (entry.event_class === "LIVING") continue;
    const root = rootOf(text(entry, "id"));
    for (const leg of legsByEntry.get(text(entry, "id")) ?? []) {
      const key = JSON.stringify([root, entry.effective_business_date, entry.event_class, entry.reporting_classification, leg.account_id, leg.holding_id, entry.category_id]);
      const existing = effects.get(key);
      effects.set(key, {
        root, entry, account: text(leg, "account_id"), holding: text(leg, "holding_id"),
        physical: (existing?.physical ?? 0n) + minor(leg, "physical_effect_minor"),
        external: (existing?.external ?? 0n) + minor(leg, "external_effect_minor"),
        note: entry.correction_role !== "REVERSAL" && entry.note ? text(entry, "note") : existing?.note ?? "",
      });
    }
  }
  const detailByMonth = new Map<string, { income: bigint; outflow: bigint }>();
  const addDetail = (date: string, income: bigint, outflow: bigint) => {
    const month = cycleKeyOf(date);
    const sum = detailByMonth.get(month) ?? { income: 0n, outflow: 0n };
    detailByMonth.set(month, { income: sum.income + income, outflow: sum.outflow + outflow });
  };
  const nonzeroRoots = new Set<string>();
  for (const effect of effects.values()) {
    if (effect.physical === 0n && effect.external === 0n) continue;
    nonzeroRoots.add(effect.root);
    const e = effect.entry;
    const date = text(e, "effective_business_date");
    const personal = effect.physical - effect.external;
    const totals = emptyLedgerTotals();
    const originalReserveInflow = (legsByEntry.get(effect.root) ?? []).filter((l) => l.account_id === reserve).reduce((sum, l) => sum + minor(l, "physical_effect_minor") - minor(l, "external_effect_minor"), 0n) > 0n;
    addReportLeg(totals, {
      month: cycleKeyOf(date), kind: text(e, "kind"), event_class: text(e, "event_class"),
      classification: text(e, "reporting_classification") || null, role: null,
      account_id: effect.account, category_id: text(e, "category_id") || null,
      category_name: categories.get(text(e, "category_id")) ?? null, personal: personal.toString(),
      original_reserve_inflow: originalReserveInflow,
    }, reserve);
    const t = totals.totals;
    const income = t.monthlyIncome + t.otherIncome + t.giftIncome;
    const outflow = t.specialOutflow + t.recurringExpense + t.otherExpense + t.ownershipOutflow;
    addDetail(date, income, outflow);
    add({
      row_type: "EVENT", aggregation_role: "DETAIL_FLOW", record_id: `event:${effect.root}:${effect.account}:${effect.holding}:${date}:${text(e, "event_class")}${e.category_id ? `:${text(e, "category_id")}` : ""}`,
      parent_id: effect.root, metric: text(e, "event_class"), business_date: date,
      account_id: effect.account, category: categories.get(text(e, "category_id")) ?? "",
      status: (familyIds.get(effect.root)?.length ?? 0) > 1 ? "EFFECTIVE_CORRECTED" : "RECORDED",
      unit: "IDR", income_effect_idr: toIdrDecimal(income), outflow_effect_idr: toIdrDecimal(outflow),
      physical_effect_idr: toIdrDecimal(effect.physical), external_effect_idr: toIdrDecimal(effect.external), personal_effect_idr: toIdrDecimal(personal),
      source_refs: refs("ledger_entry", familyIds.get(effect.root) ?? []),
      explanation: `${effect.note}${effect.holding ? ` | holding_id=${effect.holding}` : ""} | Satu efek bersih setelah seluruh reversal/replacement/delta. Transfer dan adjustment tidak menambah income/outflow.`,
    });
  }
  for (const [root, ids] of familyIds) {
    if (!nonzeroRoots.has(root) && byId.get(root)?.event_class !== "LIVING") {
      add({ row_type: "EVENT", aggregation_role: "CONTEXT_NOT_FLOW", record_id: `void:${root}`, parent_id: root, status: "VOID_OR_ZERO_EFFECT", value: "0", unit: "IDR", source_refs: refs("ledger_entry", ids), explanation: "Efek bersih nol; tidak menambah pemasukan/pengeluaran. Riwayat asli tersedia di ZIP." });
    }
  }

  // The same pure daily-income rule used by reports, including zero vs null.
  const dailyByAccount = new Map<string, bigint>();
  for (const rule of table("daily_income_rule")) {
    const id = text(rule, "id");
    const transitions = table("daily_income_state_transition").filter((r) => r.rule_id === id && r.status === "ACTIVE").map((r) => ({ id: text(r, "id"), toState: text(r, "to_state") as RuleState, effectiveDate: text(r, "effective_date") }));
    const overrides = table("daily_income_override").filter((r) => r.rule_id === id && current(r));
    const income = dailyIncomeBetween({ amount: minor(rule, "amount_minor"), startDate: text(rule, "effective_start_date") }, transitions, overrides.map((r) => ({ businessDate: text(r, "business_date"), amount: r.amount_minor === null ? null : minor(r, "amount_minor") })), text(rule, "effective_start_date"), today);
    const account = text(rule, "account_id");
    dailyByAccount.set(account, (dailyByAccount.get(account) ?? 0n) + income.recognized);
    for (const day of income.days) {
      addDetail(day.date, day.amount, 0n);
      const override = overrides.find((r) => r.business_date === day.date);
      add({ row_type: "DAILY_INCOME", aggregation_role: "DETAIL_FLOW", record_id: `daily:${id}:${day.date}`, parent_id: id, metric: "income.daily", business_date: day.date, account_id: account, status: day.state === "ACTIVE" ? "RECOGNIZED_BY_RULE" : day.state, value: toIdrDecimal(day.amount), unit: "IDR", income_effect_idr: toIdrDecimal(day.amount), outflow_effect_idr: "0", source_refs: `daily_income_rule:${id}${override ? ` | daily_income_override:${text(override, "id")}` : ""}`, explanation: day.overridden ? "Override efektif. Override nol = tidak diterima; null mengembalikan nominal default. Nilai snapshot settlement bukan pemasukan tambahan." : "Dihitung dari aturan dan transisi efektif, bukan row ledger atau konfirmasi bank." });
    }
    const completed = table("settlement").filter((r) => r.account_id === account && r.status === "SETTLED").map((r) => text(r, "end_date")).sort().at(-1) ?? null;
    const plan = settlementPlan(text(rule, "effective_start_date"), completed, today);
    if (plan.periodStart <= today) add({ row_type: "OPEN_PERIOD", aggregation_role: "UNKNOWN_NOT_FLOW", record_id: `open:${id}`, period_start: plan.periodStart, period_end: today, account_id: account, metric: "outflow.living", value: null, unit: "IDR", status: plan.status, explanation: `Biaya hidup periode ini belum diketahui sampai settlement. Batas minggu normal ${plan.normalEnd}. Jangan menganggap nilai kosong sebagai nol.` });
  }

  for (const s of table("settlement")) {
    const id = text(s, "id");
    const start = text(s, "start_date");
    const end = text(s, "end_date");
    const settled = s.status === "SETTLED";
    const missing = settled && !inputs.living.has(id) && minor(s, "living_expense_minor") !== 0n;
    const living = settled && !missing ? inputs.living.get(id) ?? 0n : null;
    const sources = entries.filter((e) => e.event_class === "LIVING" && e.source_type === "SETTLEMENT" && e.source_id === id).map((e) => text(e, "id"));
    add({ row_type: "SETTLEMENT", aggregation_role: "SUPPORTING_TOTAL_NOT_ADDITIVE", record_id: `settlement:${id}`, parent_id: id, metric: "outflow.living", period_start: start, period_end: end, account_id: text(s, "account_id"), value: living === null ? null : toIdrDecimal(living), unit: "IDR", status: missing ? "HOLD" : settled ? "EFFECTIVE_CORRECTED" : "DRAFT", source_refs: `settlement:${id} | ${refs("ledger_entry", sources)}`, explanation: "Satu total biaya hidup pool DANA/Tunai sesudah koreksi. Total ini dibagi ke SETTLEMENT_ALLOCATION; jangan menjumlahkan keduanya. snapshot di ZIP adalah as-settled historis." });
    if (missing) {
      for (const month of cyclesBetween(cycleKeyOf(start), cycleKeyOf(end))) check(`SETTLEMENT_POSTINGS:${id}:${month}`, "FAIL", "Settlement memiliki nilai historis nonnol tetapi kontribusi ledger tidak tersedia. Nilai corrected tidak dapat diverifikasi.", month);
    }
    if (living === null) continue;
    if (living < 0n) check(`NEGATIVE_LIVING:${id}`, "WARN", "Biaya hidup hasil rekonstruksi negatif: ada kemungkinan pemasukan yang belum tercatat. Nilai tidak di-clamp.", cycleKeyOf(end));
    const allocations = prorataByMonth(living, start, end);
    for (const [month, amount] of allocations) {
      const report = inputs.reports.find((r) => r.month === month);
      const part = report?.outflow.livingAllocations.find((p) => p.settlementId === id);
      const matches = part !== undefined && parseIdrDecimal(part.allocated) === amount;
      check(`LIVING_ALLOCATION:${id}:${month}`, matches ? "PASS" : "FAIL", matches ? "Alokasi biaya hidup cocok dengan laporan corrected aplikasi." : "Alokasi settlement tidak cocok dengan laporan corrected aplikasi; tahan kesimpulan bulan ini.", month);
      addDetail(`${month}-01`, 0n, amount);
      add({ row_type: "SETTLEMENT_ALLOCATION", aggregation_role: "DETAIL_FLOW", record_id: `living:${id}:${month}`, parent_id: `settlement:${id}`, metric: "outflow.living", period_start: start, period_end: end, business_date: `${month}-01`, account_id: text(s, "account_id"), value: toIdrDecimal(amount), unit: "IDR", income_effect_idr: "0", outflow_effect_idr: toIdrDecimal(amount), status: "ESTIMATED_MONTH_ALLOCATION", source_refs: `settlement:${id}`, explanation: `CALENDAR_DAY_PRORATA_V1 untuk ${month}. business_date adalah kunci bulan alokasi, bukan tanggal pembelian. Jumlah alokasi seluruh bulan tepat sama dengan total settlement.` });
    }
  }

  // Expected occurrences stay planning context. Synthesize missing due rows in
  // memory only, because an export must not materialize a new month's records.
  const pendingByMonth = new Map<string, number>();
  const resolutions = new Map(table("occurrence_resolution").filter(current).map((r) => [`${text(r, "occurrence_type")}:${text(r, "occurrence_id")}`, r]));
  for (const kind of ["MONTHLY_INCOME", "RECURRING_EXPENSE"] as const) {
    const income = kind === "MONTHLY_INCOME";
    const ruleTable = income ? "monthly_income_rule" : "recurring_expense_rule";
    const occurrenceTable = income ? "monthly_income_occurrence" : "recurring_expense_occurrence";
    const occurrences = new Map(table(occurrenceTable).map((r) => [`${text(r, "rule_id")}:${text(r, "cycle_key")}`, r]));
    for (const rule of table(ruleTable)) {
      const id = text(rule, "id");
      const first = text(rule, income ? "first_expected_cycle" : "first_cycle");
      const last = text(rule, income ? "last_expected_cycle" : "last_cycle");
      if (first > thisMonth) continue;
      const revisions = table("recurring_expense_rule_revision").filter((r) => r.rule_id === id && current(r)).sort((a, b) => text(b, "effective_from_cycle").localeCompare(text(a, "effective_from_cycle")));
      for (const cycle of cyclesBetween(first, last && last < thisMonth ? last : thisMonth)) {
        const occurrence = occurrences.get(`${id}:${cycle}`);
        const revision = revisions.find((r) => text(r, "effective_from_cycle") <= cycle);
        const resolution = occurrence && resolutions.get(`${kind}:${text(occurrence, "id")}`);
        const status = resolution ? text(resolution, "outcome") : occurrence ? "PENDING" : "UNMATERIALIZED_PENDING";
        if (!resolution) pendingByMonth.set(cycle, (pendingByMonth.get(cycle) ?? 0) + 1);
        const expected = occurrence ? occurrence.expected_amount_minor : income ? rule.expected_amount_minor : revision?.expected_amount_minor;
        const day = occurrence ? occurrence.expected_day : revision?.expected_day;
        add({ row_type: "OCCURRENCE", aggregation_role: "PLAN_NOT_FLOW", record_id: `${kind}:${occurrence ? text(occurrence, "id") : `${id}:${cycle}`}`, parent_id: resolution ? text(resolution, "entry_id") : null, metric: income ? "expected.income" : "expected.obligation", period_start: `${cycle}-01`, period_end: expectedDateFor(cycle, day === null || day === undefined ? null : Number(day)) ?? null, account_id: text(rule, "account_id"), category: income ? "Income bulanan" : text(rule, "display_name"), status, value: expected === null || expected === undefined ? null : toIdrDecimal(BigInt(String(expected))), unit: "IDR", source_refs: `${ruleTable}:${id}${occurrence ? ` | ${occurrenceTable}:${text(occurrence, "id")}` : ""}${resolution ? ` | occurrence_resolution:${text(resolution, "id")}` : ""}`, explanation: "value adalah PERKIRAAN, bukan aktual dan tidak menambah cashflow. Aktual efektif hanya dihitung melalui EVENT. Ketiadaan resolution berarti belum diselesaikan; bukan nol. UNMATERIALIZED_PENDING dihitung di memori tanpa menulis database." });
      }
    }
  }

  for (const report of inputs.reports) {
    const detail = detailByMonth.get(report.month) ?? { income: 0n, outflow: 0n };
    for (const [metric, actual, expected] of [["income", detail.income, report.income.total], ["outflow", detail.outflow, report.outflow.actualTotal]] as const) {
      check(`MONTH_${metric}:${report.month}`, actual === parseIdrDecimal(expected) ? "PASS" : "FAIL", `Rincian efektif ${metric}=${toIdrDecimal(actual)} IDR; laporan aplikasi=${expected} IDR. Ringkasan dan rincian adalah representasi angka yang sama.`, report.month);
    }
    if (report.coverage?.gaps.length || report.coverage?.overlaps.length) check(`COVERAGE:${report.month}`, "FAIL", `Coverage tidak konsisten: gaps=${report.coverage.gaps.join(";")}, overlaps=${report.coverage.overlaps.join(";")}.`, report.month);
    const pending = pendingByMonth.get(report.month) ?? 0;
    const completeness = completenessFor(report);
    const eligible = report.month < thisMonth && completeness === "LENGKAP" && pending === 0 && !heldMonths.has(report.month);
    for (const [metric, value] of Object.entries(monetaryMetrics(report))) add({ row_type: "MONTH_METRIC", aggregation_role: "AUTHORITATIVE_TOTAL_NOT_ADDITIVE", record_id: `month:${report.month}:${metric}`, metric, period_start: `${report.month}-01`, period_end: report.month === thisMonth ? today : `${report.month}-${lastDayOfCycle(report.month)}`, value, unit: "IDR", status: heldMonths.has(report.month) ? "HOLD" : pending > 0 ? "SEMENTARA" : completeness, source_refs: "application:monthReports(corrected)", explanation: `Angka resmi corrected. Bagian income.* menjelaskan income.total; outflow.* menjelaskan outflow.total. Jangan jumlahkan total dengan komponennya. Coverage settlement=${report.coverage?.coveredDays ?? "unknown"}/${report.coverage?.expectedDays ?? "unknown"} hari; occurrence unresolved=${pending}; pencatatan dimulai=${trackingStart ?? "unknown"}. ${metric === "outflow.living" ? "Estimasi alokasi dari settlement, bukan rincian pembelian." : ""}` });
    add({ row_type: "MONTH_STATUS", aggregation_role: "CONTEXT_NOT_FLOW", record_id: `month:${report.month}:eligibility`, metric: "trend_eligible", period_start: `${report.month}-01`, value: String(eligible), unit: "BOOLEAN", status: eligible ? "TREND_ELIGIBLE" : "NOT_COMPARABLE", explanation: `Bulan harus sudah berakhir, pencatatan sebulan penuh dan coverage LENGKAP, tanpa occurrence unresolved atau CHECK FAIL. Status coverage aplikasi=${report.completeness}; cakupan ekspor=${completeness}; pencatatan dimulai=${trackingStart ?? "unknown"}; pending=${pending}.` });
    if (completeness !== "LENGKAP" || pending > 0 || report.month === thisMonth) check(`INCOMPLETE:${report.month}`, "WARN", "Periode belum memenuhi syarat perbandingan bulan penuh; jangan menyebutnya lebih hemat/lebih boros dari bulan lengkap.", report.month);
  }
  const reports = [...inputs.reports].sort((a, b) => a.month.localeCompare(b.month));
  for (let i = 1; i < reports.length; i++) {
    const previous = reports[i - 1];
    const latest = reports[i];
    const eligible = [previous, latest].every((r) => r.month < thisMonth && completenessFor(r) === "LENGKAP" && !pendingByMonth.get(r.month) && !heldMonths.has(r.month));
    if (!eligible) continue;
    for (const metric of ["income.total", "outflow.total", "reserve.net_growth"]) add({ row_type: "COMPARISON", aggregation_role: "COMPARISON_NOT_FLOW", record_id: `delta:${previous.month}:${latest.month}:${metric}`, metric, period_start: `${previous.month}-01`, period_end: `${latest.month}-01`, value: toIdrDecimal(parseIdrDecimal(monetaryMetrics(latest)[metric]) - parseIdrDecimal(monetaryMetrics(previous)[metric])), unit: "IDR", status: "COMPARABLE_COMPLETE_MONTHS", explanation: `Selisih ${latest.month} dikurangi ${previous.month}; kedua bulan lengkap dan sudah berakhir. Selisih bukan transaksi tambahan. Penyebab tetap memerlukan bukti rincian.` });
  }

  // Independent replay of the exported inputs versus the app's balance view.
  const opening = table("opening_account_position").filter((r) => r.snapshot_id === snapshot?.id);
  const openingExternal = table("opening_external_position").filter((r) => r.snapshot_id === snapshot?.id);
  for (const balance of inputs.balances?.accounts ?? []) {
    const account = balance.id;
    const physical = [...opening, ...table("account_activation_position")].filter((r) => r.account_id === account).reduce((sum, r) => sum + minor(r, "physical_balance_minor"), 0n)
      + table("ledger_leg").filter((r) => r.account_id === account).reduce((sum, r) => sum + minor(r, "physical_effect_minor"), 0n) + (dailyByAccount.get(account) ?? 0n);
    const external = openingExternal.filter((r) => r.account_id === account).reduce((sum, r) => sum + minor(r, "amount_minor"), 0n)
      + table("ledger_leg").filter((r) => r.account_id === account).reduce((sum, r) => sum + minor(r, "external_effect_minor"), 0n);
    const matches = physical === parseIdrDecimal(balance.physical) && external === parseIdrDecimal(balance.external) && physical - external === parseIdrDecimal(balance.personal);
    check(`BALANCE:${account}`, matches ? "PASS" : "FAIL", `Replay data ZIP: physical=${toIdrDecimal(physical)}, external=${toIdrDecimal(external)}, personal=${toIdrDecimal(physical - external)} IDR; aplikasi: physical=${balance.physical}, external=${balance.external}, personal=${balance.personal} IDR.`);
    for (const [metric, value] of [["balance.physical", balance.physical], ["balance.external", balance.external], ["balance.personal", balance.personal], ["balance.confirmed_personal", balance.confirmedPersonal]] as const) add({ row_type: "ACCOUNT", aggregation_role: "BALANCE_NOT_FLOW", record_id: `account:${account}:${metric}`, metric, account_id: account, value, unit: "IDR", status: matches ? balance.status : "HOLD", source_refs: "application:accountBalances", explanation: `Saldo tercatat; bukan saldo bank realtime. Terakhir dikonfirmasi ${balance.lastConfirmedAt}. ${balance.openWeekDisclosure ? "Minggu berjalan: biaya hidup belum direkonstruksi." : ""}` });
    if (balance.openWeekDisclosure || ["DISCREPANCY", "NEEDS_REVIEW"].includes(balance.status)) check(`FRESHNESS:${account}`, "WARN", `${balance.displayName}: ${balance.status}; terakhir dikonfirmasi ${balance.lastConfirmedAt}. Jangan mengklaim saldo realtime.`);
    if (parseIdrDecimal(balance.personal) < 0n) check(`NEGATIVE_PERSONAL:${account}`, "WARN", `${balance.displayName} memiliki posisi personal negatif; periksa saldo fisik dan dana titipan.`);
  }
  const subjects = new Map(table("external_subject").map((r) => [text(r, "id"), text(r, "display_name")]));
  const holdings = new Map(table("external_holding").map((r) => [text(r, "id"), subjects.get(text(r, "subject_id")) ?? ""]));
  const positions = new Map<string, bigint>();
  for (const r of openingExternal) {
    const key = `${text(r, "account_id")}|${text(r, "holding_id")}`;
    positions.set(key, (positions.get(key) ?? 0n) + minor(r, "amount_minor"));
  }
  for (const leg of table("ledger_leg")) {
    if (!leg.holding_id) continue;
    const key = `${text(leg, "account_id")}|${text(leg, "holding_id")}`;
    positions.set(key, (positions.get(key) ?? 0n) + minor(leg, "external_effect_minor"));
  }
  for (const [key, position] of positions) {
    const [account, holding] = key.split("|");
    add({ row_type: "EXTERNAL_POSITION", aggregation_role: "BALANCE_NOT_FLOW", record_id: `external:${key}`, account_id: account, category: holdings.get(holding), metric: "external.outstanding", value: toIdrDecimal(position), unit: "IDR", status: position < 0n ? "HOLD" : "CALCULATED", source_refs: `external_holding:${holding}`, explanation: "Saldo dana titipan per pihak/account. Bagian dari balance.external, bukan tambahan pada saldo atau pemasukan pribadi." });
    if (position < 0n) check(`NEGATIVE_HOLDING:${key}`, "FAIL", "Posisi dana titipan negatif; jangan simpulkan posisi pihak ini valid.");
  }
  for (const target of inputs.targets) {
    for (const [metric, value] of [["target.suggested", target.version?.amount ?? null], ["target.fulfilled", target.linked], ["target.remaining", target.remaining]] as const) add({ row_type: "TARGET", aggregation_role: "PLAN_NOT_FLOW", record_id: `${target.id}:${metric}`, parent_id: target.id, metric, business_date: target.contextOrder, account_id: target.route.sourceAccountId, value, unit: "IDR", status: target.progress, source_refs: `transfer_target:${target.id}${target.version ? ` | transfer_target_version:${target.version.id}` : ""}`, explanation: `Tujuan ${target.route.destinationName}. Versi efektif saja; fulfillment menggunakan jumlah alokasi bertanda. Target/alokasi bukan transfer atau pengeluaran baru. Retirement=${target.version?.retirementReason ?? "none"}.` });
  }
  check("CORRECTION_HISTORY", "INFO", `${entries.filter((e) => e.corrects_entry_id).length} entry koreksi/reversal/replacement telah digabung dalam efek efektif. Histori tetap tersedia di ZIP. Ini pemeriksaan proyeksi internal, bukan bukti bahwa AI sudah memeriksa arsip.`);
  const failedChecks = rows.filter((r) => r.row_type === "CHECK" && r.status === "FAIL").length;
  const warningChecks = rows.filter((r) => r.row_type === "CHECK" && r.status === "WARN").length;
  add({ row_type: "METADATA", aggregation_role: "CONTEXT_NOT_FLOW", metric: "internal_failed_checks", value: String(failedChecks), unit: "COUNT", status: failedChecks ? "HOLD_AFFECTED_SECTIONS" : "PASS", explanation: "Jumlah pemeriksaan proyeksi internal yang gagal. Lihat CHECK terkait; ini bukan hasil verifikasi bank atau pemeriksaan oleh AI." });
  add({ row_type: "METADATA", aggregation_role: "CONTEXT_NOT_FLOW", metric: "internal_warning_checks", value: String(warningChecks), unit: "COUNT", status: warningChecks ? "WARN" : "PASS", explanation: "Peringatan kelengkapan, freshness, dan keterbatasan data tetap perlu dibahas." });
  add({ row_type: "METADATA", aggregation_role: "CONTEXT_NOT_FLOW", metric: "ai_upload_verified", value: "false", unit: "BOOLEAN", explanation: "Pembuatan file ini tidak membuktikan respons otomatis AI tanpa prompt. Nyatakan sendiri file yang dibaca dan pemeriksaan yang benar-benar Anda lakukan." });
  const priority: Record<string, number> = { INSTRUCTION: 0, METADATA: 1, ACCOUNT: 2, MONTH_METRIC: 3, MONTH_STATUS: 4, COMPARISON: 5, CHECK: 6, OPEN_PERIOD: 7, OCCURRENCE: 8, TARGET: 9, EXTERNAL_POSITION: 10, SETTLEMENT: 11 };
  const severity: Record<string, number> = { FAIL: 0, WARN: 1, INFO: 2, PASS: 3 };
  rows.sort((a, b) => {
    const section = (priority[a.row_type ?? ""] ?? 12) - (priority[b.row_type ?? ""] ?? 12);
    if (section) return section;
    if (a.row_type === "CHECK") return (severity[a.status ?? ""] ?? 4) - (severity[b.status ?? ""] ?? 4);
    // Put the latest summary first even when an AI previews only a CSV prefix.
    if (["MONTH_METRIC", "MONTH_STATUS", "COMPARISON", "OCCURRENCE", "SETTLEMENT"].includes(a.row_type ?? "")) return (b.period_start ?? "").localeCompare(a.period_start ?? "");
    return 0;
  });
  return { rows, failedChecks, warningChecks };
}
