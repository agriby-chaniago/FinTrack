// Owner-initiated export (PRD: Export data milik pengguna). One consistent
// read-only snapshot becomes a ZIP with versioned `fintrack.json`, one CSV per
// dataset, and `manifest.json` with SHA-256 checksums. Nothing is stored.
import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { strToU8, Zip, ZipDeflate } from "fflate";

import type { OwnerTx } from "@/server/db/owner";

export const EXPORT_FORMAT_VERSION = 1;

/**
 * Coverage registry (migration map M12): every base table in schema
 * `fintrack` is either exported, in dependency order, or excluded with a
 * reason. A test fails when a new table is not classified here.
 */
export const exportedTables = [
  { table: "owner_setting", orderBy: "owner_id" },
  { table: "account", orderBy: "sort_order, id" },
  { table: "account_activation_position", orderBy: "created_at, id" },
  { table: "monthly_account_setting", orderBy: "account_id" },
  { table: "special_expense_category", orderBy: "created_at, id" },
  { table: "external_subject", orderBy: "created_at, id" },
  { table: "external_holding", orderBy: "created_at, id" },
  { table: "onboarding_snapshot", orderBy: "created_at, id" },
  { table: "opening_account_position", orderBy: "snapshot_id, account_id" },
  { table: "opening_external_position", orderBy: "snapshot_id, account_id, holding_id" },
  { table: "daily_income_rule", orderBy: "created_at, id" },
  { table: "daily_income_state_transition", orderBy: "created_at, id" },
  { table: "daily_income_override", orderBy: "recorded_at, id" },
  { table: "monthly_income_rule", orderBy: "created_at, id" },
  { table: "monthly_income_occurrence", orderBy: "cycle_key, id" },
  { table: "recurring_expense_rule", orderBy: "created_at, id" },
  { table: "recurring_expense_rule_revision", orderBy: "created_at, id" },
  { table: "recurring_expense_occurrence", orderBy: "cycle_key, id" },
  { table: "ledger_entry", orderBy: "recorded_at, id" },
  { table: "ledger_leg", orderBy: "entry_id, id" },
  { table: "occurrence_resolution", orderBy: "recorded_at, id" },
  { table: "balance_confirmation", orderBy: "recorded_at, id" },
  { table: "settlement", orderBy: "start_date, id" },
  { table: "transfer_target", orderBy: "context_order, id" },
  { table: "transfer_target_version", orderBy: "created_at, id" },
  { table: "transfer_allocation", orderBy: "created_at, id" },
] as const;

export const excludedTables: Record<string, string> = {
  app_owner: "Supabase Auth UUID binding; identity data never leaves the database (PRD).",
  idempotency_record: "Short-lived API replay cache; it only repeats responses already reflected in the ledger.",
};

type Row = Record<string, unknown>;
export type ExportDataset = { table: string; columns: string[]; rows: Row[] };

/** Reads every exported table for the owner inside the caller's transaction. */
export async function readExportSnapshot(tx: OwnerTx, ownerId: string): Promise<ExportDataset[]> {
  const columnRows = await tx.execute<{ table_name: string; column_name: string }>(sql`
    select table_name, column_name from information_schema.columns
    where table_schema = 'fintrack' order by table_name, ordinal_position`);
  const datasets: ExportDataset[] = [];
  for (const { table, orderBy } of exportedTables) {
    // Minor-unit amounts become exact decimal strings; jsonb keeps numeric precision.
    const rows = await tx.execute<{ row: Row }>(sql`
      select (select jsonb_object_agg(key, case when key like '%\_minor' and jsonb_typeof(value) = 'number'
                                             then to_jsonb(value #>> '{}') else value end)
              from jsonb_each(to_jsonb(t))) as row
      from ${sql.identifier("fintrack")}.${sql.identifier(table)} t
      where t.owner_id = ${ownerId}
      order by ${sql.raw(orderBy)}`);
    datasets.push({
      table,
      columns: columnRows.filter((c) => c.table_name === table).map((c) => c.column_name),
      rows: rows.map((r) => r.row),
    });
  }
  return datasets;
}

const needsQuoting = /[",\r\n]/;
// Spreadsheet formula guard for text cells; numbers such as "-2500000" stay intact.
const formulaStart = /^[=+@\t\r]/;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (typeof value === "string" && formulaStart.test(text)) text = `'${text}`;
  return needsQuoting.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(dataset: ExportDataset): string {
  const lines = [dataset.columns.join(",")];
  for (const row of dataset.rows) lines.push(dataset.columns.map((column) => csvCell(row[column])).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

export type ExportFile = { path: string; content: Uint8Array };

/** Builds the archive entries: data files first, then the manifest describing them. */
export function exportFiles(datasets: ExportDataset[], exportedAt: Date): ExportFile[] {
  const files: ExportFile[] = [];
  const json = {
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: exportedAt.toISOString(),
    datasets: Object.fromEntries(datasets.map((d) => [d.table, d.rows])),
  };
  files.push({ path: "fintrack.json", content: strToU8(`${JSON.stringify(json, null, 2)}\n`) });
  for (const dataset of datasets) files.push({ path: `csv/${dataset.table}.csv`, content: strToU8(toCsv(dataset)) });

  const manifest = {
    formatVersion: EXPORT_FORMAT_VERSION,
    application: "FinTrack",
    exportedAt: exportedAt.toISOString(),
    snapshot: "Single PostgreSQL REPEATABLE READ, READ ONLY transaction",
    conventions: {
      amounts: "Columns ending in _minor are exact integer strings in minor units (1/100 IDR).",
      businessDates: "Date-only values are YYYY-MM-DD business dates in Asia/Jakarta.",
      timestamps: "ISO 8601 with offset.",
      externalOwnership: "ledger_leg.external_effect_minor and holding_id keep external-fund ownership explicit; personal = physical − external.",
      csv: "RFC 4180, UTF-8, CRLF. Text cells starting with = + @ are prefixed with ' for spreadsheet safety; fintrack.json is exact.",
    },
    excluded: excludedTables,
    datasets: datasets.map((d) => ({ name: d.table, rows: d.rows.length, csv: `csv/${d.table}.csv` })),
    files: files.map((file) => ({ path: file.path, bytes: file.content.byteLength, sha256: createHash("sha256").update(file.content).digest("hex") })),
  };
  files.push({ path: "manifest.json", content: strToU8(`${JSON.stringify(manifest, null, 2)}\n`) });
  return files;
}

/** Streams the ZIP to the client; the archive is never written to disk or object storage. */
export function zipStream(files: ExportFile[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const zip = new Zip((error, chunk, final) => {
        if (error) {
          controller.error(error);
          return;
        }
        controller.enqueue(chunk);
        if (final) controller.close();
      });
      for (const file of files) {
        const entry = new ZipDeflate(file.path, { level: 6 });
        zip.add(entry);
        entry.push(file.content, true);
      }
      zip.end();
    },
  });
}

export function exportFileName(exportedAt: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(exportedAt)
      .map((part) => [part.type, part.value]),
  );
  return `fintrack-export-${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}.zip`;
}
