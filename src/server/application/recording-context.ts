// Read models for the recording forms (Catat, Detail Akun, Koreksi saldo awal).
import { and, eq, isNull } from "drizzle-orm";

import { businessDateOf } from "@/lib/business-time";
import { toIdrDecimal } from "@/lib/money";
import { ApiError } from "@/server/api/errors";
import type { OwnerTx } from "@/server/db/owner";
import { account, externalHolding, externalSubject, onboardingSnapshot, openingAccountPosition, openingExternalPosition } from "@/server/db/schema/onboarding";

import { weeklySettlementAccountIds } from "./accounts";
import { listCategories } from "./events";
import { listExternalSubjects } from "./external-funds";
import { accountBalances } from "./ledger";
import { getSettings } from "./settings";

export type RecordingAccount = { id: string; name: string; physical: string; external: string; personal: string; weekly: boolean; reserve: boolean };

export type RecordingContext = {
  accounts: RecordingAccount[];
  defaultSpecialSourceAccountId: string | null;
  reserveAccountId: string | null;
  categories: { id: string; name: string }[];
  subjects: { id: string; name: string; total: string; isArchived: boolean; positions: { accountId: string; accountName: string; amount: string }[] }[];
  /** First business date that may be recorded (PRD: cutover rules). */
  cutoverDate: string;
};

async function currentSnapshot(tx: OwnerTx, ownerId: string) {
  const [row] = await tx
    .select()
    .from(onboardingSnapshot)
    .where(and(eq(onboardingSnapshot.ownerId, ownerId), eq(onboardingSnapshot.status, "CONFIRMED"), isNull(onboardingSnapshot.supersededById)));
  if (!row?.cutoverAt) throw new ApiError("ONBOARDING_NOT_CONFIRMED");
  return row;
}

export async function recordingContext(tx: OwnerTx, ownerId: string): Promise<RecordingContext> {
  const snapshot = await currentSnapshot(tx, ownerId);
  const settings = await getSettings(tx, ownerId);
  const weekly = await weeklySettlementAccountIds(tx, ownerId);
  const { accounts } = await accountBalances(tx, ownerId);
  return {
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.displayName,
      physical: a.physical,
      external: a.external,
      personal: a.personal,
      weekly: weekly.has(a.id),
      reserve: a.id === settings.reserveAccountId,
    })),
    defaultSpecialSourceAccountId: settings.defaultSpecialSourceAccountId,
    reserveAccountId: settings.reserveAccountId,
    categories: (await listCategories(tx, ownerId, { includeArchived: false })).map((c) => ({ id: c.id, name: c.displayName })),
    subjects: (await listExternalSubjects(tx, ownerId)).map((s) => ({ id: s.id, name: s.displayName, total: s.total, isArchived: s.isArchived, positions: s.positions })),
    cutoverDate: businessDateOf(snapshot.cutoverAt!),
  };
}

export type OpeningSnapshotView = {
  snapshotId: string;
  cutoverAt: string;
  confirmedAt: string;
  supersedesId: string | null;
  accounts: { accountId: string; name: string; physicalBalance: string }[];
  externals: { accountId: string; subjectName: string; amount: string }[];
};

/** The effective opening snapshot, for audit and for `Koreksi saldo awal`. */
export async function openingSnapshotView(tx: OwnerTx, ownerId: string): Promise<OpeningSnapshotView> {
  const snapshot = await currentSnapshot(tx, ownerId);
  const accounts = await tx
    .select({ accountId: openingAccountPosition.accountId, name: account.displayName, physical: openingAccountPosition.physicalBalanceMinor })
    .from(openingAccountPosition)
    .innerJoin(account, eq(account.id, openingAccountPosition.accountId))
    .where(and(eq(openingAccountPosition.ownerId, ownerId), eq(openingAccountPosition.snapshotId, snapshot.id)))
    .orderBy(account.sortOrder);
  const externals = await tx
    .select({ accountId: openingExternalPosition.accountId, subjectName: externalSubject.displayName, amount: openingExternalPosition.amountMinor })
    .from(openingExternalPosition)
    .innerJoin(externalHolding, eq(externalHolding.id, openingExternalPosition.holdingId))
    .innerJoin(externalSubject, eq(externalSubject.id, externalHolding.subjectId))
    .where(and(eq(openingExternalPosition.ownerId, ownerId), eq(openingExternalPosition.snapshotId, snapshot.id)))
    .orderBy(externalSubject.displayName);
  return {
    snapshotId: snapshot.id,
    cutoverAt: snapshot.cutoverAt!.toISOString(),
    confirmedAt: snapshot.confirmedAt!.toISOString(),
    supersedesId: snapshot.supersedesId,
    accounts: accounts.map((row) => ({ accountId: row.accountId, name: row.name, physicalBalance: toIdrDecimal(row.physical) })),
    externals: externals.map((row) => ({ accountId: row.accountId, subjectName: row.subjectName, amount: toIdrDecimal(row.amount) })),
  };
}
