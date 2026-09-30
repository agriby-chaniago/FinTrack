import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, jsonb, smallint, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

import { ledgerEntry } from "./ledger";
import { account } from "./onboarding";
import { appOwner, fintrack } from "./platform";

const minor = (name: string) => bigint(name, { mode: "bigint" });
const ownerId = () =>
  uuid("owner_id")
    .notNull()
    .references(() => appOwner.id);

/**
 * Logical, non-financial fulfillment context for one DANA settlement or BCA
 * cycle and one route (PRD: Transfer target). It is never deleted.
 */
export const transferTarget = fintrack.table(
  "transfer_target",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    contextType: text("context_type").notNull(),
    /** Settlement id (DANA) or cycle key `YYYY-MM` (BCA). */
    contextKey: text("context_key").notNull(),
    /** Chronological order within a route: settlement end date or cycle key. */
    contextOrder: text("context_order").notNull(),
    sourceAccountId: uuid("source_account_id")
      .notNull()
      .references(() => account.id),
    destinationAccountId: uuid("destination_account_id")
      .notNull()
      .references(() => account.id),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    check("transfer_target_context_type_check", sql`${t.contextType} in ('DANA_SETTLEMENT', 'BCA_CYCLE')`),
    uniqueIndex("transfer_target_context_uq").on(t.ownerId, t.contextType, t.contextKey, t.sourceAccountId, t.destinationAccountId),
    index("transfer_target_route_idx").on(t.ownerId, t.sourceAccountId, t.destinationAccountId, t.contextOrder),
  ],
);

/** Immutable suggestion amount with its frozen basis; corrections supersede it. */
export const transferTargetVersion = fintrack.table(
  "transfer_target_version",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    targetId: uuid("target_id")
      .notNull()
      .references(() => transferTarget.id),
    amountMinor: minor("amount_minor").notNull(),
    basis: jsonb("basis").notNull(),
    isActionable: boolean("is_actionable").notNull(),
    retirementReason: text("retirement_reason"),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => transferTargetVersion.id),
    supersededById: uuid("superseded_by_id").references((): AnyPgColumn => transferTargetVersion.id),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    check("transfer_target_version_amount_check", sql`${t.amountMinor} >= 0`),
    check(
      "transfer_target_version_retirement_check",
      sql`(${t.isActionable} and ${t.retirementReason} is null) or (not ${t.isActionable} and ${t.retirementReason} in ('INCOME_NOT_RECEIVED', 'LIQUIDITY_WRITE_OFF'))`,
    ),
    uniqueIndex("transfer_target_version_current_uq").on(t.targetId).where(sql`${t.supersededById} is null`),
  ],
);

/**
 * Fulfillment of a logical target by the personal component of a transfer
 * entry (or its reversal/replacement). Magnitude is positive; the sign follows
 * the transfer leg, so reversals subtract without mutating history.
 */
export const transferAllocation = fintrack.table(
  "transfer_allocation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => ledgerEntry.id),
    targetId: uuid("target_id")
      .notNull()
      .references(() => transferTarget.id),
    magnitudeMinor: minor("magnitude_minor").notNull(),
    sign: smallint("sign").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    check("transfer_allocation_magnitude_check", sql`${t.magnitudeMinor} > 0`),
    check("transfer_allocation_sign_check", sql`${t.sign} in (1, -1)`),
    index("transfer_allocation_target_idx").on(t.targetId),
    index("transfer_allocation_entry_idx").on(t.entryId),
  ],
);
