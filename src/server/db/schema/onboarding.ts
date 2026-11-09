import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { appOwner, fintrack } from "./platform";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const ownerId = () =>
  uuid("owner_id")
    .notNull()
    .references(() => appOwner.id);
const minor = (name: string) => bigint(name, { mode: "bigint" });
const cyclePattern = "'^[0-9]{4}-(0[1-9]|1[0-2])$'";

/** Physical or logical location of money. Business rules reference ids, never names. */
export const account = fintrack.table(
  "account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    displayName: text("display_name").notNull(),
    providerName: text("provider_name").notNull(),
    accountType: text("account_type").notNull(),
    purposeLabel: text("purpose_label").notNull(),
    currency: text("currency").notNull().default("IDR"),
    isCashAccount: boolean("is_cash_account").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    /** Stable display order for account lists and dashboard cards. */
    sortOrder: integer("sort_order").notNull(),
    activationCutoverAt: timestamp("activation_cutover_at", { withTimezone: true }).notNull(),
    /**
     * Weekly account this account is settled together with (PRD v0.19: Tunai
     * belongs to the DANA settlement pool). Null for every other account.
     */
    settlementAccountId: uuid("settlement_account_id").references((): AnyPgColumn => account.id),
    createdAt: createdAt(),
  },
  (t) => [
    check("account_currency_idr_check", sql`${t.currency} = 'IDR'`),
    check("account_type_check", sql`${t.accountType} in ('BANK', 'E_WALLET', 'CASH')`),
    check("account_settlement_account_check", sql`${t.settlementAccountId} is null or ${t.settlementAccountId} <> ${t.id}`),
    index("account_owner_idx").on(t.ownerId),
    // At most one account per owner joins a weekly settlement pool (Tunai).
    uniqueIndex("account_one_settlement_member_uq").on(t.ownerId).where(sql`${t.settlementAccountId} is not null`),
  ],
);

export const specialExpenseCategory = fintrack.table(
  "special_expense_category",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    displayName: text("display_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("special_expense_category_owner_name_uq").on(t.ownerId, t.normalizedName)],
);

/** One row per owner for owner-wide workflow settings. */
export const ownerSetting = fintrack.table("owner_setting", {
  ownerId: uuid("owner_id")
    .primaryKey()
    .references(() => appOwner.id),
  defaultSpecialSourceAccountId: uuid("default_special_source_account_id").references(() => account.id),
  /** Destination of saving routes (DANA → reserve, BCA → reserve); initially Jago. */
  reserveAccountId: uuid("reserve_account_id").references(() => account.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Workflow setting for an account that receives monthly income (initially BCA). */
export const monthlyAccountSetting = fintrack.table(
  "monthly_account_setting",
  {
    accountId: uuid("account_id")
      .primaryKey()
      .references(() => account.id),
    ownerId: ownerId(),
    retainedBalanceFloorMinor: minor("retained_balance_floor_minor").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("monthly_account_setting_floor_check", sql`${t.retainedBalanceFloorMinor} >= 0`)],
);

export const externalSubject = fintrack.table(
  "external_subject",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    displayName: text("display_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("external_subject_owner_name_uq").on(t.ownerId, t.normalizedName)],
);

export const externalHolding = fintrack.table(
  "external_holding",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => externalSubject.id),
    isDefault: boolean("is_default").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("external_holding_default_uq").on(t.subjectId).where(sql`${t.isDefault}`)],
);

/**
 * Initial onboarding lifecycle. A DRAFT holds editable input as JSON; the
 * confirmed snapshot is immutable and corrected only by a superseding snapshot.
 */
export const onboardingSnapshot = fintrack.table(
  "onboarding_snapshot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    status: text("status").notNull(),
    cutoverAt: timestamp("cutover_at", { withTimezone: true }),
    draft: jsonb("draft").notNull(),
    version: integer("version").notNull().default(1),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => onboardingSnapshot.id),
    supersededById: uuid("superseded_by_id").references((): AnyPgColumn => onboardingSnapshot.id),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("onboarding_snapshot_status_check", sql`${t.status} in ('DRAFT', 'CONFIRMED')`),
    check(
      "onboarding_snapshot_confirmed_fields_check",
      sql`${t.status} = 'DRAFT' or (${t.cutoverAt} is not null and ${t.confirmedAt} is not null)`,
    ),
    uniqueIndex("onboarding_snapshot_one_draft_uq").on(t.ownerId).where(sql`${t.status} = 'DRAFT'`),
    uniqueIndex("onboarding_snapshot_one_effective_uq")
      .on(t.ownerId)
      .where(sql`${t.status} = 'CONFIRMED' and ${t.supersededById} is null`),
  ],
);

/** Opening physical balance per account; not a financial event. */
export const openingAccountPosition = fintrack.table(
  "opening_account_position",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => onboardingSnapshot.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => account.id),
    physicalBalanceMinor: minor("physical_balance_minor").notNull(),
  },
  (t) => [uniqueIndex("opening_account_position_uq").on(t.snapshotId, t.accountId)],
);

