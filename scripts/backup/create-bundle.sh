#!/usr/bin/env bash
# Creates a plaintext FinTrack recovery bundle directory (PRD: Backup dan restore):
# schema, data, owner row without the Auth UUID, migration journal, role list,
# row counts, manifest, and SHA256SUMS. The caller encrypts the bundle before it
# leaves the machine; this script never uploads anything.
#
#   BACKUP_DATABASE_URL  fintrack_backup connection (session pooler, port 5432)
#   BUNDLE_DIR           output directory; must not exist yet
set -euo pipefail
: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL is required}"
: "${BUNDLE_DIR:?BUNDLE_DIR is required}"
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=pg-tools.sh
source "$here/pg-tools.sh"

mkdir -m 700 "$BUNDLE_DIR"
BUNDLE_DIR="$(cd "$BUNDLE_DIR" && pwd)"
url="$BACKUP_DATABASE_URL"

counts() { pgx psql "$url" -v ON_ERROR_STOP=1 --csv -c "$count_rows_sql"; }

# The dump is one snapshot; counts taken before and after must agree, otherwise
# the owner was writing during the backup and the bundle is taken again.
for attempt in 1 2 3; do
  before="$(counts)"
  pgx pg_dump "$url" --schema-only --schema=fintrack --schema=ops --file=schema.sql
  pgx pg_dump "$url" --data-only --format=custom --compress=6 --schema=fintrack --schema=ops \
    --exclude-table-data=fintrack.app_owner --exclude-table-data=fintrack.idempotency_record --file=data.dump
  pgx psql "$url" -v ON_ERROR_STOP=1 -c "\copy (select id, singleton_key, created_at, bound_at from fintrack.app_owner) to 'app_owner.csv' csv header"
  pgx psql "$url" -v ON_ERROR_STOP=1 -c "\copy (select id, hash, created_at from drizzle.__drizzle_migrations order by id) to 'migrations.csv' csv header"
  after="$(counts)"
  if [ "$before" = "$after" ]; then
    printf '%s\n' "$after" > "$BUNDLE_DIR/counts.csv"
    break
  fi
  if [ "$attempt" = 3 ]; then
    echo "Data kept changing during the backup; giving up after 3 attempts" >&2
    exit 1
  fi
  echo "Data changed during backup attempt $attempt; retrying" >&2
  sleep 30
done

# Roles are recreated by migration 0000 and scripts/provision-roles.mts; this
# list records their attributes for the restore check. Passwords are never read.
pgx psql "$url" -v ON_ERROR_STOP=1 --csv -c "select rolname, rolcanlogin, rolbypassrls, rolinherit from pg_roles where rolname like 'fintrack\_%' order by 1" > "$BUNDLE_DIR/roles.csv"
pgx psql "$url" -v ON_ERROR_STOP=1 -At -c "show server_version" > "$BUNDLE_DIR/server_version.txt"

node "$here/manifest.mts" write "$BUNDLE_DIR"
echo "Bundle ready: $BUNDLE_DIR"
