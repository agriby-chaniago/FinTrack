CREATE TABLE "fintrack"."account_activation_position" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"physical_balance_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_activation_position_nonnegative_check" CHECK ("fintrack"."account_activation_position"."physical_balance_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "fintrack"."account" DROP CONSTRAINT "account_type_check";--> statement-breakpoint
ALTER TABLE "fintrack"."account" ADD COLUMN "settlement_account_id" uuid;--> statement-breakpoint
ALTER TABLE "fintrack"."settlement" ADD COLUMN "cash_closing_physical_minor" bigint;--> statement-breakpoint
ALTER TABLE "fintrack"."settlement" ADD COLUMN "cash_closing_confirmation_id" uuid;--> statement-breakpoint
ALTER TABLE "fintrack"."settlement" ADD COLUMN "cash_activation_minor" bigint;--> statement-breakpoint
ALTER TABLE "fintrack"."account_activation_position" ADD CONSTRAINT "account_activation_position_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "fintrack"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."account_activation_position" ADD CONSTRAINT "account_activation_position_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "fintrack"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_activation_position_account_uq" ON "fintrack"."account_activation_position" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "fintrack"."account" ADD CONSTRAINT "account_settlement_account_id_account_id_fk" FOREIGN KEY ("settlement_account_id") REFERENCES "fintrack"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."settlement" ADD CONSTRAINT "settlement_cash_closing_confirmation_id_balance_confirmation_id_fk" FOREIGN KEY ("cash_closing_confirmation_id") REFERENCES "fintrack"."balance_confirmation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_one_settlement_member_uq" ON "fintrack"."account" USING btree ("owner_id") WHERE "fintrack"."account"."settlement_account_id" is not null;--> statement-breakpoint
ALTER TABLE "fintrack"."account" ADD CONSTRAINT "account_settlement_account_check" CHECK ("fintrack"."account"."settlement_account_id" is null or "fintrack"."account"."settlement_account_id" <> "fintrack"."account"."id");--> statement-breakpoint
ALTER TABLE "fintrack"."account" ADD CONSTRAINT "account_type_check" CHECK ("fintrack"."account"."account_type" in ('BANK', 'E_WALLET', 'CASH'));--> statement-breakpoint
ALTER TABLE "fintrack"."settlement" ADD CONSTRAINT "settlement_cash_nonnegative_check" CHECK (("fintrack"."settlement"."cash_closing_physical_minor" is null or "fintrack"."settlement"."cash_closing_physical_minor" >= 0) and ("fintrack"."settlement"."cash_activation_minor" is null or "fintrack"."settlement"."cash_activation_minor" >= 0));--> statement-breakpoint
-- Opening positions of later-activated accounts are append-only, like onboarding positions.
ALTER TABLE "fintrack"."account_activation_position" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON "fintrack"."account_activation_position" TO fintrack_app;
--> statement-breakpoint
CREATE POLICY "account_activation_position_owner" ON "fintrack"."account_activation_position" AS PERMISSIVE FOR ALL TO fintrack_app
  USING ("owner_id" = (select fintrack.current_owner_id()))
  WITH CHECK ("owner_id" = (select fintrack.current_owner_id()));
