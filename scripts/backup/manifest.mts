// Recovery bundle manifest and checksums.
//
//   node scripts/backup/manifest.mts write <bundle-dir>   writes manifest.json and SHA256SUMS
//   node scripts/backup/manifest.mts check <bundle-dir>   verifies SHA256SUMS
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [mode, dir] = process.argv.slice(2).filter((arg) => arg !== "--");
if (!dir || (mode !== "write" && mode !== "check")) {
  console.error("usage: manifest.mts write|check <bundle-dir>");
  process.exit(2);
}

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

function csvRows(path: string): string[][] {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.split(","));
}

if (mode === "write") {
  const files = readdirSync(dir)
    .filter((name) => name !== "SHA256SUMS" && name !== "manifest.json")
    .sort();
  const counts = Object.fromEntries(csvRows(join(dir, "counts.csv")).map(([table, rows]) => [table, Number(rows)]));
  const migrations = csvRows(join(dir, "migrations.csv")).map(([, hash]) => hash);
  const manifest = {
    format: "fintrack-recovery-bundle",
    formatVersion: 1,
    createdAt: new Date().toISOString(),
    serverVersion: readFileSync(join(dir, "server_version.txt"), "utf8").trim(),
    migrations: { count: migrations.length, hashes: migrations },
    rowCounts: counts,
    excludedData: {
      "fintrack.app_owner": "Restored from app_owner.csv without the Auth UUID; rebind the owner afterwards.",
      "fintrack.idempotency_record": "Short-lived API replay cache.",
    },
    files: files.map((name) => ({ name, sha256: sha256(join(dir, name)) })),
  };
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const sums = [...files, "manifest.json"].map((name) => `${sha256(join(dir, name))}  ${name}`).join("\n");
  writeFileSync(join(dir, "SHA256SUMS"), `${sums}\n`);
  console.log(`manifest.json: ${files.length} files, ${migrations.length} migrations`);
} else {
  const lines = readFileSync(join(dir, "SHA256SUMS"), "utf8").trim().split("\n");
  const bad = lines.filter((line) => {
    const [expected, name] = line.split(/\s+/);
    return sha256(join(dir, name)) !== expected;
  });
  if (bad.length > 0) {
    console.error(`Checksum mismatch: ${bad.map((line) => line.split(/\s+/)[1]).join(", ")}`);
    process.exit(1);
  }
  console.log(`Checksums verified: ${lines.length} files`);
}
