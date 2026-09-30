# Shared helpers for the backup scripts. PostgreSQL client tools come from the
# pinned Docker image so pg_dump always matches the server major version
# (Supabase runs PostgreSQL 17). Set PG_TOOLS=local to use binaries on PATH.
PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"

# TLS like the app (src/server/db/supabase-ca.ts): remote hosts are verified
# against the pinned Supabase root CA, local hosts connect without TLS.
PG_CA_FILE="$(mktemp)"
node --input-type=module -e "import { SUPABASE_ROOT_CA_2021 } from '$(cd "$(dirname "${BASH_SOURCE[0]}")/../../src/server/db" && pwd)/supabase-ca.ts'; process.stdout.write(SUPABASE_ROOT_CA_2021)" > "$PG_CA_FILE"
chmod 644 "$PG_CA_FILE"

# Selects the TLS mode for the database the next pgx calls talk to.
use_database() {
  case "$(node -e 'console.log(new URL(process.argv[1]).hostname)' "$1")" in
    127.0.0.1 | localhost | ::1 | "[::1]") PGSSLMODE=disable ;;
    *) PGSSLMODE=verify-full ;;
  esac
  export PGSSLMODE
}

# Runs a PostgreSQL client tool with the bundle directory as working directory.
pgx() {
  if [ "${PG_TOOLS:-docker}" = "local" ]; then
    (cd "$BUNDLE_DIR" && PGSSLROOTCERT="$PG_CA_FILE" "$@")
  else
    docker run --rm -i --network host -u "$(id -u):$(id -g)" \
      -e PGCONNECT_TIMEOUT=30 -e PGSSLMODE="${PGSSLMODE:-disable}" -e PGSSLROOTCERT=/certs/supabase-root.crt \
      -v "$PG_CA_FILE:/certs/supabase-root.crt:ro" -v "$BUNDLE_DIR:/bundle" -w /bundle "$PG_IMAGE" "$@"
  fi
}

# Row count per base table in the fintrack and ops schemas, as CSV on stdout.
count_rows_sql="
select n.nspname || '.' || c.relname as table_name,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint as row_count
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p') and n.nspname in ('fintrack', 'ops')
order by 1"
