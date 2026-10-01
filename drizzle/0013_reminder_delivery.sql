CREATE TABLE "fintrack"."reminder_delivery" (
	"owner_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_delivery_owner_id_business_date_pk" PRIMARY KEY("owner_id","business_date")
);
--> statement-breakpoint
ALTER TABLE "fintrack"."reminder_delivery" ADD CONSTRAINT "reminder_delivery_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "fintrack"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- The reminder route has no session. This returns the bound owner's Auth user id so
-- the route can open a normal owner transaction (withOwnerDb) instead of bypassing RLS.
CREATE FUNCTION "fintrack"."reminder_owner_auth_user_id"() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = ''
AS $$
  SELECT o.auth_user_id FROM fintrack.app_owner o WHERE o.auth_user_id IS NOT NULL
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "fintrack"."reminder_owner_auth_user_id"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "fintrack"."reminder_owner_auth_user_id"() TO fintrack_app;
--> statement-breakpoint
ALTER TABLE "fintrack"."reminder_delivery" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON "fintrack"."reminder_delivery" TO fintrack_app;
--> statement-breakpoint
CREATE POLICY "reminder_delivery_owner" ON "fintrack"."reminder_delivery" AS PERMISSIVE FOR ALL TO fintrack_app
  USING ("owner_id" = (select fintrack.current_owner_id()))
  WITH CHECK ("owner_id" = (select fintrack.current_owner_id()));
