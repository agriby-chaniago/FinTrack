import { createHash } from "node:crypto";

import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { exportFileName, exportFiles, toCsv, zipStream } from "./export";

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
  it("names the file in Asia/Jakarta time", () => {
    expect(exportFileName(new Date("2027-02-07T17:30:00Z"))).toBe("fintrack-export-20270208-0030.zip");
  });

  it("streams a ZIP whose manifest checksums match every file", async () => {
    const files = exportFiles([dataset], new Date("2027-02-07T17:30:00Z"));
    const zipped = new Uint8Array(await new Response(zipStream(files)).arrayBuffer());
    const entries = unzipSync(zipped);
    const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
    expect(manifest.datasets).toEqual([{ name: "ledger_entry", rows: 2, csv: "csv/ledger_entry.csv" }]);
    for (const file of manifest.files) expect(createHash("sha256").update(entries[file.path]).digest("hex")).toBe(file.sha256);
    expect(JSON.parse(strFromU8(entries["fintrack.json"])).datasets.ledger_entry[0].amount_minor).toBe("-2500000");
  });
});
