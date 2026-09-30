CREATE SCHEMA "fintrack";
--> statement-breakpoint
CREATE SCHEMA "ops";
--> statement-breakpoint
CREATE TABLE "fintrack"."app_owner" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"singleton_key" boolean DEFAULT true NOT NULL,
	"auth_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bound_at" timestamp with time zone,
	CONSTRAINT "app_owner_singleton_key_unique" UNIQUE("singleton_key"),
	CONSTRAINT "app_owner_auth_user_id_unique" UNIQUE("auth_user_id"),
	CONSTRAINT "app_owner_singleton_key_check" CHECK ("fintrack"."app_owner"."singleton_key")
);
--> statement-breakpoint
CREATE TABLE "ops"."keepalive_probe" (
	"id" smallint PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "keepalive_probe_single_row_check" CHECK ("ops"."keepalive_probe"."id" = 1)
);
--> statement-breakpoint
-- Deleting the Supabase Auth user must never delete financial history: the
-- binding is cleared and every protected request fails closed.
ALTER TABLE "fintrack"."app_owner"
  ADD CONSTRAINT "app_owner_auth_user_id_fkey"
  FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users" ("id") ON DELETE SET NULL;
--> statement-breakpoint
REVOKE ALL ON SCHEMA "fintrack" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON SCHEMA "ops" FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "fintrack" TO fintrack_app, fintrack_backup;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "ops" TO fintrack_probe, fintrack_backup;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "fintrack" GRANT SELECT ON TABLES TO fintrack_backup;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "ops" GRANT SELECT ON TABLES TO fintrack_backup;
--> statement-breakpoint
-- Verified JWT claims are installed transaction-locally by withOwnerDb().
-- An unset or cleared setting yields NULL, never an error.
CREATE FUNCTION "fintrack"."request_auth_user_id"() RETURNS uuid
  LANGUAGE sql STABLE
  SET search_path = ''
AS $$
  SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;
--> statement-breakpoint
-- Uses `=` rather than IS NOT DISTINCT FROM so a NULL binding never matches.
CREATE FUNCTION "fintrack"."current_owner_id"() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = ''
AS $$
  SELECT o.id FROM fintrack.app_owner o
  WHERE o.auth_user_id = fintrack.request_auth_user_id()
$$;
--> statement-breakpoint
-- Distinguishes 503 APP_NOT_INITIALIZED from 403 without exposing the binding.
CREATE FUNCTION "fintrack"."owner_access_status"() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = ''
AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM fintrack.app_owner WHERE auth_user_id IS NOT NULL) THEN 'NOT_INITIALIZED'
    WHEN fintrack.current_owner_id() IS NOT NULL THEN 'OWNER'
    ELSE 'NOT_OWNER'
  END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "fintrack"."request_auth_user_id"() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "fintrack"."current_owner_id"() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "fintrack"."owner_access_status"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "fintrack"."request_auth_user_id"(), "fintrack"."current_owner_id"(), "fintrack"."owner_access_status"() TO fintrack_app;
--> statement-breakpoint
ALTER TABLE "fintrack"."app_owner" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON "fintrack"."app_owner" TO fintrack_app;
--> statement-breakpoint
GRANT SELECT ON "fintrack"."app_owner" TO fintrack_backup;
--> statement-breakpoint
CREATE POLICY "app_owner_select_bound_owner" ON "fintrack"."app_owner"
  AS PERMISSIVE FOR SELECT TO fintrack_app
  USING ("auth_user_id" = fintrack.request_auth_user_id());
--> statement-breakpoint
ALTER TABLE "ops"."keepalive_probe" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON "ops"."keepalive_probe" TO fintrack_probe, fintrack_backup;
--> statement-breakpoint
CREATE POLICY "keepalive_probe_read" ON "ops"."keepalive_probe"
  AS PERMISSIVE FOR SELECT TO fintrack_probe
  USING (true);
--> statement-breakpoint
INSERT INTO "ops"."keepalive_probe" ("id", "label") VALUES (1, 'fintrack keepalive probe');
