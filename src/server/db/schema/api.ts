import { sql } from "drizzle-orm";
import { check, integer, jsonb, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { appOwner, fintrack } from "./platform";

/**
 * Stored result of a successful financial mutation keyed by the client's
 * Idempotency-Key, so a retried request replays instead of posting twice.
 */
export const idempotencyRecord = fintrack.table(
  "idempotency_record",
  {
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => appOwner.id),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.key] }),
    check("idempotency_record_key_check", sql`char_length(${t.key}) between 8 and 128`),
  ],
);
