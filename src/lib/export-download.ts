import { ANALYSIS_CSV_PATH, EXPORT_FORMAT_VERSION, analysisColumns } from "./export-contract";

/** Extracts the companion from the one downloaded snapshot, never a second GET. */
export async function analysisFromArchive(bytes: Uint8Array) {
  const { unzipSync, strFromU8 } = await import("fflate");
  const entries = unzipSync(bytes, { filter: (file) => [ANALYSIS_CSV_PATH, "manifest.json"].includes(file.name) });
  const csv = entries[ANALYSIS_CSV_PATH];
  const manifestBytes = entries["manifest.json"];
  if (!csv || !manifestBytes) throw new Error("EXPORT_PAIR_INVALID");
  const manifest = JSON.parse(strFromU8(manifestBytes)) as {
    formatVersion: number; exportId: string; exportedAt: string;
    analysis: { csv: string; failedChecks: number; warningChecks: number };
    files: { path: string; sha256: string }[];
  };
  const checksum = manifest.files?.find((file) => file.path === ANALYSIS_CSV_PATH)?.sha256;
  if (manifest.formatVersion !== EXPORT_FORMAT_VERSION || !/^[a-f0-9]{64}$/.test(manifest.exportId) || manifest.analysis?.csv !== ANALYSIS_CSV_PATH || !checksum) throw new Error("EXPORT_PAIR_INVALID");
  const content = new Uint8Array(csv);
  const digest = await crypto.subtle.digest("SHA-256", content);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== checksum || !strFromU8(content).startsWith(`${analysisColumns.join(",")}\r\n${manifest.exportId},`)) throw new Error("EXPORT_PAIR_INVALID");
  return { csv: content, exportId: manifest.exportId, failedChecks: manifest.analysis.failedChecks, warningChecks: manifest.analysis.warningChecks };
}
