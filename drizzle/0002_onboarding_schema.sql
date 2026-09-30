CREATE TABLE "fintrack"."account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"provider_name" text NOT NULL,
	"account_type" text NOT NULL,
	"purpose_label" text NOT NULL,
	"currency" text DEFAULT 'IDR' NOT NULL,
	"is_cash_account" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer NOT NULL,
	"activation_cutover_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_currency_idr_check" CHECK ("fintrack"."account"."currency" = 'IDR'),
	CONSTRAINT "account_type_check" CHECK ("fintrack"."account"."account_type" in ('BANK', 'E_WALLET'))
);
--> statement-breakpoint
CREATE TABLE "fintrack"."daily_income_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"effective_start_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_income_rule_amount_check" CHECK ("fintrack"."daily_income_rule"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "fintrack"."external_holding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"is_default" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fintrack"."external_subject" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fintrack"."monthly_account_setting" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"retained_balance_floor_minor" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_account_setting_floor_check" CHECK ("fintrack"."monthly_account_setting"."retained_balance_floor_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fintrack"."monthly_income_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"expected_amount_minor" bigint NOT NULL,
	"first_expected_cycle" text NOT NULL,
	"last_expected_cycle" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_income_rule_amount_check" CHECK ("fintrack"."monthly_income_rule"."expected_amount_minor" > 0),
	CONSTRAINT "monthly_income_rule_first_cycle_check" CHECK (first_expected_cycle ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "monthly_income_rule_last_cycle_check" CHECK (last_expected_cycle is null or (last_expected_cycle ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' and last_expected_cycle >= first_expected_cycle))
);
--> statement-breakpoint
CREATE TABLE "fintrack"."onboarding_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"status" text NOT NULL,
	"cutover_at" timestamp with time zone,
	"draft" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"confirmed_at" timestamp with time zone,
	"supersedes_id" uuid,
	"superseded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_snapshot_status_check" CHECK ("fintrack"."onboarding_snapshot"."status" in ('DRAFT', 'CONFIRMED')),
	CONSTRAINT "onboarding_snapshot_confirmed_fields_check" CHECK ("fintrack"."onboarding_snapshot"."status" = 'DRAFT' or ("fintrack"."onboarding_snapshot"."cutover_at" is not null and "fintrack"."onboarding_snapshot"."confirmed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "fintrack"."opening_account_position" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"physical_balance_minor" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fintrack"."opening_external_position" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"holding_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	CONSTRAINT "opening_external_position_amount_check" CHECK ("fintrack"."opening_external_position"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "fintrack"."owner_setting" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"default_special_source_account_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fintrack"."recurring_expense_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"display_name" text NOT NULL,
	"first_cycle" text NOT NULL,
	"last_cycle" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_expense_rule_kind_check" CHECK ("fintrack"."recurring_expense_rule"."kind" in ('SUBSCRIPTION', 'BANK_FEE')),
	CONSTRAINT "recurring_expense_rule_first_cycle_check" CHECK (first_cycle ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "recurring_expense_rule_last_cycle_check" CHECK (last_cycle is null or (last_cycle ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' and last_cycle >= first_cycle))
);
--> statement-breakpoint
CREATE TABLE "fintrack"."recurring_expense_rule_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"effective_from_cycle" text NOT NULL,
	"expected_day" smallint,
	"expected_amount_minor" bigint,
	"supersedes_id" uuid,
	"superseded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_expense_rule_revision_cycle_check" CHECK (effective_from_cycle ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "recurring_expense_rule_revision_day_check" CHECK ("fintrack"."recurring_expense_rule_revision"."expected_day" is null or "fintrack"."recurring_expense_rule_revision"."expected_day" between 1 and 31),
	CONSTRAINT "recurring_expense_rule_revision_amount_check" CHECK ("fintrack"."recurring_expense_rule_revision"."expected_amount_minor" is null or "fintrack"."recurring_expense_rule_revision"."expected_amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "fintrack"."special_expense_category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fintrack"."account" ADD CONSTRAINT "account_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "fintrack"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."daily_income_rule" ADD CONSTRAINT "daily_income_rule_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "fintrack"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."daily_income_rule" ADD CONSTRAINT "daily_income_rule_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "fintrack"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."external_holding" ADD CONSTRAINT "external_holding_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "fintrack"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."external_holding" ADD CONSTRAINT "external_holding_subject_id_external_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "fintrack"."external_subject"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."external_subject" ADD CONSTRAINT "external_subject_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "fintrack"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."monthly_account_setting" ADD CONSTRAINT "monthly_account_setting_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "fintrack"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."monthly_account_setting" ADD CONSTRAINT "monthly_account_setting_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "fintrack"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."monthly_income_rule" ADD CONSTRAINT "monthly_income_rule_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "fintrack"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."monthly_income_rule" ADD CONSTRAINT "monthly_income_rule_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "fintrack"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."onboarding_snapshot" ADD CONSTRAINT "onboarding_snapshot_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "fintrack"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."onboarding_snapshot" ADD CONSTRAINT "onboarding_snapshot_supersedes_id_onboarding_snapshot_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "fintrack"."onboarding_snapshot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."onboarding_snapshot" ADD CONSTRAINT "onboarding_snapshot_superseded_by_id_onboarding_snapshot_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "fintrack"."onboarding_snapshot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."opening_account_position" ADD CONSTRAINT "opening_account_position_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "fintrack"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."opening_account_position" ADD CONSTRAINT "opening_account_position_snapshot_id_onboarding_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "fintrack"."onboarding_snapshot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."opening_account_position" ADD CONSTRAINT "opening_account_position_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "fintrack"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."opening_external_position" ADD CONSTRAINT "opening_external_position_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "fintrack"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."opening_external_position" ADD CONSTRAINT "opening_external_position_snapshot_id_onboarding_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "fintrack"."onboarding_snapshot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."opening_external_position" ADD CONSTRAINT "opening_external_position_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "fintrack"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."opening_external_position" ADD CONSTRAINT "opening_external_position_holding_id_external_holding_id_fk" FOREIGN KEY ("holding_id") REFERENCES "fintrack"."external_holding"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."owner_setting" ADD CONSTRAINT "owner_setting_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "fintrack"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."owner_setting" ADD CONSTRAINT "owner_setting_default_special_source_account_id_account_id_fk" FOREIGN KEY ("default_special_source_account_id") REFERENCES "fintrack"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."recurring_expense_rule" ADD CONSTRAINT "recurring_expense_rule_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "fintrack"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."recurring_expense_rule" ADD CONSTRAINT "recurring_expense_rule_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "fintrack"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."recurring_expense_rule_revision" ADD CONSTRAINT "recurring_expense_rule_revision_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "fintrack"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."recurring_expense_rule_revision" ADD CONSTRAINT "recurring_expense_rule_revision_rule_id_recurring_expense_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "fintrack"."recurring_expense_rule"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."recurring_expense_rule_revision" ADD CONSTRAINT "recurring_expense_rule_revision_supersedes_id_recurring_expense_rule_revision_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "fintrack"."recurring_expense_rule_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."recurring_expense_rule_revision" ADD CONSTRAINT "recurring_expense_rule_revision_superseded_by_id_recurring_expense_rule_revision_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "fintrack"."recurring_expense_rule_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."special_expense_category" ADD CONSTRAINT "special_expense_category_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "fintrack"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_owner_idx" ON "fintrack"."account" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_holding_default_uq" ON "fintrack"."external_holding" USING btree ("subject_id") WHERE "fintrack"."external_holding"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "external_subject_owner_name_uq" ON "fintrack"."external_subject" USING btree ("owner_id","normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_snapshot_one_draft_uq" ON "fintrack"."onboarding_snapshot" USING btree ("owner_id") WHERE "fintrack"."onboarding_snapshot"."status" = 'DRAFT';--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_snapshot_one_effective_uq" ON "fintrack"."onboarding_snapshot" USING btree ("owner_id") WHERE "fintrack"."onboarding_snapshot"."status" = 'CONFIRMED' and "fintrack"."onboarding_snapshot"."superseded_by_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "opening_account_position_uq" ON "fintrack"."opening_account_position" USING btree ("snapshot_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "opening_external_position_uq" ON "fintrack"."opening_external_position" USING btree ("snapshot_id","account_id","holding_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_expense_rule_revision_current_uq" ON "fintrack"."recurring_expense_rule_revision" USING btree ("rule_id","effective_from_cycle") WHERE "fintrack"."recurring_expense_rule_revision"."superseded_by_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "special_expense_category_owner_name_uq" ON "fintrack"."special_expense_category" USING btree ("owner_id","normalized_name");--> statement-breakpoint
-- Row level security, policies, and grants for every table above.
-- fintrack_app never receives DELETE: confirmed records are append-only.
ALTER TABLE "fintrack"."account" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "fintrack"."account" TO fintrack_app;
--> statement-breakpoint
CREATE POLICY "account_owner" ON "fintrack"."account" AS PERMISSIVE FOR ALL TO fintrack_app
  USING ("owner_id" = (select fintrack.current_owner_id()))
  WITH CHECK ("owner_id" = (select fintrack.current_owner_id()));
--> statement-breakpoint
ALTER TABLE "fintrack"."special_expense_category" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "fintrack"."special_expense_category" TO fintrack_app;
--> statement-breakpoint
CREATE POLICY "special_expense_category_owner" ON "fintrack"."special_expense_category" AS PERMISSIVE FOR ALL TO fintrack_app
  USING ("owner_id" = (select fintrack.current_owner_id()))
  WITH CHECK ("owner_id" = (select fintrack.current_owner_id()));
--> statement-breakpoint
ALTER TABLE "fintrack"."owner_setting" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "fintrack"."owner_setting" TO fintrack_app;
--> statement-breakpoint
CREATE POLICY "owner_setting_owner" ON "fintrack"."owner_setting" AS PERMISSIVE FOR ALL TO fintrack_app
  USING ("owner_id" = (select fintrack.current_owner_id()))
  WITH CHECK ("owner_id" = (select fintrack.current_owner_id()));
--> statement-breakpoint
ALTER TABLE "fintrack"."monthly_account_setting" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "fintrack"."monthly_account_setting" TO fintrack_app;
--> statement-breakpoint
CREATE POLICY "monthly_account_setting_owner" ON "fintrack"."monthly_account_setting" AS PERMISSIVE FOR ALL TO fintrack_app
  USING ("owner_id" = (select fintrack.current_owner_id()))
  WITH CHECK ("owner_id" = (select fintrack.current_owner_id()));
--> statement-breakpoint
ALTER TABLE "fintrack"."external_subject" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "fintrack"."external_subject" TO fintrack_app;
--> statement-breakpoint
CREATE POLICY "external_subject_owner" ON "fintrack"."external_subject" AS PERMISSIVE FOR ALL TO fintrack_app
  USING ("owner_id" = (select fintrack.current_owner_id()))
  WITH CHECK ("owner_id" = (select fintrack.current_owner_id()));
--> statement-breakpoint
ALTER TABLE "fintrack"."external_holding" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON "fintrack"."external_holding" TO fintrack_app;
--> statement-breakpoint
CREATE POLICY "external_holding_owner" ON "fintrack"."external_holding" AS PERMISSIVE FOR ALL TO fintrack_app
  USING ("owner_id" = (select fintrack.current_owner_id()))
  WITH CHECK ("owner_id" = (select fintrack.current_owner_id()));
--> statement-breakpoint
ALTER TABLE "fintrack"."onboarding_snapshot" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "fintrack"."onboarding_snapshot" TO fintrack_app;
--> statement-breakpoint
CREATE POLICY "onboarding_snapshot_owner" ON "fintrack"."onboarding_snapshot" AS PERMISSIVE FOR ALL TO fintrack_app
  USING ("owner_id" = (select fintrack.current_owner_id()))
  WITH CHECK ("owner_id" = (select fintrack.current_owner_id()));
--> statement-breakpoint
ALTER TABLE "fintrack"."opening_account_position" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON "fintrack"."opening_account_position" TO fintrack_app;
--> statement-breakpoint
CREATE POLICY "opening_account_position_owner" ON "fintrack"."opening_account_position" AS PERMISSIVE FOR ALL TO fintrack_app
  USING ("owner_id" = (select fintrack.current_owner_id()))
  WITH CHECK ("owner_id" = (select fintrack.current_owner_id()));
--> statement-breakpoint
ALTER TABLE "fintrack"."opening_external_position" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON "fintrack"."opening_external_position" TO fintrack_app;
--> statement-breakpoint
CREATE POLICY "opening_external_position_owner" ON "fintrack"."opening_external_position" AS PERMISSIVE FOR ALL TO fintrack_app
  USING ("owner_id" = (select fintrack.current_owner_id()))
  WITH CHECK ("owner_id" = (select fintrack.current_owner_id()));
--> statement-breakpoint
ALTER TABLE "fintrack"."daily_income_rule" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON "fintrack"."daily_income_rule" TO fintrack_app;
--> statement-breakpoint
CREATE POLICY "daily_income_rule_owner" ON "fintrack"."daily_income_rule" AS PERMISSIVE FOR ALL TO fintrack_app
  USING ("owner_id" = (select fintrack.current_owner_id()))
  WITH CHECK ("owner_id" = (select fintrack.current_owner_id()));
--> statement-breakpoint
ALTER TABLE "fintrack"."monthly_income_rule" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON "fintrack"."monthly_income_rule" TO fintrack_app;
--> statement-breakpoint
CREATE POLICY "monthly_income_rule_owner" ON "fintrack"."monthly_income_rule" AS PERMISSIVE FOR ALL TO fintrack_app
  USING ("owner_id" = (select fintrack.current_owner_id()))
  WITH CHECK ("owner_id" = (select fintrack.current_owner_id()));
--> statement-breakpoint
ALTER TABLE "fintrack"."recurring_expense_rule" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON "fintrack"."recurring_expense_rule" TO fintrack_app;
--> statement-breakpoint
CREATE POLICY "recurring_expense_rule_owner" ON "fintrack"."recurring_expense_rule" AS PERMISSIVE FOR ALL TO fintrack_app
  USING ("owner_id" = (select fintrack.current_owner_id()))
  WITH CHECK ("owner_id" = (select fintrack.current_owner_id()));
--> statement-breakpoint
ALTER TABLE "fintrack"."recurring_expense_rule_revision" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "fintrack"."recurring_expense_rule_revision" TO fintrack_app;
--> statement-breakpoint
CREATE POLICY "recurring_expense_rule_revision_owner" ON "fintrack"."recurring_expense_rule_revision" AS PERMISSIVE FOR ALL TO fintrack_app
  USING ("owner_id" = (select fintrack.current_owner_id()))
  WITH CHECK ("owner_id" = (select fintrack.current_owner_id()));
