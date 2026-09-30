# Shared helpers for the backup scripts. PostgreSQL client tools come from the
# pinned Docker image so pg_dump always matches the server major version
# (Supabase runs PostgreSQL 17). Set PG_TOOLS=local to use binaries on PATH.
PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"

# Runs a PostgreSQL client tool with the bundle directory as working directory.
pgx() {
  if [ "${PG_TOOLS:-docker}" = "local" ]; then
    (cd "$BUNDLE_DIR" && "$@")
  else
    docker run --rm -i --network host -u "$(id -u):$(id -g)" \
      -e PGCONNECT_TIMEOUT=30 -v "$BUNDLE_DIR:/bundle" -w /bundle "$PG_IMAGE" "$@"
  fi
}

# Row count per base table in the fintrack and ops schemas, as CSV on stdout.
count_rows_sql="
select n.nspname || '.' || c.relname as table_name,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint as row_count
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p') and n.nspname in ('fintrack', 'ops')
order by 1"
