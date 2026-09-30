#!/usr/bin/env bash
# Restore drill: restores a decrypted bundle into a throwaway PostgreSQL 17
# container migrated to the bundle's level, verifies it, and removes the
# container. Nothing touches a real environment.
#
#   BUNDLE_DIR   decrypted bundle directory
set -euo pipefail
: "${BUNDLE_DIR:?BUNDLE_DIR is required}"
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=pg-tools.sh
source "$here/pg-tools.sh"

name="fintrack-drill-$$"
port="${DRILL_PORT:-55432}"
password="drill-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
migrations="$(mktemp -d)"
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -rf "$migrations"
}
trap cleanup EXIT

docker run -d --rm --name "$name" -e POSTGRES_PASSWORD="$password" -p "127.0.0.1:$port:5432" "$PG_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$name" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
url="postgresql://postgres:$password@127.0.0.1:$port/postgres"

# Supabase provides the extensions schema and auth.users; stubs keep the
# migrations and the app_owner foreign key valid.
docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
create schema extensions;
create schema auth;
create table auth.users (id uuid primary key);
SQL

count="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).migrations.count)' "$BUNDLE_DIR/manifest.json")"
node "$here/prepare-migrations.mts" "$count" "$migrations"
ADMIN_DATABASE_URL="$url" MIGRATIONS_FOLDER="$migrations" node "$here/../migrate.mts"

BUNDLE_DIR="$BUNDLE_DIR" TARGET_DATABASE_URL="$url" "$here/restore-bundle.sh"
echo "Restore drill passed"
