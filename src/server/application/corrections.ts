// Corrections of confirmed records (PRD: Correction dan reconciliation). Open
// periods use a linked reversal and replacement (or a reversal-only void);
// settled history uses CORRECTION_POSTING through the settlement flow.
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { parseIdrDecimal } from "@/lib/money";
import { ApiError } from "@/server/api/errors";
import { businessDate, cutoverDayAnswer, note, positiveAmount } from "@/server/api/schemas";
import type { OwnerTx } from "@/server/db/owner";
import { ledgerEntry, ledgerLeg } from "@/server/db/schema/ledger";
import type { EventClass, LedgerEntryDraft, LedgerEntryKind, MovementType, ReportingClassification } from "@/server/domain/ledger";

import { requireActiveCashAccounts, weeklySettlementAccountIds } from "./accounts";
import { otherEventDraft, specialExpenseDraft, createOrReuseCategory } from "./events";
import { externalMovementDraft } from "./external-funds";
import { assertExternalHoldingsNonNegative, postLedgerEntry } from "./ledger";
import { postTransfer, resolveComponents, reverseAllocations, transferDraft, transferShape } from "./transfers";
import { correctSettledEntry, settledSettlementFor } from "./settlement-corrections";
import { sqlRows } from "@/server/db/rows";

export const correctionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("VOID") }),
  z.object({
    action: z.literal("REPLACE"),
    amount: positiveAmount,
    businessDate,
    note,
    accountId: z.uuid().optional(),
    categoryId: z.uuid().optional(),
    newCategoryName: z.string().trim().min(1).max(60).optional(),
    /** Transfers only: corrected external composition (defaults to the original). */
    externalComponents: z.array(z.object({ subjectId: z.uuid(), amount: positiveAmount })).max(10).optional(),
    cutoverDayAnswer,
  }),
]);
export type CorrectionInput = z.infer<typeof correctionSchema>;

const correctableClasses = new Set<EventClass>([
  "SPECIAL_EXPENSE",
  "OTHER_INCOME",
  "OTHER_EXPENSE",
  "EXTERNAL_MOVEMENT",
  "PERSONAL_TRANSFER",
  "MONTHLY_INCOME",
  "RECURRING_EXPENSE",
]);
const occurrenceClasses = new Set<EventClass>(["MONTHLY_INCOME", "RECURRING_EXPENSE"]);

export type LoadedEntry = typeof ledgerEntry.$inferSelect & { legs: (typeof ledgerLeg.$inferSelect)[] };

export async function loadEntry(tx: OwnerTx, ownerId: string, entryId: string): Promise<LoadedEntry> {
  const [entry] = await tx
    .select()
    .from(ledgerEntry)
    .where(and(eq(ledgerEntry.ownerId, ownerId), eq(ledgerEntry.id, entryId)));
  if (!entry) throw new ApiError("NOT_FOUND");
  const legs = await tx
    .select()
    .from(ledgerLeg)
    .where(and(eq(ledgerLeg.ownerId, ownerId), eq(ledgerLeg.entryId, entryId)));
  return { ...entry, legs };
}

/** A record is current when it is not a reversal and nothing has reversed it yet. */
export async function assertCurrentRecord(tx: OwnerTx, ownerId: string, entry: LoadedEntry): Promise<void> {
  if (entry.correctionRole === "REVERSAL" || entry.kind === "CORRECTION_POSTING") {
    throw new ApiError("VALIDATION_FAILED", { issues: ["NOT_A_CORRECTABLE_RECORD"] });
  }
  const [reversal] = await tx
    .select({ id: ledgerEntry.id })
    .from(ledgerEntry)
    .where(
      and(eq(ledgerEntry.ownerId, ownerId), eq(ledgerEntry.correctsEntryId, entry.id), eq(ledgerEntry.correctionRole, "REVERSAL")),
    );
  if (reversal) throw new ApiError("VALIDATION_FAILED", { issues: ["ALREADY_CORRECTED"] });
  // Settled records may receive further CORRECTION_POSTING deltas; those do not block.
}

