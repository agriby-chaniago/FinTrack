import { describe, expect, it } from "vitest";

import { buildExportAnalysis, type AnalysisInputs } from "./export-analysis";
import type { ExportDataset } from "./export";
import type { MonthReport } from "./reports";

const now = new Date("2026-03-05T10:00:00+07:00");
const datasets = (tables: Record<string, Record<string, unknown>[]>): ExportDataset[] => Object.entries(tables).map(([table, rows]) => ({ table, columns: Object.keys(rows[0] ?? {}), rows }));
function report(month = "2026-02", income = "0", outflow = "0", living = "0"): MonthReport {
  return {
    month, view: "corrected", completeness: "LENGKAP",
    coverage: { completeness: "LENGKAP", coveredDays: 28, expectedDays: 28, gaps: [], overlaps: [] },
    income: { total: income, daily: "0", monthly: "0", other: income, gift: "0" },
    outflow: { actualTotal: outflow, living, livingAllocations: [], special: "0", specialByCategory: [], specialByAccount: [], recurring: "0", other: outflow, ownership: "0" },
    reserve: { accountId: "reserve", grossSaved: "0", netGrowth: "0" }, unexplainedAdjustments: "0",
  };
}
const inputs = (reports: MonthReport[] = []): AnalysisInputs => ({ reports, balances: null, living: new Map(), targets: [] });
const entry = (id: string, fields: Record<string, unknown> = {}) => ({ id, kind: "EXPENSE", event_class: "OTHER_EXPENSE", effective_business_date: "2026-02-03", recorded_at: `2026-03-0${id.length}T00:00:00Z`, ...fields });
const leg = (entryId: string, amount: string, fields: Record<string, unknown> = {}) => ({ entry_id: entryId, account_id: "daily", physical_effect_minor: amount, external_effect_minor: "0", holding_id: null, ...fields });

