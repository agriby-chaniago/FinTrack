// Special expenses, reusable categories, and other actual income/expense
// (PRD: Special expense; Detail Akun `Catat income/expense lain`).
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { parseIdrDecimal } from "@/lib/money";
import { ApiError } from "@/server/api/errors";
import { businessDate, cutoverDayAnswer, note, positiveAmount } from "@/server/api/schemas";
import type { OwnerTx } from "@/server/db/owner";
import { specialExpenseCategory } from "@/server/db/schema/onboarding";
import type { LedgerEntryDraft } from "@/server/domain/ledger";
import { cleanDisplayName, normalizeName } from "@/server/domain/names";

import { requireActiveCashAccounts, weeklySettlementAccountIds } from "./accounts";
import { postLedgerEntry, type PostResult } from "./ledger";

const categoryName = z.string().trim().min(1).max(60);

export async function listCategories(tx: OwnerTx, ownerId: string, options: { includeArchived: boolean }) {
  const rows = await tx
    .select({ id: specialExpenseCategory.id, displayName: specialExpenseCategory.displayName, isArchived: specialExpenseCategory.isArchived })
    .from(specialExpenseCategory)
    .where(eq(specialExpenseCategory.ownerId, ownerId))
    .orderBy(asc(specialExpenseCategory.displayName));
  return options.includeArchived ? rows : rows.filter((row) => !row.isArchived);
}

/**
 * `Lainnya…`: creates a reusable category or reuses the existing one with the
 * same normalized name; `Lainnya…` itself is never stored.
 */
export async function createOrReuseCategory(tx: OwnerTx, ownerId: string, name: string): Promise<string> {
  const normalized = normalizeName(name);
  if (!normalized || normalized === normalizeName("Lainnya…") || normalized === "lainnya") {
    throw new ApiError("VALIDATION_FAILED", { issues: ["CATEGORY_NAME_RESERVED"] });
  }
  const [existing] = await tx
    .select({ id: specialExpenseCategory.id, isArchived: specialExpenseCategory.isArchived })
    .from(specialExpenseCategory)
    .where(and(eq(specialExpenseCategory.ownerId, ownerId), eq(specialExpenseCategory.normalizedName, normalized)));
  if (existing) {
    if (existing.isArchived) {
      await tx.update(specialExpenseCategory).set({ isArchived: false }).where(eq(specialExpenseCategory.id, existing.id));
    }
    return existing.id;
  }
  const id = crypto.randomUUID();
  await tx.insert(specialExpenseCategory).values({ id, ownerId, displayName: cleanDisplayName(name), normalizedName: normalized });
  return id;
}

export const categoryUpdateSchema = z
  .object({ displayName: categoryName.optional(), isArchived: z.boolean().optional() })
  .refine((value) => value.displayName !== undefined || value.isArchived !== undefined, "nothing to update");

/** Rename keeps the stable id and historical grouping; archive hides it from new forms only. */
export async function updateCategory(tx: OwnerTx, ownerId: string, id: string, input: z.infer<typeof categoryUpdateSchema>) {
  const [current] = await tx
    .select()
    .from(specialExpenseCategory)
    .where(and(eq(specialExpenseCategory.ownerId, ownerId), eq(specialExpenseCategory.id, id)));
  if (!current) throw new ApiError("NOT_FOUND");

  const changes: Partial<typeof specialExpenseCategory.$inferInsert> = {};
  if (input.displayName !== undefined) {
    const normalized = normalizeName(input.displayName);
    const [clash] = await tx
      .select({ id: specialExpenseCategory.id })
      .from(specialExpenseCategory)
      .where(and(eq(specialExpenseCategory.ownerId, ownerId), eq(specialExpenseCategory.normalizedName, normalized)));
    if (clash && clash.id !== id) throw new ApiError("VALIDATION_FAILED", { issues: ["DUPLICATE_NAME"] });
    changes.displayName = cleanDisplayName(input.displayName);
    changes.normalizedName = normalized;
  }
  if (input.isArchived !== undefined) changes.isArchived = input.isArchived;
  await tx.update(specialExpenseCategory).set(changes).where(eq(specialExpenseCategory.id, id));
}

