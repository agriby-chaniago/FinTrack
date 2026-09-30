import { sql } from "drizzle-orm";
import { bigint, check, date, index, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

import { account, externalHolding, specialExpenseCategory } from "./onboarding";
import { appOwner, fintrack } from "./platform";

const minor = (name: string) => bigint(name, { mode: "bigint" });

/**
 * Append-only confirmed ledger entry. Drafts never live here; corrections add
 * new entries instead of changing old ones (PRD: Correction dan reconciliation).
 */
export const ledgerEntry = fintrack.table(
  "ledger_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => appOwner.id),
    kind: text("kind").notNull(),
    effectiveBusinessDate: date("effective_business_date", { mode: "string" }).notNull(),
    // Millisecond precision so the value round-trips exactly through JavaScript
    // Date when used as an as-of reference (PRD v0.18 inclusion rule).
    recordedAt: timestamp("recorded_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    reportingClassification: text("reporting_classification"),
    categoryId: uuid("category_id").references(() => specialExpenseCategory.id),
    note: text("note"),
    /** Reporting group used by metrics (PRD: Metrics dan perhitungan). */
    eventClass: text("event_class").notNull(),
    /** External movement subtype (receipt, return, owner-use, move, conversions). */
    movementType: text("movement_type"),
    /** REVERSAL or REPLACEMENT of `correctsEntryId` for open-period corrections. */
    correctionRole: text("correction_role"),
    correctsEntryId: uuid("corrects_entry_id").references((): AnyPgColumn => ledgerEntry.id),
    /** For CORRECTION_POSTING: the kind of the settled record being corrected. */
    correctedKind: text("corrected_kind"),
    /** Feature record that produced this entry, e.g. a settlement or an occurrence resolution. */
    sourceType: text("source_type"),
    sourceId: uuid("source_id"),
  },
  (t) => [
    check(
      "ledger_entry_kind_check",
      sql`${t.kind} in ('INCOME', 'EXPENSE', 'TRANSFER', 'EXTERNAL_MOVEMENT', 'CORRECTION_POSTING', 'BALANCE_ADJUSTMENT', 'SETTLEMENT_LIVING_CONTRIBUTION')`,
    ),
    check(
      "ledger_entry_classification_check",
      sql`${t.reportingClassification} is null or ${t.reportingClassification} in ('OTHER_GIFT_INCOME', 'OWNERSHIP_OUTFLOW')`,
    ),
    check("ledger_entry_note_length_check", sql`${t.note} is null or char_length(${t.note}) <= 500`),
    check(
      "ledger_entry_event_class_check",
      sql`${t.eventClass} in ('MONTHLY_INCOME', 'OTHER_INCOME', 'SPECIAL_EXPENSE', 'RECURRING_EXPENSE', 'OTHER_EXPENSE', 'PERSONAL_TRANSFER', 'EXTERNAL_MOVEMENT', 'LIVING', 'ADJUSTMENT')`,
    ),
    check(
      "ledger_entry_movement_type_check",
      sql`(${t.kind} = 'EXTERNAL_MOVEMENT') = (${t.movementType} is not null) or ${t.kind} = 'CORRECTION_POSTING'`,
    ),
    check(
      "ledger_entry_correction_role_check",
      sql`${t.correctionRole} is null or (${t.correctionRole} in ('REVERSAL', 'REPLACEMENT') and ${t.correctsEntryId} is not null)`,
    ),
    check(
      "ledger_entry_correction_posting_check",
      sql`(${t.kind} = 'CORRECTION_POSTING') = (${t.correctedKind} is not null)`,
    ),
    check(
      "ledger_entry_special_category_check",
      sql`(${t.eventClass} = 'SPECIAL_EXPENSE') = (${t.categoryId} is not null)`,
    ),
    index("ledger_entry_corrects_idx").on(t.correctsEntryId),
    index("ledger_entry_source_idx").on(t.sourceType, t.sourceId),
    // Canonical ledger order (PRD v0.18): business date, recorded time, id.
    index("ledger_entry_canonical_idx").on(t.ownerId, t.effectiveBusinessDate, t.recordedAt, t.id),
  ],
);

/** Account effects of an entry. personal_effect = physical_effect − external_effect. */
export const ledgerLeg = fintrack.table(
  "ledger_leg",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => appOwner.id),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => ledgerEntry.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => account.id),
    physicalEffectMinor: minor("physical_effect_minor").notNull(),
    externalEffectMinor: minor("external_effect_minor").notNull().default(sql`0`),
    holdingId: uuid("holding_id").references(() => externalHolding.id),
  },
  (t) => [
    check(
      "ledger_leg_not_empty_check",
      sql`${t.physicalEffectMinor} <> 0 or ${t.externalEffectMinor} <> 0`,
    ),
    check(
      "ledger_leg_holding_check",
      sql`(${t.externalEffectMinor} = 0) = (${t.holdingId} is null)`,
    ),
    index("ledger_leg_entry_idx").on(t.entryId),
    index("ledger_leg_account_idx").on(t.ownerId, t.accountId),
  ],
);