/**
 * Opening physical balance of an account activated after onboarding, as of its
 * `activation_cutover_at` (PRD: Account requirements). Immutable; not income.
 */
export const accountActivationPosition = fintrack.table(
  "account_activation_position",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => account.id),
    physicalBalanceMinor: minor("physical_balance_minor").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("account_activation_position_account_uq").on(t.accountId),
    check("account_activation_position_nonnegative_check", sql`${t.physicalBalanceMinor} >= 0`),
  ],
);

/** Opening external ownership per holding and account; not income. */
export const openingExternalPosition = fintrack.table(
  "opening_external_position",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => onboardingSnapshot.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => account.id),
    holdingId: uuid("holding_id")
      .notNull()
      .references(() => externalHolding.id),
    amountMinor: minor("amount_minor").notNull(),
  },
  (t) => [
    check("opening_external_position_amount_check", sql`${t.amountMinor} > 0`),
    uniqueIndex("opening_external_position_uq").on(t.snapshotId, t.accountId, t.holdingId),
  ],
);

/** Daily income definition. ACTIVE/PAUSED history arrives with the daily-income slice. */
export const dailyIncomeRule = fintrack.table(
  "daily_income_rule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => account.id),
    amountMinor: minor("amount_minor").notNull(),
    effectiveStartDate: date("effective_start_date", { mode: "string" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [check("daily_income_rule_amount_check", sql`${t.amountMinor} > 0`)],
);

export const monthlyIncomeRule = fintrack.table(
  "monthly_income_rule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => account.id),
    expectedAmountMinor: minor("expected_amount_minor").notNull(),
    firstExpectedCycle: text("first_expected_cycle").notNull(),
    lastExpectedCycle: text("last_expected_cycle"),
    createdAt: createdAt(),
  },
  (t) => [
    check("monthly_income_rule_amount_check", sql`${t.expectedAmountMinor} > 0`),
    check("monthly_income_rule_first_cycle_check", sql.raw(`first_expected_cycle ~ ${cyclePattern}`)),
    check(
      "monthly_income_rule_last_cycle_check",
      sql.raw(`last_expected_cycle is null or (last_expected_cycle ~ ${cyclePattern} and last_expected_cycle >= first_expected_cycle)`),
    ),
  ],
);

/** Subscription or bank-fee obligation on a monthly account. */
export const recurringExpenseRule = fintrack.table(
  "recurring_expense_rule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => account.id),
    kind: text("kind").notNull(),
    displayName: text("display_name").notNull(),
    firstCycle: text("first_cycle").notNull(),
    lastCycle: text("last_cycle"),
    createdAt: createdAt(),
  },
  (t) => [
    check("recurring_expense_rule_kind_check", sql`${t.kind} in ('SUBSCRIPTION', 'BANK_FEE')`),
    check("recurring_expense_rule_first_cycle_check", sql.raw(`first_cycle ~ ${cyclePattern}`)),
    check(
      "recurring_expense_rule_last_cycle_check",
      sql.raw(`last_cycle is null or (last_cycle ~ ${cyclePattern} and last_cycle >= first_cycle)`),
    ),
  ],
);

/** Effective-dated expected day/amount; a newer decision for the same cycle supersedes. */
export const recurringExpenseRuleRevision = fintrack.table(
  "recurring_expense_rule_revision",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => recurringExpenseRule.id),
    effectiveFromCycle: text("effective_from_cycle").notNull(),
    expectedDay: smallint("expected_day"),
    expectedAmountMinor: minor("expected_amount_minor"),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => recurringExpenseRuleRevision.id),
    supersededById: uuid("superseded_by_id").references((): AnyPgColumn => recurringExpenseRuleRevision.id),
    createdAt: createdAt(),
  },
  (t) => [
    check("recurring_expense_rule_revision_cycle_check", sql.raw(`effective_from_cycle ~ ${cyclePattern}`)),
    check(
      "recurring_expense_rule_revision_day_check",
      sql`${t.expectedDay} is null or ${t.expectedDay} between 1 and 31`,
    ),
    check(
      "recurring_expense_rule_revision_amount_check",
      sql`${t.expectedAmountMinor} is null or ${t.expectedAmountMinor} > 0`,
    ),
    uniqueIndex("recurring_expense_rule_revision_current_uq")
      .on(t.ruleId, t.effectiveFromCycle)
      .where(sql`${t.supersededById} is null`),
  ],
);
