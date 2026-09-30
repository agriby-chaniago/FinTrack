// Onboarding use cases. Every function runs inside withOwnerDb() and filters by
// owner_id explicitly; RLS is an additional layer, not the authorization.
import { and, eq, isNull, sql } from "drizzle-orm";

import { parseIdrDecimal } from "@/lib/money";
import { ApiError } from "@/server/api/errors";
import type { OwnerTx } from "@/server/db/owner";
import {
  account,
  dailyIncomeRule,
  externalHolding,
  externalSubject,
  monthlyAccountSetting,
  monthlyIncomeRule,
  onboardingSnapshot,
  openingAccountPosition,
  openingExternalPosition,
  ownerSetting,
  recurringExpenseRule,
  recurringExpenseRuleRevision,
  specialExpenseCategory,
} from "@/server/db/schema/onboarding";
import { cleanDisplayName, normalizeName } from "@/server/domain/names";
import {
  automationBoundaries,
  confirmationIssues,
  defaultOnboardingDraft,
  onboardingDraftSchema,
  reviewOnboarding,
  serializeReview,
  type AccountKey,
  type OnboardingDraft,
} from "@/server/domain/onboarding";

export type OnboardingState =
  | { status: "NOT_STARTED" | "DRAFT"; version: number; draft: OnboardingDraft; review: ReturnType<typeof serializeReview> }
  | { status: "CONFIRMED"; snapshotId: string; cutoverAt: string; confirmedAt: string };

async function effectiveConfirmed(tx: OwnerTx, ownerId: string) {
  const [row] = await tx
    .select({ id: onboardingSnapshot.id, cutoverAt: onboardingSnapshot.cutoverAt, confirmedAt: onboardingSnapshot.confirmedAt })
    .from(onboardingSnapshot)
    .where(
      and(
        eq(onboardingSnapshot.ownerId, ownerId),
        eq(onboardingSnapshot.status, "CONFIRMED"),
        isNull(onboardingSnapshot.supersededById),
      ),
    );
  return row;
}

async function currentDraft(tx: OwnerTx, ownerId: string, options: { lock?: boolean } = {}) {
  const query = tx
    .select()
    .from(onboardingSnapshot)
    .where(and(eq(onboardingSnapshot.ownerId, ownerId), eq(onboardingSnapshot.status, "DRAFT")));
  const [row] = options.lock ? await query.for("update") : await query;
  return row;
}

function parseStoredDraft(value: unknown): OnboardingDraft {
  return onboardingDraftSchema.parse(value);
}

export async function getOnboardingState(tx: OwnerTx, ownerId: string, now: Date): Promise<OnboardingState> {
  const confirmed = await effectiveConfirmed(tx, ownerId);
  if (confirmed) {
    return {
      status: "CONFIRMED",
      snapshotId: confirmed.id,
      cutoverAt: confirmed.cutoverAt!.toISOString(),
      confirmedAt: confirmed.confirmedAt!.toISOString(),
    };
  }

  const draftRow = await currentDraft(tx, ownerId);
  const draft = draftRow ? parseStoredDraft(draftRow.draft) : defaultOnboardingDraft(now);
  return {
    status: draftRow ? "DRAFT" : "NOT_STARTED",
    version: draftRow?.version ?? 0,
    draft,
    review: serializeReview(reviewOnboarding(draft)),
  };
}

/** Creates or replaces the editable draft. `expectedVersion` 0 means "no draft yet". */
export async function saveOnboardingDraft(
  tx: OwnerTx,
  ownerId: string,
  input: unknown,
  expectedVersion: number,
): Promise<{ version: number; review: ReturnType<typeof serializeReview> }> {
  const parsed = onboardingDraftSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  }
  if (await effectiveConfirmed(tx, ownerId)) throw new ApiError("ONBOARDING_ALREADY_CONFIRMED");

  const existing = await currentDraft(tx, ownerId, { lock: true });
  const draft = parsed.data;
  let version: number;

  if (!existing) {
    if (expectedVersion !== 0) throw new ApiError("STALE_VERSION");
    const [row] = await tx
      .insert(onboardingSnapshot)
      .values({ ownerId, status: "DRAFT", draft, version: 1 })
      .returning({ version: onboardingSnapshot.version });
    version = row.version;
  } else {
    if (existing.version !== expectedVersion) throw new ApiError("STALE_VERSION");
    const [row] = await tx
      .update(onboardingSnapshot)
      .set({ draft, version: existing.version + 1, updatedAt: sql`now()` })
      .where(and(eq(onboardingSnapshot.id, existing.id), eq(onboardingSnapshot.ownerId, ownerId)))
      .returning({ version: onboardingSnapshot.version });
    version = row.version;
  }

  return { version, review: serializeReview(reviewOnboarding(draft)) };
}

export type ConfirmationSummary = {
  snapshotId: string;
  cutoverAt: string;
  accountIds: Record<AccountKey, string>;
  boundaries: ReturnType<typeof automationBoundaries>;
};

const amount = (value: string | null): bigint => parseIdrDecimal(value!);

/**
 * `Mulai FinTrack`: atomically confirms the opening snapshot and creates the
 * accounts, opening positions, external subjects/holdings, rules, workflow
 * settings, and the seeded `Vape` category. Nothing here is a financial event.
 */
