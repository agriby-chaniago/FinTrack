-- Platform roles. Roles are created without LOGIN; each environment enables
-- LOGIN and sets passwords through scripts/provision-roles.mts so that no
-- credential is ever stored in Git.
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fintrack_app') THEN
    CREATE ROLE fintrack_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fintrack_probe') THEN
    CREATE ROLE fintrack_probe NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fintrack_backup') THEN
    -- Logical dumps must read every row, so this read-only role bypasses RLS.
    CREATE ROLE fintrack_backup NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION BYPASSRLS;
  END IF;
END
$$;
