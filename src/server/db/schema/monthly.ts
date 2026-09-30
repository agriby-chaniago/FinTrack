import { sql } from "drizzle-orm";
import { bigint, check, index, smallint, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

import { ledgerEntry } from "./ledger";
import { monthlyIncomeRule, recurringExpenseRule } from "./onboarding";
import { appOwner, fintrack } from "./platform";

const minor = (name: string) => bigint(name, { mode: "bigint" });
const ownerId = () =>
  uuid("owner_id")
    .notNull()
    .references(() => appOwner.id);
const cycleCheck = (column: string) => sql.raw(`${column} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`);

/** Stable record of the monthly income expected in one cycle (created lazily, idempotently). */
export const monthlyIncomeOccurrence = fintrack.table(
  "monthly_income_occurrence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => monthlyIncomeRule.id),
    cycleKey: text("cycle_key").notNull(),
    expectedAmountMinor: minor("expected_amount_minor").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [check("monthly_income_occurrence_cycle_check", cycleCheck("cycle_key")), uniqueIndex("monthly_income_occurrence_uq").on(t.ruleId, t.cycleKey)],
);

/** Stable record of one obligation (subscription or bank fee) in one cycle with its expected snapshot. */
export const recurringExpenseOccurrence = fintrack.table(
  "recurring_expense_occurrence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => recurringExpenseRule.id),
    cycleKey: text("cycle_key").notNull(),
    expectedDay: smallint("expected_day"),
    expectedAmountMinor: minor("expected_amount_minor"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [check("recurring_expense_occurrence_cycle_check", cycleCheck("cycle_key")), uniqueIndex("recurring_expense_occurrence_uq").on(t.ruleId, t.cycleKey)],
);

/**
 * Append-only outcome of an occurrence. The latest non-superseded resolution
 * is the effective status; none means PENDING (PRD: Resolution occurrence).
 */
export const occurrenceResolution = fintrack.table(
  "occurrence_resolution",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    occurrenceType: text("occurrence_type").notNull(),
    occurrenceId: uuid("occurrence_id").notNull(),
    outcome: text("outcome").notNull(),
    entryId: uuid("entry_id").references(() => ledgerEntry.id),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => occurrenceResolution.id),
    supersededById: uuid("superseded_by_id").references((): AnyPgColumn => occurrenceResolution.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    check("occurrence_resolution_type_check", sql`${t.occurrenceType} in ('MONTHLY_INCOME', 'RECURRING_EXPENSE')`),
    check(
      "occurrence_resolution_outcome_check",
      sql`(${t.occurrenceType} = 'MONTHLY_INCOME' and ${t.outcome} in ('CONFIRMED', 'NOT_RECEIVED'))
        or (${t.occurrenceType} = 'RECURRING_EXPENSE' and ${t.outcome} in ('CONFIRMED', 'NOT_CHARGED'))`,
    ),
    check("occurrence_resolution_entry_check", sql`(${t.outcome} = 'CONFIRMED') = (${t.entryId} is not null)`),
    uniqueIndex("occurrence_resolution_current_uq").on(t.occurrenceType, t.occurrenceId).where(sql`${t.supersededById} is null`),
    index("occurrence_resolution_occurrence_idx").on(t.occurrenceId),
  ],
);
