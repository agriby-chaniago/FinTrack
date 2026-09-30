// Correction of a confirmed opening snapshot through a superseding snapshot
// (PRD: Saldo awal, Correction dan reconciliation). No financial event is made.
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { parseIdrDecimal } from "@/lib/money";
import { ApiError } from "@/server/api/errors";
import type { OwnerTx } from "@/server/db/owner";
import {
  externalHolding,
  externalSubject,
  onboardingSnapshot,
  openingAccountPosition,
  openingExternalPosition,
} from "@/server/db/schema/onboarding";
import { negativeHoldingPositions } from "@/server/domain/ledger";
import { cleanDisplayName, normalizeName } from "@/server/domain/names";

import { lockLedger, orderedExternalEffects } from "./ledger";

const amount = z.string().refine((value) => {
  try {
    parseIdrDecimal(value);
    return true;
  } catch {
    return false;
  }
}, "INVALID_AMOUNT");

export const openingCorrectionSchema = z.object({
  accounts: z.array(z.object({ accountId: z.uuid(), physicalBalance: amount })).min(1),
  externals: z
    .array(z.object({ accountId: z.uuid(), subjectName: z.string().trim().min(1).max(80), amount }))
    .max(20),
});

export type OpeningCorrection = z.infer<typeof openingCorrectionSchema>;

