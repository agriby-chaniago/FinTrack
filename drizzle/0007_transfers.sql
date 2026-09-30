CREATE TABLE "fintrack"."transfer_allocation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"magnitude_minor" bigint NOT NULL,
	"sign" smallint NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfer_allocation_magnitude_check" CHECK ("fintrack"."transfer_allocation"."magnitude_minor" > 0),
	CONSTRAINT "transfer_allocation_sign_check" CHECK ("fintrack"."transfer_allocation"."sign" in (1, -1))
);
--> statement-breakpoint
CREATE TABLE "fintrack"."transfer_target" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"context_type" text NOT NULL,
	"context_key" text NOT NULL,
	"context_order" text NOT NULL,
	"source_account_id" uuid NOT NULL,
	"destination_account_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfer_target_context_type_check" CHECK ("fintrack"."transfer_target"."context_type" in ('DANA_SETTLEMENT', 'BCA_CYCLE'))
);
--> statement-breakpoint
CREATE TABLE "fintrack"."transfer_target_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"basis" jsonb NOT NULL,
	"is_actionable" boolean NOT NULL,
	"retirement_reason" text,
	"supersedes_id" uuid,
	"superseded_by_id" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfer_target_version_amount_check" CHECK ("fintrack"."transfer_target_version"."amount_minor" >= 0),
	CONSTRAINT "transfer_target_version_retirement_check" CHECK (("fintrack"."transfer_target_version"."is_actionable" and "fintrack"."transfer_target_version"."retirement_reason" is null) or (not "fintrack"."transfer_target_version"."is_actionable" and "fintrack"."transfer_target_version"."retirement_reason" in ('INCOME_NOT_RECEIVED', 'LIQUIDITY_WRITE_OFF')))
);
--> statement-breakpoint
ALTER TABLE "fintrack"."owner_setting" ADD COLUMN "reserve_account_id" uuid;--> statement-breakpoint
ALTER TABLE "fintrack"."transfer_allocation" ADD CONSTRAINT "transfer_allocation_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "fintrack"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."transfer_allocation" ADD CONSTRAINT "transfer_allocation_entry_id_ledger_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "fintrack"."ledger_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."transfer_allocation" ADD CONSTRAINT "transfer_allocation_target_id_transfer_target_id_fk" FOREIGN KEY ("target_id") REFERENCES "fintrack"."transfer_target"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."transfer_target" ADD CONSTRAINT "transfer_target_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "fintrack"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."transfer_target" ADD CONSTRAINT "transfer_target_source_account_id_account_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "fintrack"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."transfer_target" ADD CONSTRAINT "transfer_target_destination_account_id_account_id_fk" FOREIGN KEY ("destination_account_id") REFERENCES "fintrack"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."transfer_target_version" ADD CONSTRAINT "transfer_target_version_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "fintrack"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."transfer_target_version" ADD CONSTRAINT "transfer_target_version_target_id_transfer_target_id_fk" FOREIGN KEY ("target_id") REFERENCES "fintrack"."transfer_target"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."transfer_target_version" ADD CONSTRAINT "transfer_target_version_supersedes_id_transfer_target_version_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "fintrack"."transfer_target_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."transfer_target_version" ADD CONSTRAINT "transfer_target_version_superseded_by_id_transfer_target_version_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "fintrack"."transfer_target_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transfer_allocation_target_idx" ON "fintrack"."transfer_allocation" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "transfer_allocation_entry_idx" ON "fintrack"."transfer_allocation" USING btree ("entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transfer_target_context_uq" ON "fintrack"."transfer_target" USING btree ("owner_id","context_type","context_key","source_account_id","destination_account_id");--> statement-breakpoint
CREATE INDEX "transfer_target_route_idx" ON "fintrack"."transfer_target" USING btree ("owner_id","source_account_id","destination_account_id","context_order");--> statement-breakpoint
CREATE UNIQUE INDEX "transfer_target_version_current_uq" ON "fintrack"."transfer_target_version" USING btree ("target_id") WHERE "fintrack"."transfer_target_version"."superseded_by_id" is null;--> statement-breakpoint
ALTER TABLE "fintrack"."owner_setting" ADD CONSTRAINT "owner_setting_reserve_account_id_account_id_fk" FOREIGN KEY ("reserve_account_id") REFERENCES "fintrack"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Existing owners: the reserve account is the initial default special-expense source.
UPDATE "fintrack"."owner_setting" SET "reserve_account_id" = "default_special_source_account_id" WHERE "reserve_account_id" IS NULL;
--> statement-breakpoint
-- A superseding version points the old row at a new row created in the same transaction.
ALTER TABLE "fintrack"."transfer_target_version"
  ALTER CONSTRAINT "transfer_target_version_superseded_by_id_transfer_target_version_id_fk" DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "fintrack"."transfer_target" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON "fintrack"."transfer_target" TO fintrack_app;
--> statement-breakpoint
CREATE POLICY "transfer_target_owner" ON "fintrack"."transfer_target" AS PERMISSIVE FOR ALL TO fintrack_app
  USING ("owner_id" = (select fintrack.current_owner_id()))
  WITH CHECK ("owner_id" = (select fintrack.current_owner_id()));
--> statement-breakpoint
ALTER TABLE "fintrack"."transfer_target_version" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- UPDATE only sets superseded_by_id when a newer version replaces this one.
GRANT SELECT, INSERT, UPDATE ("superseded_by_id") ON "fintrack"."transfer_target_version" TO fintrack_app;
--> statement-breakpoint
CREATE POLICY "transfer_target_version_owner" ON "fintrack"."transfer_target_version" AS PERMISSIVE FOR ALL TO fintrack_app
  USING ("owner_id" = (select fintrack.current_owner_id()))
  WITH CHECK ("owner_id" = (select fintrack.current_owner_id()));
--> statement-breakpoint
ALTER TABLE "fintrack"."transfer_allocation" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON "fintrack"."transfer_allocation" TO fintrack_app;
--> statement-breakpoint
CREATE POLICY "transfer_allocation_owner" ON "fintrack"."transfer_allocation" AS PERMISSIVE FOR ALL TO fintrack_app
  USING ("owner_id" = (select fintrack.current_owner_id()))
  WITH CHECK ("owner_id" = (select fintrack.current_owner_id()));
