CREATE TABLE "fintrack"."ledger_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"effective_business_date" date NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reporting_classification" text,
	"category_id" uuid,
	"note" text,
	CONSTRAINT "ledger_entry_kind_check" CHECK ("fintrack"."ledger_entry"."kind" in ('INCOME', 'EXPENSE', 'TRANSFER', 'EXTERNAL_MOVEMENT', 'CORRECTION_POSTING', 'BALANCE_ADJUSTMENT', 'SETTLEMENT_LIVING_CONTRIBUTION')),
	CONSTRAINT "ledger_entry_classification_check" CHECK ("fintrack"."ledger_entry"."reporting_classification" is null or "fintrack"."ledger_entry"."reporting_classification" in ('OTHER_GIFT_INCOME', 'OWNERSHIP_OUTFLOW')),
	CONSTRAINT "ledger_entry_note_length_check" CHECK ("fintrack"."ledger_entry"."note" is null or char_length("fintrack"."ledger_entry"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "fintrack"."ledger_leg" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"physical_effect_minor" bigint NOT NULL,
	"external_effect_minor" bigint DEFAULT 0 NOT NULL,
	"holding_id" uuid,
	CONSTRAINT "ledger_leg_not_empty_check" CHECK ("fintrack"."ledger_leg"."physical_effect_minor" <> 0 or "fintrack"."ledger_leg"."external_effect_minor" <> 0),
	CONSTRAINT "ledger_leg_holding_check" CHECK (("fintrack"."ledger_leg"."external_effect_minor" = 0) = ("fintrack"."ledger_leg"."holding_id" is null))
);
--> statement-breakpoint
ALTER TABLE "fintrack"."ledger_entry" ADD CONSTRAINT "ledger_entry_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "fintrack"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."ledger_entry" ADD CONSTRAINT "ledger_entry_category_id_special_expense_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "fintrack"."special_expense_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."ledger_leg" ADD CONSTRAINT "ledger_leg_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "fintrack"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."ledger_leg" ADD CONSTRAINT "ledger_leg_entry_id_ledger_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "fintrack"."ledger_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."ledger_leg" ADD CONSTRAINT "ledger_leg_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "fintrack"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."ledger_leg" ADD CONSTRAINT "ledger_leg_holding_id_external_holding_id_fk" FOREIGN KEY ("holding_id") REFERENCES "fintrack"."external_holding"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_entry_canonical_idx" ON "fintrack"."ledger_entry" USING btree ("owner_id","effective_business_date","recorded_at","id");--> statement-breakpoint
CREATE INDEX "ledger_leg_entry_idx" ON "fintrack"."ledger_leg" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "ledger_leg_account_idx" ON "fintrack"."ledger_leg" USING btree ("owner_id","account_id");--> statement-breakpoint
-- The ledger is append-only for the runtime role: SELECT and INSERT only.
ALTER TABLE "fintrack"."ledger_entry" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON "fintrack"."ledger_entry" TO fintrack_app;
--> statement-breakpoint
CREATE POLICY "ledger_entry_owner" ON "fintrack"."ledger_entry" AS PERMISSIVE FOR ALL TO fintrack_app
  USING ("owner_id" = (select fintrack.current_owner_id()))
  WITH CHECK ("owner_id" = (select fintrack.current_owner_id()));
--> statement-breakpoint
ALTER TABLE "fintrack"."ledger_leg" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON "fintrack"."ledger_leg" TO fintrack_app;
--> statement-breakpoint
CREATE POLICY "ledger_leg_owner" ON "fintrack"."ledger_leg" AS PERMISSIVE FOR ALL TO fintrack_app
  USING ("owner_id" = (select fintrack.current_owner_id()))
  WITH CHECK ("owner_id" = (select fintrack.current_owner_id()));
--> statement-breakpoint
-- A superseding opening snapshot points the old row at a new row created in
-- the same transaction, so this reference is checked at commit.
ALTER TABLE "fintrack"."onboarding_snapshot"
  ALTER CONSTRAINT "onboarding_snapshot_superseded_by_id_onboarding_snapshot_id_fk" DEFERRABLE INITIALLY DEFERRED;
