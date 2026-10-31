import { createHash } from "node:crypto";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { exportedTables, exportFileName, exportFiles, toCsv, zipStream } from "./export";
import { datasetMeanings } from "./export-guide";
import { buildExportAnalysis } from "./export-analysis";
import { analysisFromArchive } from "@/lib/export-download";
import { ANALYSIS_CSV_PATH, EXPORT_FORMAT_VERSION } from "@/lib/export-contract";

const dataset = {
  table: "ledger_entry",
  columns: ["id", "note", "amount_minor", "basis"],
  rows: [
    { id: "a", note: 'kopi, "susu"\nlagi', amount_minor: "-2500000", basis: { x: 1 } },
    { id: "b", note: "=HYPERLINK(1)", amount_minor: "100", basis: null },
  ],
};

describe("export CSV", () => {
  it("quotes RFC 4180 cells, keeps negative amounts, and guards formula text", () => {
    expect(toCsv(dataset)).toBe(
      'id,note,amount_minor,basis\r\na,"kopi, ""susu""\nlagi",-2500000,"{""x"":1}"\r\nb,\'=HYPERLINK(1),100,\r\n',
    );
  });

  it("writes a header even when a table is empty", () => {
    expect(toCsv({ ...dataset, rows: [] })).toBe("id,note,amount_minor,basis\r\n");
  });
});

describe("export archive", () => {
  it("documents every raw dataset so new tables cannot silently lack accounting context", () => {
    expect(Object.keys(datasetMeanings).sort()).toEqual(exportedTables.map((table) => table.table).sort());
  });
  it("names the file in Asia/Jakarta time", () => {
    expect(exportFileName(new Date("2027-02-07T17:30:00Z"))).toBe("fintrack-export-20270208-0030.zip");
  });

  it("streams a ZIP whose manifest checksums match every file", async () => {
    const now = new Date("2027-02-07T17:30:00Z");
    const analysis = buildExportAnalysis([], now, { reports: [], balances: null, targets: [], living: new Map() });
    const files = exportFiles([dataset], now, analysis);
    const zipped = new Uint8Array(await new Response(zipStream(files)).arrayBuffer());
    const entries = unzipSync(zipped);
    const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
    expect(manifest.datasets).toEqual([expect.objectContaining({ name: "ledger_entry", rows: 2, csv: "csv/ledger_entry.csv" })]);
    for (const file of manifest.files) expect(createHash("sha256").update(entries[file.path]).digest("hex")).toBe(file.sha256);
    expect(JSON.parse(strFromU8(entries["fintrack.json"])).datasets.ledger_entry[0].amount_minor).toBe("-2500000");
    expect(manifest.formatVersion).toBe(EXPORT_FORMAT_VERSION);
    expect(manifest.analysis.aiUploadVerified).toBe(false);
    const companion = await analysisFromArchive(zipped);
    expect(companion.exportId).toBe(manifest.exportId);
    expect(companion.csv).toEqual(entries[ANALYSIS_CSV_PATH]);
    expect(strFromU8(companion.csv)).toContain("tidak perlu meminta prompt tambahan");
    expect(strFromU8(entries["READ_ME_FIRST.md"])).toContain(manifest.exportId);

    // A CSV from another export must not be silently paired with this archive.
    entries[ANALYSIS_CSV_PATH] = strToU8(strFromU8(companion.csv).replaceAll(manifest.exportId, "a".repeat(64)));
    await expect(analysisFromArchive(zipSync(entries))).rejects.toThrow("EXPORT_PAIR_INVALID");
    // Even an updated checksum cannot disguise a mismatched export identity.
    manifest.files.find((file: { path: string }) => file.path === ANALYSIS_CSV_PATH).sha256 = createHash("sha256").update(entries[ANALYSIS_CSV_PATH]).digest("hex");
    entries["manifest.json"] = strToU8(JSON.stringify(manifest));
    await expect(analysisFromArchive(zipSync(entries))).rejects.toThrow("EXPORT_PAIR_INVALID");
  });
});
