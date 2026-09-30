// Copies the first N committed migrations into a separate folder so a restore
// target can be migrated to exactly the level recorded in a backup bundle.
//
//   node scripts/backup/prepare-migrations.mts <count> <out-dir>
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [countArg, outDir] = process.argv.slice(2).filter((arg) => arg !== "--");
const count = Number(countArg);
if (!Number.isInteger(count) || count < 1 || !outDir) {
  console.error("usage: prepare-migrations.mts <count> <out-dir>");
  process.exit(2);
}

type Journal = { version: string; dialect: string; entries: { idx: number; tag: string }[] };
const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as Journal;
if (journal.entries.length < count) {
  console.error(`The bundle needs ${count} migrations but this checkout has ${journal.entries.length}; check out a newer commit.`);
  process.exit(1);
}

mkdirSync(join(outDir, "meta"), { recursive: true });
const entries = journal.entries.slice(0, count);
for (const entry of entries) copyFileSync(join("drizzle", `${entry.tag}.sql`), join(outDir, `${entry.tag}.sql`));
writeFileSync(join(outDir, "meta", "_journal.json"), `${JSON.stringify({ ...journal, entries }, null, 2)}\n`);
console.log(`Prepared ${entries.length} migrations in ${outDir} (last: ${entries.at(-1)!.tag})`);