async function requireActiveCategory(tx: OwnerTx, ownerId: string, id: string): Promise<string> {
  const [row] = await tx
    .select({ id: specialExpenseCategory.id, isArchived: specialExpenseCategory.isArchived })
    .from(specialExpenseCategory)
    .where(and(eq(specialExpenseCategory.ownerId, ownerId), eq(specialExpenseCategory.id, id)));
  if (!row || row.isArchived) throw new ApiError("VALIDATION_FAILED", { issues: ["CATEGORY_NOT_ACTIVE"] });
  return row.id;
}

export const specialExpenseSchema = z
  .object({
    amount: positiveAmount,
    categoryId: z.uuid().optional(),
    newCategoryName: categoryName.optional(),
    sourceAccountId: z.uuid(),
    businessDate,
    note,
    cutoverDayAnswer,
  })
  .refine((value) => Boolean(value.categoryId) !== Boolean(value.newCategoryName), "choose a category or name a new one");
export type SpecialExpenseInput = z.infer<typeof specialExpenseSchema>;

export function specialExpenseDraft(accountId: string, amount: bigint, date: string): LedgerEntryDraft {
  return {
    kind: "EXPENSE",
    eventClass: "SPECIAL_EXPENSE",
    effectiveBusinessDate: date,
    reportingClassification: null,
    legs: [{ accountId, physicalEffect: -amount, externalEffect: 0n, holdingId: null }],
  };
}

/**
 * Special expense from the actual source account (Jago is only the UI
 * default). Counted in special and total outflow, never in living cost.
 */
export async function recordSpecialExpense(tx: OwnerTx, ownerId: string, input: SpecialExpenseInput, now: Date): Promise<PostResult> {
  await requireActiveCashAccounts(tx, ownerId, [input.sourceAccountId]);
  const categoryId = input.categoryId
    ? await requireActiveCategory(tx, ownerId, input.categoryId)
    : await createOrReuseCategory(tx, ownerId, input.newCategoryName!);
  return postLedgerEntry(tx, ownerId, specialExpenseDraft(input.sourceAccountId, parseIdrDecimal(input.amount), input.businessDate), {
    now,
    categoryId,
    note: input.note ?? null,
    cutoverDayAnswer: input.cutoverDayAnswer,
  });
}

export const otherEventSchema = z.object({
  direction: z.enum(["INCOME", "EXPENSE"]),
  accountId: z.uuid(),
  amount: positiveAmount,
  businessDate,
  note,
  cutoverDayAnswer,
});
export type OtherEventInput = z.infer<typeof otherEventSchema>;

export function otherEventDraft(direction: "INCOME" | "EXPENSE", accountId: string, amount: bigint, date: string): LedgerEntryDraft {
  return {
    kind: direction,
    eventClass: direction === "INCOME" ? "OTHER_INCOME" : "OTHER_EXPENSE",
    effectiveBusinessDate: date,
    reportingClassification: null,
    legs: [{ accountId, physicalEffect: direction === "INCOME" ? amount : -amount, externalEffect: 0n, holdingId: null }],
  };
}

/**
 * Actual income or ordinary expense outside occurrences and special expense.
 * Ordinary expense on the weekly-settlement account is rejected: its living
 * cost comes from reconstruction, and anything else there is a special expense.
 */
export async function recordOtherEvent(tx: OwnerTx, ownerId: string, input: OtherEventInput, now: Date): Promise<PostResult> {
  await requireActiveCashAccounts(tx, ownerId, [input.accountId]);
  if (input.direction === "EXPENSE" && (await weeklySettlementAccountIds(tx, ownerId)).has(input.accountId)) {
    throw new ApiError("VALIDATION_FAILED", { issues: ["USE_SPECIAL_EXPENSE_FOR_WEEKLY_ACCOUNT"] });
  }
  return postLedgerEntry(tx, ownerId, otherEventDraft(input.direction, input.accountId, parseIdrDecimal(input.amount), input.businessDate), {
    now,
    note: input.note ?? null,
    cutoverDayAnswer: input.cutoverDayAnswer,
  });
}
