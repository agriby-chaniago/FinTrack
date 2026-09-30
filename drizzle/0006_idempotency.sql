CREATE TABLE "fintrack"."idempotency_record" (
	"owner_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_record_owner_id_key_pk" PRIMARY KEY("owner_id","key"),
	CONSTRAINT "idempotency_record_key_check" CHECK (char_length("fintrack"."idempotency_record"."key") between 8 and 128)
);
--> statement-breakpoint
ALTER TABLE "fintrack"."idempotency_record" ADD CONSTRAINT "idempotency_record_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "fintrack"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fintrack"."idempotency_record" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON "fintrack"."idempotency_record" TO fintrack_app;
--> statement-breakpoint
CREATE POLICY "idempotency_record_owner" ON "fintrack"."idempotency_record" AS PERMISSIVE FOR ALL TO fintrack_app
  USING ("owner_id" = (select fintrack.current_owner_id()))
  WITH CHECK ("owner_id" = (select fintrack.current_owner_id()));
