-- The daily backup records which migrations produced the dumped schema, so a
-- restore can refuse a target at a different migration level (PRD: Backup).
GRANT USAGE ON SCHEMA "drizzle" TO fintrack_backup;
--> statement-breakpoint
GRANT SELECT ON "drizzle"."__drizzle_migrations" TO fintrack_backup;
