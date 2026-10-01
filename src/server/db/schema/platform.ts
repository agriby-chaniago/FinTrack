import { boolean, check, date, pgSchema, primaryKey, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Financial data lives in `fintrack`, which is never exposed through the Supabase Data API.
export const fintrack = pgSchema("fintrack");

// Non-financial operational relations (keepalive probe) live in `ops`.
export const ops = pgSchema("ops");

/**
 * Stable singleton data owner. `auth_user_id` is only an access binding to a
 * Supabase Auth user; financial records reference `app_owner.id`.
 */
export const appOwner = fintrack.table(
  "app_owner",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    singletonKey: boolean("singleton_key").notNull().default(true).unique(),
    authUserId: uuid("auth_user_id").unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    boundAt: timestamp("bound_at", { withTimezone: true }),
  },
  (table) => [check("app_owner_singleton_key_check", sql`${table.singletonKey}`)],
);

/** Single static row read by the production keepalive route. */
export const keepaliveProbe = ops.table(
  "keepalive_probe",
  {
    id: smallint("id").primaryKey(),
    label: text("label").notNull(),
  },
  (table) => [check("keepalive_probe_single_row_check", sql`${table.id} = 1`)],
);

/**
 * One row per business date on which the Telegram digest was sent (PRD v0.20 P6:
 * at most one per day). Operational, not financial; excluded from the export.
 */
export const reminderDelivery = fintrack.table(
  "reminder_delivery",
  {
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => appOwner.id),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.businessDate] })],
);
