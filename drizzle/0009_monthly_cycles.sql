CREATE TABLE "fintrack"."monthly_income_occurrence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"cycle_key" text NOT NULL,
	"expected_amount_minor" bigint NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_income_occurrence_cycle_check" CHECK (cycle_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "fintrack"."occurrence_resolution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"occurrence_type" text NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"entry_id" uuid,
	"supersedes_id" uuid,
	"superseded_by_id" uuid,
	"recorded_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "occurrence_resolution_type_check" CHECK ("fintrack"."occurrence_resolution"."occurrence_type" in ('MONTHLY_INCOME', 'RECURRING_EXPENSE')),
	CONSTRAINT "occurrence_resolution_outcome_check" CHECK (("fintrack"."occurrence_resolution"."occurrence_type" = 'MONTHLY_INCOME' and "fintrack"."occurrence_resolution"."outcome" in ('CONFIRMED', 'NOT_RECEIVED'))
        or ("fintrack"."occurrence_resolution"."occurrence_type" = 'RECURRING_EXPENSE' and "fintrack"."occurrence_resolution"."outcome" in ('CONFIRMED', 'NOT_CHARGED'))),
	CONSTRAINT "occurrence_resolution_entry_check" CHECK (("fintrack"."occurrence_resolution"."outcome" = 'CONFIRMED') = ("fintrack"."occurrence_resolution"."entry_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "fintrack"."recurring_expense_occurrence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"cycle_key" text NOT NULL,
	"expected_day" smallint,
	"expected_amount_minor" bigint,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_expense_occurrence_cycle_check" CHECK (cycle_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "fintrack"."monthly_income_occurrence" ADD CONSTRAINT "monthly_income_occurrence_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "fintrack"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."monthly_income_occurrence" ADD CONSTRAINT "monthly_income_occurrence_rule_id_monthly_income_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "fintrack"."monthly_income_rule"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."occurrence_resolution" ADD CONSTRAINT "occurrence_resolution_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "fintrack"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."occurrence_resolution" ADD CONSTRAINT "occurrence_resolution_entry_id_ledger_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "fintrack"."ledger_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."occurrence_resolution" ADD CONSTRAINT "occurrence_resolution_supersedes_id_occurrence_resolution_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "fintrack"."occurrence_resolution"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."occurrence_resolution" ADD CONSTRAINT "occurrence_resolution_superseded_by_id_occurrence_resolution_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "fintrack"."occurrence_resolution"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."recurring_expense_occurrence" ADD CONSTRAINT "recurring_expense_occurrence_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "fintrack"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."recurring_expense_occurrence" ADD CONSTRAINT "recurring_expense_occurrence_rule_id_recurring_expense_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "fintrack"."recurring_expense_rule"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_income_occurrence_uq" ON "fintrack"."monthly_income_occurrence" USING btree ("rule_id","cycle_key");--> statement-breakpoint
CREATE UNIQUE INDEX "occurrence_resolution_current_uq" ON "fintrack"."occurrence_resolution" USING btree ("occurrence_type","occurrence_id") WHERE "fintrack"."occurrence_resolution"."superseded_by_id" is null;--> statement-breakpoint
CREATE INDEX "occurrence_resolution_occurrence_idx" ON "fintrack"."occurrence_resolution" USING btree ("occurrence_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_expense_occurrence_uq" ON "fintrack"."recurring_expense_occurrence" USING btree ("rule_id","cycle_key");--> statement-breakpoint
ALTER TABLE "fintrack"."occurrence_resolution"
  ALTER CONSTRAINT "occurrence_resolution_superseded_by_id_occurrence_resolution_id_fk" DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "fintrack"."monthly_income_occurrence" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON "fintrack"."monthly_income_occurrence" TO fintrack_app;
--> statement-breakpoint
CREATE POLICY "monthly_income_occurrence_owner" ON "fintrack"."monthly_income_occurrence" AS PERMISSIVE FOR ALL TO fintrack_app
  USING ("owner_id" = (select fintrack.current_owner_id()))
  WITH CHECK ("owner_id" = (select fintrack.current_owner_id()));
--> statement-breakpoint
ALTER TABLE "fintrack"."recurring_expense_occurrence" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON "fintrack"."recurring_expense_occurrence" TO fintrack_app;
--> statement-breakpoint
CREATE POLICY "recurring_expense_occurrence_owner" ON "fintrack"."recurring_expense_occurrence" AS PERMISSIVE FOR ALL TO fintrack_app
  USING ("owner_id" = (select fintrack.current_owner_id()))
  WITH CHECK ("owner_id" = (select fintrack.current_owner_id()));
--> statement-breakpoint
ALTER TABLE "fintrack"."occurrence_resolution" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ("superseded_by_id") ON "fintrack"."occurrence_resolution" TO fintrack_app;
--> statement-breakpoint
CREATE POLICY "occurrence_resolution_owner" ON "fintrack"."occurrence_resolution" AS PERMISSIVE FOR ALL TO fintrack_app
  USING ("owner_id" = (select fintrack.current_owner_id()))
  WITH CHECK ("owner_id" = (select fintrack.current_owner_id()));
--> statement-breakpoint
-- Rules end or change only prospectively: the runtime may set last cycles, never rewrite history.
GRANT UPDATE ("last_expected_cycle") ON "fintrack"."monthly_income_rule" TO fintrack_app;
--> statement-breakpoint
GRANT UPDATE ("last_cycle") ON "fintrack"."recurring_expense_rule" TO fintrack_app;
