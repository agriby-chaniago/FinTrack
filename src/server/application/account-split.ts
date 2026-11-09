// Explicit split of a combined reserve. Historical ids and snapshots stay;
// a balanced internal transfer establishes the new spending account.
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { businessDateOf } from "@/lib/business-time";
import { parseIdrDecimal, toIdrDecimal } from "@/lib/money";
import { ApiError } from "@/server/api/errors";
import { nonNegativeAmount, positiveAmount } from "@/server/api/schemas";
import type { OwnerTx } from "@/server/db/owner";
import { account, accountActivationPosition, ownerSetting } from "@/server/db/schema/onboarding";

import { listExternalSubjects, type ExternalSubjectView } from "./external-funds";
import { accountBalances, lockLedger, postLedgerEntry, type AccountBalanceView } from "./ledger";
import { transferDraft } from "./transfers";

/**
 * Stable, namespaced UUID for this owner's split of this reserve. Keeping the
 * relationship in the existing account identity needs no schema extension and
 * does not depend on editable names, provider labels, or the expense default.
 * The namespace and version must remain stable once an owner confirms a split.
 */
function primaryAccountIdFor(ownerId: string, reserveId: string): string {
  const bytes = createHash("sha256").update(`fintrack:reserve-primary:v1:${ownerId}:${reserveId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** One query; the account list can offer setup without loading balances twice. */
export async function accountSplitStatus(tx: OwnerTx, ownerId: string) {
  const rows = await tx.select({
    reserveId: ownerSetting.reserveAccountId, accountId: account.id, providerName: account.providerName,
  }).from(ownerSetting).innerJoin(account, eq(account.ownerId, ownerId))
    .where(eq(ownerSetting.ownerId, ownerId));
  const reserve = rows.find((row) => row.accountId === row.reserveId);
  if (!reserve) throw new ApiError("ONBOARDING_NOT_CONFIRMED");
  const primaryId = primaryAccountIdFor(ownerId, reserve.accountId);
  return { reserveId: reserve.accountId, providerName: reserve.providerName, primaryId: rows.some((row) => row.accountId === primaryId) ? primaryId : null };
}

export async function accountSplitView(tx: OwnerTx, ownerId: string, loaded: { accounts?: AccountBalanceView[]; subjects?: ExternalSubjectView[] } = {}) {
  const status = await accountSplitStatus(tx, ownerId);
  const accounts = loaded.accounts ?? (await accountBalances(tx, ownerId)).accounts;
  const reserve = accounts.find((row) => row.id === status.reserveId);
  if (!reserve) throw new ApiError("NOT_FOUND");
  const subjects = loaded.subjects ?? await listExternalSubjects(tx, ownerId);
  const positions = subjects.flatMap((subject) => subject.positions.filter((p) => p.accountId === reserve.id)
    .map((p) => ({ subjectId: subject.id, holdingId: subject.holdingId, name: subject.displayName, amount: p.amount })))
    .sort((a, b) => a.subjectId.localeCompare(b.subjectId));
  const version = createHash("sha256").update(JSON.stringify([reserve.physical, reserve.external, positions])).digest("hex");
  return { ...status, reserveName: reserve.displayName, total: reserve.physical, external: reserve.external, personal: reserve.personal, positions, version };
}
export type AccountSplitView = Awaited<ReturnType<typeof accountSplitView>>;

export const splitAccountSchema = z.object({
  primaryBalance: nonNegativeAmount,
  version: z.string().regex(/^[a-f0-9]{64}$/),
  externalComponents: z.array(z.object({ subjectId: z.uuid(), amount: positiveAmount })).max(100).default([]),
});
export type SplitAccountInput = z.infer<typeof splitAccountSchema>;

export async function splitReserveAccount(tx: OwnerTx, ownerId: string, input: SplitAccountInput, now: Date) {
  await lockLedger(tx, ownerId);
  const view = await accountSplitView(tx, ownerId);
  if (view.primaryId) throw new ApiError("VALIDATION_FAILED", { issues: ["ACCOUNT_ALREADY_SPLIT"] });
  if (input.version !== view.version) throw new ApiError("STALE_VERSION");
  const total = parseIdrDecimal(view.total);
  const primary = parseIdrDecimal(input.primaryBalance);
  const external = parseIdrDecimal(view.external);
  if (primary > total || primary < 0n) throw new ApiError("VALIDATION_FAILED", { issues: ["SPLIT_EXCEEDS_TOTAL"] });
  if (external < 0n || total < external) throw new ApiError("VALIDATION_FAILED", { issues: ["SPLIT_RECONCILE_FIRST"] });
  if (new Set(input.externalComponents.map((c) => c.subjectId)).size !== input.externalComponents.length) {
    throw new ApiError("VALIDATION_FAILED", { issues: ["DUPLICATE_SUBJECT"] });
  }
  const components = input.externalComponents.map((component) => {
    const position = view.positions.find((p) => p.subjectId === component.subjectId);
    const amount = parseIdrDecimal(component.amount);
    if (!position || amount > parseIdrDecimal(position.amount)) throw new ApiError("VALIDATION_FAILED", { issues: ["SPLIT_EXTERNAL_EXCEEDS_POSITION"] });
    return { holdingId: position.holdingId, amount };
  });
  const movedExternal = components.reduce((sum, row) => sum + row.amount, 0n);
  if (movedExternal > primary || external - movedExternal > total - primary) {
    throw new ApiError("VALIDATION_FAILED", { issues: ["SPLIT_EXTERNAL_ALLOCATION"] });
  }
  const existing = await tx.select({ sortOrder: account.sortOrder }).from(account).where(eq(account.ownerId, ownerId));
  const [created] = await tx.insert(account).values({
    id: primaryAccountIdFor(ownerId, view.reserveId),
    ownerId, displayName: `${view.providerName} — Utama`, providerName: view.providerName, accountType: "BANK", purposeLabel: "Utama",
    sortOrder: Math.max(0, ...existing.map((a) => a.sortOrder)) + 10, activationCutoverAt: now,
  }).returning({ id: account.id });
  // Opening zero + one transfer: never duplicate money already recorded.
  await tx.insert(accountActivationPosition).values({ ownerId, accountId: created.id, physicalBalanceMinor: 0n });
  let entryId: string | null = null;
  if (primary > 0n) {
    const posted = await postLedgerEntry(tx, ownerId, {
      ...transferDraft({ sourceAccountId: view.reserveId, destinationAccountId: created.id }, primary, components, businessDateOf(now)),
      sourceType: "ACCOUNT_SPLIT", sourceId: created.id,
    }, { now, cutoverDayAnswer: "NOT_IN_OPENING", note: `Pemisahan saldo gabungan ${view.providerName}: porsi Utama. Riwayat sebelum ini masih gabungan.` });
    if (!posted.recorded) throw new ApiError("INTERNAL_ERROR");
    entryId = posted.entryId;
  }
  await tx.update(account).set({ displayName: `${view.providerName} — Tabungan`, purposeLabel: "Tabungan" })
    .where(and(eq(account.ownerId, ownerId), eq(account.id, view.reserveId)));
  await tx.update(ownerSetting).set({ defaultSpecialSourceAccountId: created.id, updatedAt: now })
    .where(eq(ownerSetting.ownerId, ownerId));
  return { primaryAccountId: created.id, reserveAccountId: view.reserveId, primaryBalance: toIdrDecimal(primary), savingsBalance: toIdrDecimal(total - primary), total: view.total, entryId };
}
