// Settled-history corrections (PRD: CORRECTION_POSTING). The settled record
// and the as-settled snapshot stay; a delta posting on the original business
// date carries the corrected record kind, class, and legs.
import { and, eq, inArray, sql } from "drizzle-orm";

import { ApiError } from "@/server/api/errors";
import type { OwnerTx } from "@/server/db/owner";
import { ledgerEntry, ledgerLeg } from "@/server/db/schema/ledger";
import { transferAllocation } from "@/server/db/schema/transfers";
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

type LegKey = string;
const keyOf = (leg: { accountId: string; holdingId: string | null }): LegKey => `${leg.accountId}|${leg.holdingId ?? ""}`;

/** Original legs plus every earlier CORRECTION_POSTING delta: the record's current effect. */
async function effectiveLegs(tx: OwnerTx, ownerId: string, entry: LoadedEntry): Promise<{ legs: Map<LegKey, LedgerLeg>; postingIds: string[] }> {
  const postings = await tx
    .select({ id: ledgerEntry.id })
    .from(ledgerEntry)
    .where(and(eq(ledgerEntry.ownerId, ownerId), eq(ledgerEntry.correctsEntryId, entry.id), eq(ledgerEntry.kind, "CORRECTION_POSTING")));
  const postingIds = postings.map((row) => row.id);
  const deltaLegs = postingIds.length
    ? await tx.select().from(ledgerLeg).where(and(eq(ledgerLeg.ownerId, ownerId), inArray(ledgerLeg.entryId, postingIds)))
    : [];
  const legs = new Map<LegKey, LedgerLeg>();
  for (const leg of [...entry.legs, ...deltaLegs]) {
    const key = keyOf(leg);
    const current = legs.get(key) ?? { accountId: leg.accountId, holdingId: leg.holdingId, physicalEffect: 0n, externalEffect: 0n };
    legs.set(key, { ...current, physicalEffect: current.physicalEffect + leg.physicalEffectMinor, externalEffect: current.externalEffect + leg.externalEffectMinor });
  }
  return { legs, postingIds };
}

export async function correctSettledEntry(
  tx: OwnerTx,
  ownerId: string,
  entry: LoadedEntry,
  replacement: { draft: LedgerEntryDraft; categoryId: string | null } | null,
  now: Date,
): Promise<CorrectionResult> {
  const { legs: current, postingIds } = await effectiveLegs(tx, ownerId, entry);
  const desired = new Map<LegKey, LedgerLeg>();
  for (const leg of replacement?.draft.legs ?? []) {
    const key = keyOf(leg);
    const existing = desired.get(key) ?? { accountId: leg.accountId, holdingId: leg.holdingId, physicalEffect: 0n, externalEffect: 0n };
    desired.set(key, { ...existing, physicalEffect: existing.physicalEffect + leg.physicalEffect, externalEffect: existing.externalEffect + leg.externalEffect });
  }

  const deltas: LedgerLeg[] = [];
  for (const key of new Set([...current.keys(), ...desired.keys()])) {
    const from = current.get(key);
    const to = desired.get(key);
    const physical = (to?.physicalEffect ?? 0n) - (from?.physicalEffect ?? 0n);
    const external = (to?.externalEffect ?? 0n) - (from?.externalEffect ?? 0n);
    if (physical !== 0n || external !== 0n) {
      const base = (to ?? from)!;
      deltas.push({ accountId: base.accountId, holdingId: external === 0n ? null : base.holdingId, physicalEffect: physical, externalEffect: external });
    }
  }
  if (deltas.length === 0) throw new ApiError("VALIDATION_FAILED", { issues: ["NO_CHANGE"] });

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
      // Historical correction is effective on the original business date.
      effectiveBusinessDate: entry.effectiveBusinessDate,
      legs: deltas,
    },
    {
      now,
      categoryId: entry.eventClass === "SPECIAL_EXPENSE" ? (replacement?.categoryId ?? entry.categoryId) : null,
      cutoverDayAnswer: "NOT_IN_OPENING",
      deferHoldingCheck: true,
      skipSettlementResync: true,
    },
  );
  if (!posting.recorded) throw new ApiError("INTERNAL_ERROR");

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
          entryId: posting.entryId,
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
      await allocatePersonalComponent(tx, ownerId, posting.entryId, shape.route, personal, entry.effectiveBusinessDate);
    }
  }

  await assertExternalHoldingsNonNegative(tx, ownerId);
  const weekly = await weeklySettlementAccountIds(tx, ownerId);
  for (const accountId of new Set(deltas.map((leg) => leg.accountId))) {
    if (weekly.has(accountId)) await resyncSettlements(tx, ownerId, accountId, entry.effectiveBusinessDate, now);
  }
  return { mode: "SETTLED_HISTORY", entryIds: [posting.entryId] };
}