/** Exact negation of a record, dated on the original business date. */
export function reversalDraft(entry: LoadedEntry): LedgerEntryDraft {
  return {
    kind: entry.kind as LedgerEntryKind,
    eventClass: entry.eventClass as EventClass,
    effectiveBusinessDate: entry.effectiveBusinessDate,
    reportingClassification: entry.reportingClassification as ReportingClassification | null,
    movementType: entry.movementType as MovementType | null,
    correctionRole: "REVERSAL",
    correctsEntryId: entry.id,
    legs: entry.legs.map((leg) => ({
      accountId: leg.accountId,
      physicalEffect: -leg.physicalEffectMinor,
      externalEffect: -leg.externalEffectMinor,
      holdingId: leg.holdingId,
    })),
  };
}

async function replacementFor(
  tx: OwnerTx,
  ownerId: string,
  entry: LoadedEntry,
  input: Extract<CorrectionInput, { action: "REPLACE" }>,
): Promise<{ draft: LedgerEntryDraft; categoryId: string | null }> {
  const amount = parseIdrDecimal(input.amount);
  const originalAccount = entry.legs[0].accountId;
  switch (entry.eventClass as EventClass) {
    case "SPECIAL_EXPENSE": {
      const accountId = input.accountId ?? originalAccount;
      await requireActiveCashAccounts(tx, ownerId, [accountId]);
      const categoryId = input.newCategoryName
        ? await createOrReuseCategory(tx, ownerId, input.newCategoryName)
        : (input.categoryId ?? entry.categoryId);
      return { draft: specialExpenseDraft(accountId, amount, input.businessDate), categoryId };
    }
    case "OTHER_INCOME":
    case "OTHER_EXPENSE": {
      const accountId = input.accountId ?? originalAccount;
      await requireActiveCashAccounts(tx, ownerId, [accountId]);
      if (entry.eventClass === "OTHER_EXPENSE" && (await weeklySettlementAccountIds(tx, ownerId)).has(accountId)) {
        throw new ApiError("VALIDATION_FAILED", { issues: ["USE_SPECIAL_EXPENSE_FOR_WEEKLY_ACCOUNT"] });
      }
      return { draft: otherEventDraft(entry.kind as "INCOME" | "EXPENSE", accountId, amount, input.businessDate), categoryId: null };
    }
    case "MONTHLY_INCOME":
    case "RECURRING_EXPENSE": {
      // Value correction of a confirmed occurrence keeps its account and resolution link.
      const direction = entry.kind as "INCOME" | "EXPENSE";
      const draft = otherEventDraft(direction, originalAccount, amount, input.businessDate);
      return {
        draft: { ...draft, eventClass: entry.eventClass as EventClass, sourceType: entry.sourceType, sourceId: entry.sourceId },
        categoryId: null,
      };
    }
    case "EXTERNAL_MOVEMENT": {
      // Subject, subtype, and accounts stay; amount, date, and note may change.
      const type = entry.movementType as MovementType;
      const from = entry.legs.find((leg) => leg.physicalEffectMinor < 0n) ?? entry.legs[0];
      const to = entry.legs.find((leg) => leg.physicalEffectMinor > 0n);
      const accounts = type === "INTERNAL_TRANSFER" ? { accountId: from.accountId, toAccountId: to!.accountId } : { accountId: originalAccount };
      return { draft: externalMovementDraft(type, entry.legs[0].holdingId!, accounts, amount, input.businessDate), categoryId: null };
    }
    default:
      throw new ApiError("VALIDATION_FAILED", { issues: ["NOT_A_CORRECTABLE_RECORD"] });
  }
}

export type CorrectionResult = { mode: "OPEN_PERIOD" | "SETTLED_HISTORY"; entryIds: string[] };

/**
 * `Koreksi` on a confirmed record. Nothing is edited: an open-period record
 * gets a linked reversal plus replacement (or only the reversal for a void);
 * a record inside a settled DANA period gets a CORRECTION_POSTING instead.
 */