export async function confirmOnboarding(
  tx: OwnerTx,
  ownerId: string,
  expectedVersion: number,
  now: Date,
): Promise<ConfirmationSummary> {
  if (await effectiveConfirmed(tx, ownerId)) throw new ApiError("ONBOARDING_ALREADY_CONFIRMED");
  const draftRow = await currentDraft(tx, ownerId, { lock: true });
  if (!draftRow) throw new ApiError("ONBOARDING_NOT_STARTED");
  if (draftRow.version !== expectedVersion) throw new ApiError("STALE_VERSION");

  const draft = parseStoredDraft(draftRow.draft);
  const issues = confirmationIssues(draft, now);
  if (issues.length > 0) throw new ApiError("VALIDATION_FAILED", { issues });

  const cutoverAt = new Date(draft.cutoverAt!);
  const boundaries = automationBoundaries(draft, cutoverAt);

  const accountIds = {} as Record<AccountKey, string>;
  for (const [index, definition] of draft.accounts.entries()) {
    const [row] = await tx
      .insert(account)
      .values({
        ownerId,
        sortOrder: (index + 1) * 10,
        displayName: cleanDisplayName(definition.displayName),
        providerName: cleanDisplayName(definition.providerName),
        accountType: definition.accountType,
        purposeLabel: cleanDisplayName(definition.purposeLabel),
        activationCutoverAt: cutoverAt,
      })
      .returning({ id: account.id });
    accountIds[definition.key] = row.id;
  }

  await tx
    .update(onboardingSnapshot)
    .set({ status: "CONFIRMED", cutoverAt, confirmedAt: now, updatedAt: sql`now()` })
    .where(and(eq(onboardingSnapshot.id, draftRow.id), eq(onboardingSnapshot.ownerId, ownerId)));

  await tx.insert(openingAccountPosition).values(
    draft.accounts.map((definition) => ({
      ownerId,
      snapshotId: draftRow.id,
      accountId: accountIds[definition.key],
      physicalBalanceMinor: amount(definition.physicalBalance),
    })),
  );

  // One subject per normalized name with its default holding (UI MVP).
  const holdingBySubject = new Map<string, string>();
  for (const external of draft.externals) {
    const normalized = normalizeName(external.subjectName);
    let holdingId = holdingBySubject.get(normalized);
    if (!holdingId) {
      const [subject] = await tx
        .insert(externalSubject)
        .values({ ownerId, displayName: cleanDisplayName(external.subjectName), normalizedName: normalized })
        .returning({ id: externalSubject.id });
      const [holding] = await tx
        .insert(externalHolding)
        .values({ ownerId, subjectId: subject.id, isDefault: true })
        .returning({ id: externalHolding.id });
      holdingId = holding.id;
      holdingBySubject.set(normalized, holdingId);
    }
    await tx.insert(openingExternalPosition).values({
      ownerId,
      snapshotId: draftRow.id,
      accountId: accountIds[external.accountKey],
      holdingId,
      amountMinor: amount(external.amount),
    });
  }

  const { routines } = draft;
  await tx.insert(dailyIncomeRule).values({
    ownerId,
    accountId: accountIds.daily,
    amountMinor: amount(routines.dailyIncome.amount),
    effectiveStartDate: boundaries.dailyIncomeStartDate,
  });

  await tx.insert(monthlyIncomeRule).values({
    ownerId,
    accountId: accountIds.monthly,
    expectedAmountMinor: amount(routines.monthlyIncome.expectedAmount),
    firstExpectedCycle: boundaries.monthlyIncomeFirstCycle,
  });

  // Recurring obligations belong to the monthly account, never the weekly-settlement account.
  const obligations = [
    ...routines.subscriptions.map((subscription, index) => ({
      kind: "SUBSCRIPTION" as const,
      displayName: cleanDisplayName(subscription.name),
      firstCycle: boundaries.subscriptionFirstCycles[index],
      expectedDay: subscription.expectedDay,
      expectedAmountMinor: amount(subscription.expectedAmount),
    })),
    {
      kind: "BANK_FEE" as const,
      displayName: "Biaya bulanan bank",
      firstCycle: boundaries.bankFeeFirstCycle,
      expectedDay: routines.bankFee.expectedDay,
      expectedAmountMinor: routines.bankFee.expectedAmount === null ? null : amount(routines.bankFee.expectedAmount),
    },
  ];
  for (const obligation of obligations) {
    const [rule] = await tx
      .insert(recurringExpenseRule)
      .values({
        ownerId,
        accountId: accountIds.monthly,
        kind: obligation.kind,
        displayName: obligation.displayName,
        firstCycle: obligation.firstCycle,
      })
      .returning({ id: recurringExpenseRule.id });
    await tx.insert(recurringExpenseRuleRevision).values({
      ownerId,
      ruleId: rule.id,
      effectiveFromCycle: obligation.firstCycle,
      expectedDay: obligation.expectedDay,
      expectedAmountMinor: obligation.expectedAmountMinor,
    });
  }

  await tx.insert(monthlyAccountSetting).values({
    ownerId,
    accountId: accountIds.monthly,
    retainedBalanceFloorMinor: amount(routines.retainedFloor),
  });
  await tx
    .insert(ownerSetting)
    .values({ ownerId, defaultSpecialSourceAccountId: accountIds.reserve })
    .onConflictDoUpdate({ target: ownerSetting.ownerId, set: { defaultSpecialSourceAccountId: accountIds.reserve } });
  await tx
    .insert(specialExpenseCategory)
    .values({ ownerId, displayName: "Vape", normalizedName: normalizeName("Vape") })
    .onConflictDoNothing();

  return { snapshotId: draftRow.id, cutoverAt: cutoverAt.toISOString(), accountIds, boundaries };
}
