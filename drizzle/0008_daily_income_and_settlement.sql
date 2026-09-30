CREATE TABLE "fintrack"."balance_confirmation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"physical_balance_minor" bigint NOT NULL,
	"as_of" timestamp (3) with time zone NOT NULL,
	"source" text NOT NULL,
	"supersedes_id" uuid,
	"superseded_by_id" uuid,
	"recorded_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "balance_confirmation_source_check" CHECK ("fintrack"."balance_confirmation"."source" in ('SETTLEMENT', 'MANUAL'))
);
--> statement-breakpoint
CREATE TABLE "fintrack"."daily_income_override" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"amount_minor" bigint,
	"after_settlement" boolean DEFAULT false NOT NULL,
	"supersedes_id" uuid,
	"superseded_by_id" uuid,
	"recorded_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_income_override_amount_check" CHECK ("fintrack"."daily_income_override"."amount_minor" is null or "fintrack"."daily_income_override"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fintrack"."daily_income_state_transition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"to_state" text NOT NULL,
	"effective_date" date NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp (3) with time zone,
	CONSTRAINT "daily_income_state_transition_state_check" CHECK ("fintrack"."daily_income_state_transition"."to_state" in ('ACTIVE', 'PAUSED')),
	CONSTRAINT "daily_income_state_transition_status_check" CHECK ("fintrack"."daily_income_state_transition"."status" in ('ACTIVE', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "fintrack"."settlement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"closing_physical_minor" bigint,
	"closing_at" timestamp (3) with time zone,
	"closing_confirmation_id" uuid,
	"living_expense_minor" bigint,
	"snapshot" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"settled_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_status_check" CHECK ("fintrack"."settlement"."status" in ('DRAFT', 'SETTLED')),
	CONSTRAINT "settlement_range_check" CHECK ("fintrack"."settlement"."end_date" >= "fintrack"."settlement"."start_date"),
	CONSTRAINT "settlement_settled_fields_check" CHECK ("fintrack"."settlement"."status" = 'DRAFT' or ("fintrack"."settlement"."closing_confirmation_id" is not null and "fintrack"."settlement"."living_expense_minor" is not null and "fintrack"."settlement"."snapshot" is not null and "fintrack"."settlement"."settled_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "fintrack"."balance_confirmation" ADD CONSTRAINT "balance_confirmation_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "fintrack"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."balance_confirmation" ADD CONSTRAINT "balance_confirmation_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "fintrack"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."balance_confirmation" ADD CONSTRAINT "balance_confirmation_supersedes_id_balance_confirmation_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "fintrack"."balance_confirmation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."balance_confirmation" ADD CONSTRAINT "balance_confirmation_superseded_by_id_balance_confirmation_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "fintrack"."balance_confirmation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."daily_income_override" ADD CONSTRAINT "daily_income_override_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "fintrack"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."daily_income_override" ADD CONSTRAINT "daily_income_override_rule_id_daily_income_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "fintrack"."daily_income_rule"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."daily_income_override" ADD CONSTRAINT "daily_income_override_supersedes_id_daily_income_override_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "fintrack"."daily_income_override"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."daily_income_override" ADD CONSTRAINT "daily_income_override_superseded_by_id_daily_income_override_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "fintrack"."daily_income_override"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."daily_income_state_transition" ADD CONSTRAINT "daily_income_state_transition_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "fintrack"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."daily_income_state_transition" ADD CONSTRAINT "daily_income_state_transition_rule_id_daily_income_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "fintrack"."daily_income_rule"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."settlement" ADD CONSTRAINT "settlement_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "fintrack"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."settlement" ADD CONSTRAINT "settlement_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "fintrack"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."settlement" ADD CONSTRAINT "settlement_closing_confirmation_id_balance_confirmation_id_fk" FOREIGN KEY ("closing_confirmation_id") REFERENCES "fintrack"."balance_confirmation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "balance_confirmation_account_idx" ON "fintrack"."balance_confirmation" USING btree ("owner_id","account_id","as_of");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_income_override_current_uq" ON "fintrack"."daily_income_override" USING btree ("rule_id","business_date") WHERE "fintrack"."daily_income_override"."superseded_by_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_income_state_transition_date_uq" ON "fintrack"."daily_income_state_transition" USING btree ("rule_id","effective_date") WHERE "fintrack"."daily_income_state_transition"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_one_draft_uq" ON "fintrack"."settlement" USING btree ("owner_id","account_id") WHERE "fintrack"."settlement"."status" = 'DRAFT';--> statement-breakpoint
CREATE INDEX "settlement_account_idx" ON "fintrack"."settlement" USING btree ("owner_id","account_id","start_date");--> statement-breakpoint
-- Settlement ranges never overlap for an account (PRD: contiguous without overlap or gap).
ALTER TABLE "fintrack"."settlement" ADD CONSTRAINT "settlement_no_overlap"
  EXCLUDE USING gist ("owner_id" WITH =, "account_id" WITH =, daterange("start_date", "end_date", '[]') WITH &&);
--> statement-breakpoint
ALTER TABLE "fintrack"."daily_income_override"
  ALTER CONSTRAINT "daily_income_override_superseded_by_id_daily_income_override_id_fk" DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "fintrack"."balance_confirmation"
  ALTER CONSTRAINT "balance_confirmation_superseded_by_id_balance_confirmation_id_fk" DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "fintrack"."daily_income_state_transition" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ("status", "cancelled_at") ON "fintrack"."daily_income_state_transition" TO fintrack_app;
--> statement-breakpoint
CREATE POLICY "daily_income_state_transition_owner" ON "fintrack"."daily_income_state_transition" AS PERMISSIVE FOR ALL TO fintrack_app
  USING ("owner_id" = (select fintrack.current_owner_id()))
  WITH CHECK ("owner_id" = (select fintrack.current_owner_id()));
--> statement-breakpoint
ALTER TABLE "fintrack"."daily_income_override" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Append-only: UPDATE only sets superseded_by_id when a newer row replaces this one.
GRANT SELECT, INSERT, UPDATE ("superseded_by_id") ON "fintrack"."daily_income_override" TO fintrack_app;
--> statement-breakpoint
CREATE POLICY "daily_income_override_owner" ON "fintrack"."daily_income_override" AS PERMISSIVE FOR ALL TO fintrack_app
  USING ("owner_id" = (select fintrack.current_owner_id()))
  WITH CHECK ("owner_id" = (select fintrack.current_owner_id()));
--> statement-breakpoint
ALTER TABLE "fintrack"."balance_confirmation" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ("superseded_by_id") ON "fintrack"."balance_confirmation" TO fintrack_app;
--> statement-breakpoint
CREATE POLICY "balance_confirmation_owner" ON "fintrack"."balance_confirmation" AS PERMISSIVE FOR ALL TO fintrack_app
  USING ("owner_id" = (select fintrack.current_owner_id()))
  WITH CHECK ("owner_id" = (select fintrack.current_owner_id()));
--> statement-breakpoint
ALTER TABLE "fintrack"."settlement" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Drafts are edited in place; a SETTLED row is protected by the trigger below.
GRANT SELECT, INSERT, UPDATE, DELETE ON "fintrack"."settlement" TO fintrack_app;
--> statement-breakpoint
CREATE POLICY "settlement_owner" ON "fintrack"."settlement" AS PERMISSIVE FOR ALL TO fintrack_app
  USING ("owner_id" = (select fintrack.current_owner_id()))
  WITH CHECK ("owner_id" = (select fintrack.current_owner_id()));
--> statement-breakpoint
-- A settled settlement is immutable (PRD LOCKED): it can never be updated or deleted.
CREATE FUNCTION "fintrack"."settlement_immutable"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'SETTLED' THEN
    RAISE EXCEPTION 'settlement % is settled and immutable', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "settlement_immutable" BEFORE UPDATE OR DELETE ON "fintrack"."settlement"
  FOR EACH ROW EXECUTE FUNCTION "fintrack"."settlement_immutable"();
