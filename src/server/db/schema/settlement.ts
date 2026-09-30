import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, jsonb, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

import { account, dailyIncomeRule } from "./onboarding";
import { appOwner, fintrack } from "./platform";

const minor = (name: string) => bigint(name, { mode: "bigint" });
const ownerId = () =>
  uuid("owner_id")
    .notNull()
    .references(() => appOwner.id);
const ms = (name: string) => timestamp(name, { withTimezone: true, precision: 3 });

/**
 * Effective-dated ACTIVE/PAUSED change of a daily income rule. A cancelled
 * revision stays for history; state periods are derived, never stored.
 */
export const dailyIncomeStateTransition = fintrack.table(
  "daily_income_state_transition",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => dailyIncomeRule.id),
    toState: text("to_state").notNull(),
    effectiveDate: date("effective_date", { mode: "string" }).notNull(),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: ms("created_at").notNull().defaultNow(),
    cancelledAt: ms("cancelled_at"),
  },
  (t) => [
    check("daily_income_state_transition_state_check", sql`${t.toState} in ('ACTIVE', 'PAUSED')`),
    check("daily_income_state_transition_status_check", sql`${t.status} in ('ACTIVE', 'CANCELLED')`),
    uniqueIndex("daily_income_state_transition_date_uq").on(t.ruleId, t.effectiveDate).where(sql`${t.status} = 'ACTIVE'`),
  ],
);

/**
 * Sparse actual amount for an ACTIVE date; no current row means the default
 * amount was received. Rows are append-only: a change supersedes the current
 * row, and `amount_minor` null restores the default. Changes to settled dates
 * are flagged as corrections after settlement.
 */
export const dailyIncomeOverride = fintrack.table(
  "daily_income_override",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => dailyIncomeRule.id),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    amountMinor: minor("amount_minor"),
    afterSettlement: boolean("after_settlement").notNull().default(false),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => dailyIncomeOverride.id),
    supersededById: uuid("superseded_by_id").references((): AnyPgColumn => dailyIncomeOverride.id),
    recordedAt: ms("recorded_at").notNull().defaultNow(),
  },
  (t) => [
    check("daily_income_override_amount_check", sql`${t.amountMinor} is null or ${t.amountMinor} >= 0`),
    uniqueIndex("daily_income_override_current_uq").on(t.ruleId, t.businessDate).where(sql`${t.supersededById} is null`),
  ],
);

/**
 * Physical provider balance confirmed at a timestamp. Corrections add a
 * replacement that supersedes the old row (PRD: Reconciliation rules).
 */
export const balanceConfirmation = fintrack.table(
  "balance_confirmation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => account.id),
    physicalBalanceMinor: minor("physical_balance_minor").notNull(),
    asOf: ms("as_of").notNull(),
    source: text("source").notNull(),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => balanceConfirmation.id),
    supersededById: uuid("superseded_by_id").references((): AnyPgColumn => balanceConfirmation.id),
    recordedAt: ms("recorded_at").notNull().defaultNow(),
  },
  (t) => [
    check("balance_confirmation_source_check", sql`${t.source} in ('SETTLEMENT', 'MANUAL')`),
    index("balance_confirmation_account_idx").on(t.ownerId, t.accountId, t.asOf),
  ],
);

/**
 * Weekly (or partial/catch-up) DANA settlement. SETTLED rows are immutable and
 * keep every formula input in `snapshot` (PRD: Weekly settlement DANA).
 */
export const settlement = fintrack.table(
  "settlement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => account.id),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    status: text("status").notNull().default("DRAFT"),
    closingPhysicalMinor: minor("closing_physical_minor"),
    closingAt: ms("closing_at"),
    closingConfirmationId: uuid("closing_confirmation_id").references(() => balanceConfirmation.id),
    livingExpenseMinor: minor("living_expense_minor"),
    snapshot: jsonb("snapshot"),
    version: integer("version").notNull().default(1),
    settledAt: ms("settled_at"),
    createdAt: ms("created_at").notNull().defaultNow(),
    updatedAt: ms("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("settlement_status_check", sql`${t.status} in ('DRAFT', 'SETTLED')`),
    check("settlement_range_check", sql`${t.endDate} >= ${t.startDate}`),
    check(
      "settlement_settled_fields_check",
      sql`${t.status} = 'DRAFT' or (${t.closingConfirmationId} is not null and ${t.livingExpenseMinor} is not null and ${t.snapshot} is not null and ${t.settledAt} is not null)`,
    ),
    uniqueIndex("settlement_one_draft_uq").on(t.ownerId, t.accountId).where(sql`${t.status} = 'DRAFT'`),
    index("settlement_account_idx").on(t.ownerId, t.accountId, t.startDate),
  ],
);
