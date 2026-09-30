#!/usr/bin/env bash
# Restores a decrypted recovery bundle into a target database that was already
# migrated to the bundle's migration level (see docs/runbooks/backup-and-restore.md).
# It refuses a target at another level or one that already holds financial data,
# then verifies row counts against the manifest.
#
#   BUNDLE_DIR            decrypted bundle directory
#   TARGET_DATABASE_URL   admin connection to the restore target
set -euo pipefail
: "${BUNDLE_DIR:?BUNDLE_DIR is required}"
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL is required}"
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=pg-tools.sh
source "$here/pg-tools.sh"
BUNDLE_DIR="$(cd "$BUNDLE_DIR" && pwd)"
url="$TARGET_DATABASE_URL"
q() { pgx psql "$url" -v ON_ERROR_STOP=1 -At -c "$1"; }

node "$here/manifest.mts" check "$BUNDLE_DIR"

expected_hashes="$(tail -n +2 "$BUNDLE_DIR/migrations.csv" | cut -d, -f2)"
target_hashes="$(q "select hash from drizzle.__drizzle_migrations order by id")"
if [ "$expected_hashes" != "$target_hashes" ]; then
  echo "Target migration level differs from the bundle; migrate the target with prepare-migrations.mts first" >&2
  exit 1
fi
if [ "$(q "select count(*) from fintrack.ledger_entry") $(q "select count(*) from fintrack.app_owner")" != "0 0" ]; then
  echo "Target already contains FinTrack data; restore only into an empty, freshly migrated database" >&2
  exit 1
fi

# The owner row comes first because every financial row references it. It has
# no Auth user until the owner is rebound. If a later step fails, start again
# from a fresh database.
pgx psql "$url" -v ON_ERROR_STOP=1 -c "\copy fintrack.app_owner (id, singleton_key, created_at, bound_at) from 'app_owner.csv' csv header"
# ops.keepalive_probe is seeded by migrations; the dump carries the same row.
q "truncate ops.keepalive_probe"
pgx pg_restore --data-only --single-transaction --exit-on-error --no-owner --dbname="$url" data.dump

pgx psql "$url" -v ON_ERROR_STOP=1 --csv -c "$count_rows_sql" > "$BUNDLE_DIR/.restored_counts.csv"
node --input-type=module - "$BUNDLE_DIR" <<'NODE'
import { readFileSync } from "node:fs";
const dir = process.argv[2];
const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8"));
const restored = Object.fromEntries(
  readFileSync(`${dir}/.restored_counts.csv`, "utf8").trim().split("\n").slice(1).map((line) => line.split(",")).map(([t, n]) => [t, Number(n)]),
);
const skipped = new Set(["fintrack.idempotency_record"]);
const mismatches = Object.entries(manifest.rowCounts).filter(([table, rows]) => !skipped.has(table) && restored[table] !== rows);
if (mismatches.length > 0) {
  console.error(`Row count mismatch: ${mismatches.map(([t, rows]) => `${t} expected ${rows} got ${restored[t]}`).join("; ")}`);
  process.exit(1);
}
console.log(`Row counts verified for ${Object.keys(manifest.rowCounts).length - skipped.size} tables`);
NODE
rm -f "$BUNDLE_DIR/.restored_counts.csv"

orphans="$(q "select count(*) from fintrack.ledger_entry e where not exists (select 1 from fintrack.ledger_leg l where l.entry_id = e.id)")"
if [ "$orphans" != "0" ]; then
  echo "Restored ledger has $orphans entries without legs" >&2
  exit 1
fi
echo "Restore complete. The owner row has no Auth user; bind it with: pnpm owner:bind --auth-user-id <uuid> --rebind"