describe("effective analysis export", () => {
  it("exports a twice-revised settlement once, with the final full amount and supporting allocation", () => {
    const r = report("2026-02", "0", "275000", "275000");
    r.outflow.livingAllocations = [{ settlementId: "week", startDate: "2026-02-02", endDate: "2026-02-08", allocated: "275000" }];
    const data = datasets({
      settlement: [{ id: "week", account_id: "daily", start_date: "2026-02-02", end_date: "2026-02-08", status: "SETTLED", living_expense_minor: "30000000", snapshot: { livingExpense: "300000" } }],
      ledger_entry: [entry("a", { event_class: "LIVING", source_type: "SETTLEMENT", source_id: "week" }), entry("bb", { event_class: "LIVING", source_type: "SETTLEMENT", source_id: "week" }), entry("ccc", { event_class: "LIVING", source_type: "SETTLEMENT", source_id: "week" })],
      ledger_leg: [leg("a", "-30000000"), leg("bb", "5000000"), leg("ccc", "-2500000")],
    });
    const projection = buildExportAnalysis(data, now, { ...inputs([r]), living: new Map([["week", 27_500_000n]]) });
    const settlements = projection.rows.filter((row) => row.row_type === "SETTLEMENT");
    expect(settlements).toHaveLength(1);
    expect(settlements[0]).toMatchObject({ value: "275000", status: "EFFECTIVE_CORRECTED", aggregation_role: "SUPPORTING_TOTAL_NOT_ADDITIVE" });
    expect(projection.rows.filter((row) => row.row_type === "EVENT")).toEqual([]);
    expect(projection.rows.filter((row) => row.aggregation_role === "DETAIL_FLOW")).toEqual([expect.objectContaining({ row_type: "SETTLEMENT_ALLOCATION", outflow_effect_idr: "275000" })]);
    expect(projection.failedChecks).toBe(0);
    expect(data.find((d) => d.table === "settlement")!.rows[0].snapshot).toEqual({ livingExpense: "300000" });
  });

  it("collapses settled deltas, open reversal/replacement, and voids without losing exact cents", () => {
    const data = datasets({
      ledger_entry: [entry("a"), entry("bb", { kind: "CORRECTION_POSTING", corrects_entry_id: "a" }), entry("ccc", { kind: "CORRECTION_POSTING", corrects_entry_id: "a" }),
        entry("d"), entry("ee", { corrects_entry_id: "d", correction_role: "REVERSAL" }), entry("fff", { corrects_entry_id: "d", correction_role: "REPLACEMENT" }),
        entry("g"), entry("hh", { corrects_entry_id: "g", correction_role: "REVERSAL" })],
      ledger_leg: [leg("a", "-10000000"), leg("bb", "2000000"), leg("ccc", "-500001"), leg("d", "-2000000"), leg("ee", "2000000"), leg("fff", "-1500000"), leg("g", "-3000000"), leg("hh", "3000000")],
    });
    const projection = buildExportAnalysis(data, now, inputs([report("2026-02", "0", "100000.01")]));
    expect(projection.rows.filter((row) => row.row_type === "EVENT" && row.aggregation_role === "DETAIL_FLOW").map((row) => row.outflow_effect_idr).sort()).toEqual(["15000", "85000.01"]);
    expect(projection.rows.find((row) => row.record_id === "void:g")).toMatchObject({ value: "0", aggregation_role: "CONTEXT_NOT_FLOW" });
    expect(projection.failedChecks).toBe(0);
  });

  it("keeps transfers and entrusted receipts out of income/outflow; applies current zero/null overrides", () => {
    const data = datasets({
      owner_setting: [{ reserve_account_id: "reserve" }],
      ledger_entry: [entry("t", { kind: "TRANSFER", event_class: "PERSONAL_TRANSFER" }), entry("x", { kind: "EXTERNAL_MOVEMENT", event_class: "EXTERNAL_MOVEMENT" })],
      ledger_leg: [leg("t", "-5000000"), leg("t", "5000000", { account_id: "reserve" }), leg("x", "4000000", { external_effect_minor: "4000000", holding_id: "outside" })],
      daily_income_rule: [{ id: "rule", account_id: "daily", effective_start_date: "2026-02-01", amount_minor: "5000000" }],
      daily_income_override: [{ id: "old", rule_id: "rule", business_date: "2026-02-01", amount_minor: "1000000", superseded_by_id: "new" }, { id: "new", rule_id: "rule", business_date: "2026-02-01", amount_minor: "0", superseded_by_id: null }, { id: "reset", rule_id: "rule", business_date: "2026-02-02", amount_minor: null, superseded_by_id: null }],
    });
    const projection = buildExportAnalysis(data, new Date("2026-02-03T12:00:00+07:00"), inputs([report("2026-02", "100000")]));
    const daily = projection.rows.filter((row) => row.row_type === "DAILY_INCOME");
    expect(daily.map((row) => row.income_effect_idr)).toEqual(["0", "50000", "50000"]);
    expect(projection.rows.filter((row) => row.row_type === "EVENT").every((row) => row.income_effect_idr === "0" && row.outflow_effect_idr === "0")).toBe(true);
    expect(projection.rows.find((row) => row.row_type === "OPEN_PERIOD")).toMatchObject({ value: null, aggregation_role: "UNKNOWN_NOT_FLOW" });
    expect(projection.failedChecks).toBe(0);
  });

  it("retains unknown draft values, missing due obligations, and blocks incomplete-month trends", () => {
    const data = datasets({
      settlement: [{ id: "draft", status: "DRAFT", account_id: "daily", start_date: "2026-02-02", end_date: "2026-02-08", living_expense_minor: null }],
      recurring_expense_rule: [{ id: "sub", account_id: "monthly", display_name: "Unknown bill", first_cycle: "2026-02", last_cycle: null }],
      recurring_expense_rule_revision: [{ id: "rev", rule_id: "sub", effective_from_cycle: "2026-02", expected_amount_minor: null, expected_day: null }],
    });
    const projection = buildExportAnalysis(data, now, inputs([report("2026-01"), report()]));
    expect(projection.rows.find((row) => row.row_type === "SETTLEMENT")).toMatchObject({ status: "DRAFT", value: null });
    expect(projection.rows.filter((row) => row.row_type === "OCCURRENCE")).toEqual([expect.objectContaining({ status: "UNMATERIALIZED_PENDING", value: null }), expect.objectContaining({ status: "UNMATERIALIZED_PENDING", value: null })]);
    expect(projection.rows.find((row) => row.record_id === "month:2026-02:eligibility")).toMatchObject({ value: "false" });
    expect(projection.rows.find((row) => row.record_id === "month:2026-02:income.total")).toMatchObject({ status: "SEMENTARA" });
    expect(projection.rows.filter((row) => row.row_type === "COMPARISON")).toHaveLength(0);
  });

  it("keeps the replacement's category when reversal and replacement have the same timestamp", () => {
    const data = datasets({
      special_expense_category: [{ id: "old", display_name: "Old" }, { id: "new", display_name: "New" }],
      ledger_entry: [entry("root", { event_class: "SPECIAL_EXPENSE", category_id: "old" }),
        entry("z-reversal", { event_class: "SPECIAL_EXPENSE", category_id: "old", corrects_entry_id: "root", correction_role: "REVERSAL", recorded_at: "2026-03-04T00:00:00Z" }),
        entry("a-replacement", { event_class: "SPECIAL_EXPENSE", category_id: "new", corrects_entry_id: "root", correction_role: "REPLACEMENT", recorded_at: "2026-03-04T00:00:00Z" })],
      ledger_leg: [leg("root", "-2000000"), leg("z-reversal", "2000000"), leg("a-replacement", "-1500000")],
    });
    const projection = buildExportAnalysis(data, now, inputs([report("2026-02", "0", "15000")]));
    expect(projection.rows.filter((row) => row.row_type === "EVENT")).toEqual([expect.objectContaining({ category: "New", outflow_effect_idr: "15000" })]);
    expect(projection.failedChecks).toBe(0);
  });

  it("splits a cross-month corrected settlement with exact cents and never adds its total twice", () => {
    const feb = report("2026-02", "0", "34285.71", "34285.71");
    const mar = report("2026-03", "0", "205714.29", "205714.29");
    for (const r of [feb, mar]) r.outflow.livingAllocations = [{ settlementId: "week", startDate: "2026-02-28", endDate: "2026-03-06", allocated: r.outflow.living }];
    const data = datasets({ settlement: [{ id: "week", account_id: "daily", start_date: "2026-02-28", end_date: "2026-03-06", status: "SETTLED", living_expense_minor: "30000000" }] });
    const projection = buildExportAnalysis(data, new Date("2026-04-01T00:00:00+07:00"), { ...inputs([feb, mar]), living: new Map([["week", 24_000_000n]]) });
    expect(projection.rows.filter((row) => row.row_type === "SETTLEMENT_ALLOCATION").map((row) => row.outflow_effect_idr)).toEqual(["34285.71", "205714.29"]);
    expect(projection.rows.find((row) => row.row_type === "SETTLEMENT")).toMatchObject({ value: "240000", aggregation_role: "SUPPORTING_TOTAL_NOT_ADDITIVE" });
    expect(projection.failedChecks).toBe(0);
  });

  it("reclassifies a settled expense without depending on the UUID order of its paired postings", () => {
    const data = datasets({
      special_expense_category: [{ id: "old", display_name: "Old" }, { id: "new", display_name: "New" }],
      ledger_entry: [entry("root", { event_class: "SPECIAL_EXPENSE", category_id: "old" }),
        entry("z-old-category", { kind: "CORRECTION_POSTING", event_class: "SPECIAL_EXPENSE", category_id: "old", corrects_entry_id: "root", recorded_at: "2026-03-04T00:00:00Z" }),
        entry("a-new-category", { kind: "CORRECTION_POSTING", event_class: "SPECIAL_EXPENSE", category_id: "new", corrects_entry_id: "root", recorded_at: "2026-03-04T00:00:00Z" })],
      ledger_leg: [leg("root", "-2000000"), leg("z-old-category", "2000000"), leg("a-new-category", "-2000000")],
    });
    const projection = buildExportAnalysis(data, now, inputs([report("2026-02", "0", "20000")]));
    expect(projection.rows.filter((row) => row.row_type === "EVENT")).toEqual([
      expect.objectContaining({ category: "New", outflow_effect_idr: "20000" }),
    ]);
    expect(projection.failedChecks).toBe(0);
  });

  it("keeps distinct record identities for nonzero category effects in an existing correction family", () => {
    const data = datasets({
      special_expense_category: [{ id: "old", display_name: "Old" }, { id: "new", display_name: "New" }],
      ledger_entry: [entry("root", { event_class: "SPECIAL_EXPENSE", category_id: "old" }),
        entry("delta", { kind: "CORRECTION_POSTING", event_class: "SPECIAL_EXPENSE", category_id: "new", corrects_entry_id: "root" })],
      ledger_leg: [leg("root", "-15000000"), leg("delta", "3000000")],
    });
    const projection = buildExportAnalysis(data, now, inputs([report("2026-02", "0", "120000")]));
    const events = projection.rows.filter((row) => row.row_type === "EVENT");
    expect(events).toHaveLength(2);
    expect(new Set(events.map((row) => row.record_id)).size).toBe(2);
    expect(projection.failedChecks).toBe(0);
  });

  it("holds conclusions on mismatched totals while leaving unrelated months available", () => {
    const projection = buildExportAnalysis(datasets({ ledger_entry: [entry("a")], ledger_leg: [leg("a", "-8000000")] }), now, inputs([report("2026-01"), report("2026-02", "0", "90000")]));
    expect(projection.rows.find((row) => row.record_id === "MONTH_outflow:2026-02")).toMatchObject({ status: "FAIL" });
    expect(projection.rows.find((row) => row.record_id === "month:2026-02:outflow.total")).toMatchObject({ status: "HOLD" });
    expect(projection.rows.find((row) => row.record_id === "month:2026-01:outflow.total")).toMatchObject({ status: "LENGKAP" });
    expect(projection.rows.filter((row) => row.row_type === "COMPARISON")).toHaveLength(0);
  });

  it("never treats a month-end onboarding with zero expected settlement days as a complete month", () => {
    const september = report("2026-09");
    september.coverage = { completeness: "LENGKAP", coveredDays: 0, expectedDays: 0, gaps: [], overlaps: [] };
    const projection = buildExportAnalysis(datasets({ onboarding_snapshot: [{ id: "opening", status: "CONFIRMED", cutover_at: "2026-09-30T20:00:00+07:00", superseded_by_id: null }] }), new Date("2026-11-05T00:00:00+07:00"), inputs([september, report("2026-10")]));
    expect(projection.rows.find((row) => row.record_id === "month:2026-09:eligibility")).toMatchObject({ value: "false" });
    expect(projection.rows.find((row) => row.record_id === "month:2026-09:income.total")).toMatchObject({ status: "PERIODE_PARSIAL" });
    expect(projection.rows.filter((row) => row.row_type === "COMPARISON")).toHaveLength(0);
  });

  it("does not round money beyond JavaScript's safe integer range", () => {
    const amount = "90071992547409.93";
    const projection = buildExportAnalysis(datasets({ ledger_entry: [entry("a")], ledger_leg: [leg("a", "-9007199254740993")] }), now, inputs([report("2026-02", "0", amount)]));
    expect(projection.rows.find((row) => row.row_type === "EVENT")).toMatchObject({ outflow_effect_idr: amount });
    expect(projection.failedChecks).toBe(0);
  });
});
