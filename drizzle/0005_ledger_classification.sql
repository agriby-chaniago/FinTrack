ALTER TABLE "fintrack"."ledger_entry" ADD COLUMN "event_class" text NOT NULL;--> statement-breakpoint
ALTER TABLE "fintrack"."ledger_entry" ADD COLUMN "movement_type" text;--> statement-breakpoint
ALTER TABLE "fintrack"."ledger_entry" ADD COLUMN "correction_role" text;--> statement-breakpoint
ALTER TABLE "fintrack"."ledger_entry" ADD COLUMN "corrects_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "fintrack"."ledger_entry" ADD COLUMN "corrected_kind" text;--> statement-breakpoint
ALTER TABLE "fintrack"."ledger_entry" ADD COLUMN "source_type" text;--> statement-breakpoint
ALTER TABLE "fintrack"."ledger_entry" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "fintrack"."ledger_entry" ADD CONSTRAINT "ledger_entry_corrects_entry_id_ledger_entry_id_fk" FOREIGN KEY ("corrects_entry_id") REFERENCES "fintrack"."ledger_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_entry_corrects_idx" ON "fintrack"."ledger_entry" USING btree ("corrects_entry_id");--> statement-breakpoint
CREATE INDEX "ledger_entry_source_idx" ON "fintrack"."ledger_entry" USING btree ("source_type","source_id");--> statement-breakpoint
ALTER TABLE "fintrack"."ledger_entry" ADD CONSTRAINT "ledger_entry_event_class_check" CHECK ("fintrack"."ledger_entry"."event_class" in ('MONTHLY_INCOME', 'OTHER_INCOME', 'SPECIAL_EXPENSE', 'RECURRING_EXPENSE', 'OTHER_EXPENSE', 'PERSONAL_TRANSFER', 'EXTERNAL_MOVEMENT', 'LIVING', 'ADJUSTMENT'));--> statement-breakpoint
ALTER TABLE "fintrack"."ledger_entry" ADD CONSTRAINT "ledger_entry_movement_type_check" CHECK (("fintrack"."ledger_entry"."kind" = 'EXTERNAL_MOVEMENT') = ("fintrack"."ledger_entry"."movement_type" is not null) or "fintrack"."ledger_entry"."kind" = 'CORRECTION_POSTING');--> statement-breakpoint
ALTER TABLE "fintrack"."ledger_entry" ADD CONSTRAINT "ledger_entry_correction_role_check" CHECK ("fintrack"."ledger_entry"."correction_role" is null or ("fintrack"."ledger_entry"."correction_role" in ('REVERSAL', 'REPLACEMENT') and "fintrack"."ledger_entry"."corrects_entry_id" is not null));--> statement-breakpoint
ALTER TABLE "fintrack"."ledger_entry" ADD CONSTRAINT "ledger_entry_correction_posting_check" CHECK (("fintrack"."ledger_entry"."kind" = 'CORRECTION_POSTING') = ("fintrack"."ledger_entry"."corrected_kind" is not null));--> statement-breakpoint
ALTER TABLE "fintrack"."ledger_entry" ADD CONSTRAINT "ledger_entry_special_category_check" CHECK (("fintrack"."ledger_entry"."event_class" = 'SPECIAL_EXPENSE') = ("fintrack"."ledger_entry"."category_id" is not null));