export async function correctEntry(
  tx: OwnerTx,
  ownerId: string,
  entryId: string,
  input: CorrectionInput,
  now: Date,
  options: { allowOccurrenceVoid?: boolean } = {},
): Promise<CorrectionResult> {
  const entry = await loadEntry(tx, ownerId, entryId);
  await assertCurrentRecord(tx, ownerId, entry);
  if (!correctableClasses.has(entry.eventClass as EventClass)) {
    throw new ApiError("VALIDATION_FAILED", { issues: ["USE_DEDICATED_CORRECTION_FLOW"] });
  }
  // Event → no-event for occurrences goes through a superseding resolution (PRD).
  if (input.action === "VOID" && occurrenceClasses.has(entry.eventClass as EventClass) && !options.allowOccurrenceVoid) {
    throw new ApiError("VALIDATION_FAILED", { issues: ["USE_OCCURRENCE_RESOLUTION"] });
  }
  const result = await correctEntryInner(tx, ownerId, entry, input, now);
  // Corrections on a monthly account can change frozen BCA target bases.
  const { recalculateBcaChain } = await import("./monthly");
  const monthlyAccounts = await sqlRows<{ account_id: string }>(tx, sql`
    select distinct account_id from fintrack.monthly_income_rule where owner_id = ${ownerId}`);
  for (const { account_id } of monthlyAccounts) {
    if (entry.legs.some((leg) => leg.accountId === account_id)) await recalculateBcaChain(tx, ownerId, account_id);
  }
  return result;
}

async function correctEntryInner(tx: OwnerTx, ownerId: string, entry: LoadedEntry, input: CorrectionInput, now: Date): Promise<CorrectionResult> {

  if (entry.eventClass === "PERSONAL_TRANSFER") return correctTransfer(tx, ownerId, entry, input, now);

  const replacement = input.action === "REPLACE" ? await replacementFor(tx, ownerId, entry, input) : null;

  const settlementId = await settledSettlementFor(tx, ownerId, entry);
  if (settlementId) {
    return correctSettledEntry(tx, ownerId, entry, replacement, now);
  }

  const reversal = await postLedgerEntry(tx, ownerId, reversalDraft(entry), {
    now,
    categoryId: entry.categoryId,
    cutoverDayAnswer: "NOT_IN_OPENING",
    deferHoldingCheck: true,
  });
  const ids = reversal.recorded ? [reversal.entryId] : [];

  if (replacement && input.action === "REPLACE") {
    const posted = await postLedgerEntry(
      tx,
      ownerId,
      { ...replacement.draft, correctionRole: "REPLACEMENT", correctsEntryId: entry.id },
      { now, categoryId: replacement.categoryId, note: input.note ?? entry.note, cutoverDayAnswer: input.cutoverDayAnswer, deferHoldingCheck: true },
    );
    if (posted.recorded) ids.push(posted.entryId);
  }

  await assertExternalHoldingsNonNegative(tx, ownerId);
  return { mode: "OPEN_PERIOD", entryIds: ids };
}

/**
 * Transfer correction keeps route and history: the reversal also negates its
 * target allocations, and the replacement is allocated oldest-first again.
 */
async function correctTransfer(tx: OwnerTx, ownerId: string, entry: LoadedEntry, input: CorrectionInput, now: Date): Promise<CorrectionResult> {
  const shape = await transferShape(tx, ownerId, entry.id);
  const components =
    input.action === "REPLACE" && input.externalComponents
      ? await resolveComponents(tx, ownerId, input.externalComponents)
      : shape.components;

  if (await settledSettlementFor(tx, ownerId, entry)) {
    const replacement =
      input.action === "REPLACE"
        ? { draft: transferDraft(shape.route, parseIdrDecimal(input.amount), components, input.businessDate), categoryId: null }
        : null;
    return correctSettledEntry(tx, ownerId, entry, replacement, now);
  }

  const reversal = await postLedgerEntry(tx, ownerId, reversalDraft(entry), {
    now,
    cutoverDayAnswer: "NOT_IN_OPENING",
    deferHoldingCheck: true,
  });
  const ids: string[] = [];
  if (reversal.recorded) {
    ids.push(reversal.entryId);
    await reverseAllocations(tx, ownerId, entry.id, reversal.entryId);
  }
  if (input.action === "REPLACE") {
    const posted = await postTransfer(tx, ownerId, shape.route, parseIdrDecimal(input.amount), components, input.businessDate, {
      now,
      note: input.note ?? entry.note,
      cutoverDayAnswer: input.cutoverDayAnswer,
      correctsEntryId: entry.id,
    });
    if (posted.recorded) ids.push(posted.entryId);
  }
  await assertExternalHoldingsNonNegative(tx, ownerId);
  return { mode: "OPEN_PERIOD", entryIds: ids };
}