export async function supersedeOpeningSnapshot(
  tx: OwnerTx,
  ownerId: string,
  expectedSnapshotId: string,
  input: unknown,
  now: Date,
): Promise<{ snapshotId: string; supersedesId: string }> {
  const parsed = openingCorrectionSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  }
  const correction = parsed.data;

  await lockLedger(tx, ownerId);

  const [current] = await tx
    .select()
    .from(onboardingSnapshot)
    .where(
      and(
        eq(onboardingSnapshot.ownerId, ownerId),
        eq(onboardingSnapshot.status, "CONFIRMED"),
        isNull(onboardingSnapshot.supersededById),
      ),
    )
    .for("update");
  if (!current) throw new ApiError("ONBOARDING_NOT_CONFIRMED");
  if (current.id !== expectedSnapshotId) throw new ApiError("STALE_VERSION");

  const currentPositions = await tx
    .select()
    .from(openingAccountPosition)
    .where(and(eq(openingAccountPosition.ownerId, ownerId), eq(openingAccountPosition.snapshotId, current.id)));
  const currentExternals = await tx
    .select({
      accountId: openingExternalPosition.accountId,
      holdingId: openingExternalPosition.holdingId,
      amount: openingExternalPosition.amountMinor,
    })
    .from(openingExternalPosition)
    .where(and(eq(openingExternalPosition.ownerId, ownerId), eq(openingExternalPosition.snapshotId, current.id)));

  const issues: string[] = [];
  const openingAccounts = new Set(currentPositions.map((position) => position.accountId));
  const correctedAccounts = new Set(correction.accounts.map((row) => row.accountId));
  if (
    openingAccounts.size !== correctedAccounts.size ||
    correction.accounts.length !== correctedAccounts.size ||
    [...openingAccounts].some((id) => !correctedAccounts.has(id))
  ) {
    issues.push("ACCOUNTS_MUST_MATCH_OPENING");
  }
  if (correction.accounts.some((row) => parseIdrDecimal(row.physicalBalance) < 0n)) issues.push("NEGATIVE_PHYSICAL_BALANCE");
  if (correction.externals.some((row) => parseIdrDecimal(row.amount) <= 0n)) issues.push("EXTERNAL_AMOUNT_MUST_BE_POSITIVE");
  if (correction.externals.some((row) => !openingAccounts.has(row.accountId))) issues.push("UNKNOWN_ACCOUNT");
  const externalKeys = correction.externals.map((row) => `${row.accountId}:${normalizeName(row.subjectName)}`);
  if (new Set(externalKeys).size !== externalKeys.length) issues.push("DUPLICATE_EXTERNAL_POSITION");
  if (issues.length > 0) throw new ApiError("VALIDATION_FAILED", { issues });

  // Reuse the subject's default holding; create subject and holding only when new.
  const holdingByName = new Map<string, string>();
  for (const row of correction.externals) {
    const normalized = normalizeName(row.subjectName);
    if (holdingByName.has(normalized)) continue;
    const [existing] = await tx
      .select({ holdingId: externalHolding.id })
      .from(externalSubject)
      .innerJoin(externalHolding, and(eq(externalHolding.subjectId, externalSubject.id), eq(externalHolding.isDefault, true)))
      .where(and(eq(externalSubject.ownerId, ownerId), eq(externalSubject.normalizedName, normalized)));
    if (existing) {
      holdingByName.set(normalized, existing.holdingId);
      continue;
    }
    const [subject] = await tx
      .insert(externalSubject)
      .values({ ownerId, displayName: cleanDisplayName(row.subjectName), normalizedName: normalized })
      .returning({ id: externalSubject.id });
    const [holding] = await tx
      .insert(externalHolding)
      .values({ ownerId, subjectId: subject.id, isDefault: true })
      .returning({ id: externalHolding.id });
    holdingByName.set(normalized, holding.id);
  }

  const newExternals = correction.externals.map((row) => ({
    accountId: row.accountId,
    holdingId: holdingByName.get(normalizeName(row.subjectName))!,
    amount: parseIdrDecimal(row.amount),
  }));

  const sameAccounts = correction.accounts.every(
    (row) => currentPositions.find((p) => p.accountId === row.accountId)?.physicalBalanceMinor === parseIdrDecimal(row.physicalBalance),
  );
  const externalSignature = (rows: { accountId: string; holdingId: string; amount: bigint }[]) =>
    rows.map((row) => `${row.accountId}:${row.holdingId}:${row.amount}`).sort().join("|");
  if (sameAccounts && externalSignature(newExternals) === externalSignature(currentExternals)) {
    throw new ApiError("VALIDATION_FAILED", { issues: ["NO_CHANGE"] });
  }

  // Later external movements must still leave every holding non-negative.
  const negative = negativeHoldingPositions(newExternals, await orderedExternalEffects(tx, ownerId));
  if (negative.length > 0) throw new ApiError("INVARIANT_VIOLATION", { negativeHoldings: negative });

  const snapshotId = crypto.randomUUID();
  // The superseded_by_id reference is deferred, so the old row can point at
  // the new one before it exists; the one-effective-snapshot index holds throughout.
  await tx
    .update(onboardingSnapshot)
    .set({ supersededById: snapshotId })
    .where(and(eq(onboardingSnapshot.id, current.id), eq(onboardingSnapshot.ownerId, ownerId)));
  await tx.insert(onboardingSnapshot).values({
    id: snapshotId,
    ownerId,
    status: "CONFIRMED",
    cutoverAt: current.cutoverAt,
    confirmedAt: now,
    supersedesId: current.id,
    draft: { correction, supersedes: current.id },
  });
  await tx.insert(openingAccountPosition).values(
    correction.accounts.map((row) => ({
      ownerId,
      snapshotId,
      accountId: row.accountId,
      physicalBalanceMinor: parseIdrDecimal(row.physicalBalance),
    })),
  );
  if (newExternals.length > 0) {
    await tx.insert(openingExternalPosition).values(
      newExternals.map((row) => ({ ownerId, snapshotId, accountId: row.accountId, holdingId: row.holdingId, amountMinor: row.amount })),
    );
  }

  // A different opening changes every settled DANA period after it; keep their
  // living contributions anchored to the confirmed closings (PRD: settled history).
  const { resyncSettlements } = await import("./settlement");
  const weekly = await tx.execute<{ account_id: string }>(sql`
    select distinct account_id from fintrack.daily_income_rule where owner_id = ${ownerId}`);
  for (const row of weekly) await resyncSettlements(tx, ownerId, row.account_id, "0001-01-01", now);

  return { snapshotId, supersedesId: current.id };
}
