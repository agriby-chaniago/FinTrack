// Settled-history corrections (PRD: CORRECTION_POSTING). The settled record
// and the as-settled snapshot stay; a delta posting on the original business
// date carries the corrected record kind, class, and legs.
import { and, eq, inArray, sql } from "drizzle-orm";

import { ApiError } from "@/server/api/errors";
import type { OwnerTx } from "@/server/db/owner";
import { ledgerEntry, ledgerLeg } from "@/server/db/schema/ledger";
import { transferAllocation } from "@/server/db/schema/transfers";
import { combineCorrectionLegs, type CorrectionLeg } from "@/server/domain/correction-legs";
import type { LedgerEntryDraft, LedgerLeg } from "@/server/domain/ledger";

import { weeklySettlementAccountIds } from "./accounts";
import type { CorrectionResult, LoadedEntry } from "./corrections";
import { assertExternalHoldingsNonNegative, postLedgerEntry } from "./ledger";
import { resyncSettlements, settledSettlementForRecord } from "./settlement";
import { allocatePersonalComponent, personalComponentOf, transferShape } from "./transfers";

/** The SETTLED settlement whose history contains this record, if any. */
export async function settledSettlementFor(tx: OwnerTx, ownerId: string, entry: LoadedEntry): Promise<string | null> {
  const weekly = await weeklySettlementAccountIds(tx, ownerId);
  const accounts = [...new Set(entry.legs.map((leg) => leg.accountId))].filter((id) => weekly.has(id));
  if (accounts.length === 0) return null;
  const found = await settledSettlementForRecord(tx, ownerId, accounts, entry.effectiveBusinessDate, entry.recordedAt);
  return found?.id ?? null;
}

export type SettledEntryEffects = { legs: CorrectionLeg[]; postingIds: string[] };

/** Original legs plus every earlier CORRECTION_POSTING delta: the record's current effect. */
export async function settledEntryEffects(tx: OwnerTx, ownerId: string, entry: LoadedEntry): Promise<SettledEntryEffects> {
  const postings = await tx
    .select({ id: ledgerEntry.id, categoryId: ledgerEntry.categoryId })
    .from(ledgerEntry)
    .where(and(eq(ledgerEntry.ownerId, ownerId), eq(ledgerEntry.correctsEntryId, entry.id), eq(ledgerEntry.kind, "CORRECTION_POSTING")));
  const postingIds = postings.map((row) => row.id);
  const deltaLegs = postingIds.length
    ? await tx.select().from(ledgerLeg).where(and(eq(ledgerLeg.ownerId, ownerId), inArray(ledgerLeg.entryId, postingIds)))
    : [];
  const categories = new Map(postings.map((posting) => [posting.id, posting.categoryId]));
  const legs = combineCorrectionLegs([...entry.legs, ...deltaLegs].map((leg) => ({
    accountId: leg.accountId,
    holdingId: leg.holdingId,
    physicalEffect: leg.physicalEffectMinor,
    externalEffect: leg.externalEffectMinor,
    categoryId: leg.entryId === entry.id ? entry.categoryId : (categories.get(leg.entryId) ?? null),
  })));
  return { legs, postingIds };
}

export async function correctSettledEntry(
  tx: OwnerTx,
  ownerId: string,
  entry: LoadedEntry,
  replacement: { draft: LedgerEntryDraft; categoryId: string | null } | null,
  now: Date,
  knownEffects?: SettledEntryEffects,
): Promise<CorrectionResult> {
  const { legs: current, postingIds } = knownEffects ?? await settledEntryEffects(tx, ownerId, entry);
  const deltas = combineCorrectionLegs([
    ...current.map((leg) => ({ ...leg, physicalEffect: -leg.physicalEffect, externalEffect: -leg.externalEffect })),
    ...(replacement?.draft.legs ?? []).map((leg) => ({ ...leg, categoryId: replacement!.categoryId })),
  ]);
  if (deltas.length === 0) throw new ApiError("VALIDATION_FAILED", { issues: ["NO_CHANGE"] });

  // A category change reverses the old category and applies the full corrected
  // effect to the new one. Both postings commit together, even when cash is unchanged.
  const byCategory = new Map<string | null, LedgerLeg[]>();
  for (const { categoryId, ...leg } of deltas) {
    byCategory.set(categoryId, [...(byCategory.get(categoryId) ?? []), { ...leg, holdingId: leg.externalEffect === 0n ? null : leg.holdingId }]);
  }
  const entryIds: string[] = [];
  for (const [categoryId, legs] of byCategory) {
    const posting = await postLedgerEntry(
      tx,
      ownerId,
      {
        kind: "CORRECTION_POSTING",
        eventClass: entry.eventClass as LedgerEntryDraft["eventClass"],
        correctedKind: entry.kind as LedgerEntryDraft["kind"],
        movementType: entry.movementType as LedgerEntryDraft["movementType"],
        reportingClassification: entry.reportingClassification as LedgerEntryDraft["reportingClassification"],
        correctsEntryId: entry.id,
        effectiveBusinessDate: entry.effectiveBusinessDate,
        legs,
      },
      { now, categoryId, cutoverDayAnswer: "NOT_IN_OPENING", deferHoldingCheck: true, skipSettlementResync: true },
    );
    if (!posting.recorded) throw new ApiError("INTERNAL_ERROR");
    entryIds.push(posting.entryId);
  }
  const allocationEntryId = entryIds[0];

  if (entry.eventClass === "PERSONAL_TRANSFER") {
    // Undo the net fulfillment of the original and its earlier postings, then allocate the corrected personal component.
    const net = await tx
      .select({ targetId: transferAllocation.targetId, total: sql<string>`sum(${transferAllocation.sign} * ${transferAllocation.magnitudeMinor})::text` })
      .from(transferAllocation)
      .where(and(eq(transferAllocation.ownerId, ownerId), inArray(transferAllocation.entryId, [entry.id, ...postingIds])))
      .groupBy(transferAllocation.targetId);
    for (const row of net) {
      const total = BigInt(row.total);
      if (total !== 0n) {
        await tx.insert(transferAllocation).values({
          ownerId,
          entryId: allocationEntryId,
          targetId: row.targetId,
          magnitudeMinor: total > 0n ? total : -total,
          sign: total > 0n ? -1 : 1,
        });
      }
    }
    if (replacement) {
      const shape = await transferShape(tx, ownerId, entry.id);
      const personal = personalComponentOf(
        replacement.draft.legs.map((leg) => ({ accountId: leg.accountId, physicalEffectMinor: leg.physicalEffect, externalEffectMinor: leg.externalEffect })),
        shape.route.destinationAccountId,
      );
      await allocatePersonalComponent(tx, ownerId, allocationEntryId, shape.route, personal, entry.effectiveBusinessDate);
    }
  }

  await assertExternalHoldingsNonNegative(tx, ownerId);
  const weekly = await weeklySettlementAccountIds(tx, ownerId);
  for (const accountId of new Set(deltas.map((leg) => leg.accountId))) {
    if (weekly.has(accountId)) await resyncSettlements(tx, ownerId, accountId, entry.effectiveBusinessDate, now);
  }
  return { mode: "SETTLED_HISTORY", entryIds };
}
