// Actual transfers, logical transfer targets with immutable versions, and
// oldest-first allocation of personal components (PRD: Available, saved, dan retained).
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { cycleKeyOf } from "@/lib/business-time";
import { parseIdrDecimal, toIdrDecimal } from "@/lib/money";
import { ApiError } from "@/server/api/errors";
import { businessDate, cutoverDayAnswer, note, positiveAmount } from "@/server/api/schemas";
import type { OwnerTx } from "@/server/db/owner";
import { ledgerLeg } from "@/server/db/schema/ledger";
import { account, dailyIncomeRule, externalHolding, monthlyAccountSetting, monthlyIncomeRule, ownerSetting } from "@/server/db/schema/onboarding";
import { transferAllocation, transferTarget, transferTargetVersion } from "@/server/db/schema/transfers";
import type { LedgerEntryDraft, LedgerLeg } from "@/server/domain/ledger";

import { requireActiveCashAccounts } from "./accounts";
import { accountBalances, postLedgerEntry, type CutoverDayAnswer, type PostResult } from "./ledger";

export type Route = { sourceAccountId: string; destinationAccountId: string };
export type RouteKind = "DANA" | "BCA";
export type ContextType = "DANA_SETTLEMENT" | "BCA_CYCLE";
export type RetirementReason = "INCOME_NOT_RECEIVED" | "LIQUIDITY_WRITE_OFF";

/** Saving routes: weekly-settlement account → reserve (DANA) and monthly account → reserve (BCA). */
export async function routeKind(tx: OwnerTx, ownerId: string, route: Route): Promise<RouteKind | null> {
  const [setting] = await tx.select({ reserve: ownerSetting.reserveAccountId }).from(ownerSetting).where(eq(ownerSetting.ownerId, ownerId));
  if (!setting?.reserve || setting.reserve !== route.destinationAccountId) return null;
  const [daily] = await tx
    .select({ id: dailyIncomeRule.id })
    .from(dailyIncomeRule)
    .where(and(eq(dailyIncomeRule.ownerId, ownerId), eq(dailyIncomeRule.accountId, route.sourceAccountId)));
  if (daily) return "DANA";
  const [monthly] = await tx
    .select({ id: monthlyIncomeRule.id })
    .from(monthlyIncomeRule)
    .where(and(eq(monthlyIncomeRule.ownerId, ownerId), eq(monthlyIncomeRule.accountId, route.sourceAccountId)));
  return monthly ? "BCA" : null;
}

export async function reserveAccountId(tx: OwnerTx, ownerId: string): Promise<string> {
  const [setting] = await tx.select({ reserve: ownerSetting.reserveAccountId }).from(ownerSetting).where(eq(ownerSetting.ownerId, ownerId));
  if (!setting?.reserve) throw new ApiError("ONBOARDING_NOT_CONFIRMED");
  return setting.reserve;
}

/** Finds or creates the logical target for a context and route. */
export async function ensureTarget(
  tx: OwnerTx,
  ownerId: string,
  context: { contextType: ContextType; contextKey: string; contextOrder: string },
  route: Route,
): Promise<string> {
  await tx
    .insert(transferTarget)
    .values({ ownerId, ...context, ...route })
    .onConflictDoNothing();
  const [row] = await tx
    .select({ id: transferTarget.id })
    .from(transferTarget)
    .where(
      and(
        eq(transferTarget.ownerId, ownerId),
        eq(transferTarget.contextType, context.contextType),
        eq(transferTarget.contextKey, context.contextKey),
        eq(transferTarget.sourceAccountId, route.sourceAccountId),
        eq(transferTarget.destinationAccountId, route.destinationAccountId),
      ),
    );
  return row.id;
}

export type VersionRow = typeof transferTargetVersion.$inferSelect;

export async function currentVersion(tx: OwnerTx, ownerId: string, targetId: string): Promise<VersionRow | undefined> {
  const [row] = await tx
    .select()
    .from(transferTargetVersion)
    .where(
      and(eq(transferTargetVersion.ownerId, ownerId), eq(transferTargetVersion.targetId, targetId), isNull(transferTargetVersion.supersededById)),
    );
  return row;
}

/** Freezes a new immutable version; any current version is superseded, never edited. */
export async function createTargetVersion(
  tx: OwnerTx,
  ownerId: string,
  targetId: string,
  version: { amount: bigint; basis: Record<string, unknown>; isActionable: boolean; retirementReason?: RetirementReason | null },
): Promise<string> {
  const previous = await currentVersion(tx, ownerId, targetId);
  const id = crypto.randomUUID();
  if (previous) {
    await tx
      .update(transferTargetVersion)
      .set({ supersededById: id })
      .where(and(eq(transferTargetVersion.id, previous.id), eq(transferTargetVersion.ownerId, ownerId)));
  }
  await tx.insert(transferTargetVersion).values({
    id,
    ownerId,
    targetId,
    amountMinor: version.amount < 0n ? 0n : version.amount,
    basis: version.basis,
    isActionable: version.isActionable,
    retirementReason: version.isActionable ? null : (version.retirementReason ?? "LIQUIDITY_WRITE_OFF"),
    supersedesId: previous?.id ?? null,
  });
  return id;
}

/** Linked confirmed amount = max(0, Σ signed allocation effects). */
export async function linkedAmounts(tx: OwnerTx, ownerId: string, targetIds: string[]): Promise<Map<string, bigint>> {
  if (targetIds.length === 0) return new Map();
  const rows = await tx
    .select({ targetId: transferAllocation.targetId, total: sql<string>`sum(${transferAllocation.sign} * ${transferAllocation.magnitudeMinor})::text` })
    .from(transferAllocation)
    .where(and(eq(transferAllocation.ownerId, ownerId), inArray(transferAllocation.targetId, targetIds)))
    .groupBy(transferAllocation.targetId);
  const result = new Map<string, bigint>();
  for (const row of rows) result.set(row.targetId, BigInt(row.total) < 0n ? 0n : BigInt(row.total));
  return result;
}

type RouteTarget = { id: string; contextType: string; contextKey: string; contextOrder: string; version: VersionRow | null; linked: bigint };

export async function routeTargets(tx: OwnerTx, ownerId: string, route: Route): Promise<RouteTarget[]> {
  const targets = await tx
    .select()
    .from(transferTarget)
    .where(
      and(
        eq(transferTarget.ownerId, ownerId),
        eq(transferTarget.sourceAccountId, route.sourceAccountId),
        eq(transferTarget.destinationAccountId, route.destinationAccountId),
      ),
    )
    .orderBy(asc(transferTarget.contextOrder), asc(transferTarget.createdAt));
  const ids = targets.map((target) => target.id);
  const versions = ids.length
    ? await tx
        .select()
        .from(transferTargetVersion)
        .where(and(eq(transferTargetVersion.ownerId, ownerId), inArray(transferTargetVersion.targetId, ids), isNull(transferTargetVersion.supersededById)))
    : [];
  const linked = await linkedAmounts(tx, ownerId, ids);
  return targets.map((target) => ({
    id: target.id,
    contextType: target.contextType,
    contextKey: target.contextKey,
    contextOrder: target.contextOrder,
    version: versions.find((version) => version.targetId === target.id) ?? null,
    linked: linked.get(target.id) ?? 0n,
  }));
}

export const remainingOf = (target: Pick<RouteTarget, "version" | "linked">): bigint => {
  if (!target.version?.isActionable) return 0n;
  const remaining = target.version.amountMinor - target.linked;
  return remaining > 0n ? remaining : 0n;
};

/** Remaining actionable targets on a route created before `beforeOrder` (prior outstanding). */
export async function priorOutstanding(tx: OwnerTx, ownerId: string, route: Route, beforeOrder: string): Promise<bigint> {
  return (await routeTargets(tx, ownerId, route))
    .filter((target) => target.contextOrder < beforeOrder)
    .reduce((sum, target) => sum + remainingOf(target), 0n);
}

async function insertAllocation(tx: OwnerTx, ownerId: string, entryId: string, targetId: string, magnitude: bigint, sign: 1 | -1) {
  if (magnitude <= 0n) return;
  await tx.insert(transferAllocation).values({ ownerId, entryId, targetId, magnitudeMinor: magnitude, sign });
}

/**
 * Oldest-first allocation of a confirmed personal component (PRD LOCKED):
 * remaining actionable targets are filled in order; any surplus goes to the
 * newest actionable target (EXCEEDS_SUGGESTION). Without an actionable target
 * a BCA transfer is attached early to its not-yet-ready cycle context, and a
 * DANA surplus stays unallocated.
 */
export async function allocatePersonalComponent(
  tx: OwnerTx,
  ownerId: string,
  entryId: string,
  route: Route,
  personal: bigint,
  date: string,
): Promise<void> {
  if (personal <= 0n) return;
  const kind = await routeKind(tx, ownerId, route);
  if (!kind) return;

  const targets = await routeTargets(tx, ownerId, route);
  const actionable = targets.filter((target) => target.version?.isActionable);
  let left = personal;
  for (const target of actionable) {
    const take = remainingOf(target) < left ? remainingOf(target) : left;
    await insertAllocation(tx, ownerId, entryId, target.id, take, 1);
    left -= take;
    if (left === 0n) return;
  }

  if (actionable.length > 0) {
    await insertAllocation(tx, ownerId, entryId, actionable[actionable.length - 1].id, left, 1);
    return;
  }

  if (kind === "BCA") {
    const cycle = cycleKeyOf(date);
    const targetId = await ensureTarget(tx, ownerId, { contextType: "BCA_CYCLE", contextKey: cycle, contextOrder: cycle }, route);
    if (!(await currentVersion(tx, ownerId, targetId))) await insertAllocation(tx, ownerId, entryId, targetId, left, 1);
  }
}

/** Negates every allocation of `originalEntryId` on behalf of its reversal. */
export async function reverseAllocations(tx: OwnerTx, ownerId: string, originalEntryId: string, reversalEntryId: string): Promise<void> {
  const rows = await tx
    .select()
    .from(transferAllocation)
    .where(and(eq(transferAllocation.ownerId, ownerId), eq(transferAllocation.entryId, originalEntryId)));
  for (const row of rows) await insertAllocation(tx, ownerId, reversalEntryId, row.targetId, row.magnitudeMinor, row.sign === 1 ? -1 : 1);
}

export const transferSchema = z.object({
  sourceAccountId: z.uuid(),
  destinationAccountId: z.uuid(),
  amount: positiveAmount,
  externalComponents: z.array(z.object({ subjectId: z.uuid(), amount: positiveAmount })).max(10).default([]),
  businessDate,
  note,
  cutoverDayAnswer,
});
export type TransferInput = z.infer<typeof transferSchema>;

export type ExternalComponent = { holdingId: string; amount: bigint };

/**
 * One provider transfer with its ownership composition: each external
 * component moves its holding; the residual is the personal component.
 */
export function transferDraft(route: Route, amount: bigint, components: ExternalComponent[], date: string): LedgerEntryDraft {
  const externalTotal = components.reduce((sum, component) => sum + component.amount, 0n);
  if (externalTotal > amount) throw new ApiError("VALIDATION_FAILED", { issues: ["EXTERNAL_EXCEEDS_TRANSFER"] });
  const legs: LedgerLeg[] = [];
  for (const component of components) {
    legs.push({ accountId: route.sourceAccountId, physicalEffect: -component.amount, externalEffect: -component.amount, holdingId: component.holdingId });
    legs.push({ accountId: route.destinationAccountId, physicalEffect: component.amount, externalEffect: component.amount, holdingId: component.holdingId });
  }
  const personal = amount - externalTotal;
  if (personal > 0n) {
    legs.push({ accountId: route.sourceAccountId, physicalEffect: -personal, externalEffect: 0n, holdingId: null });
    legs.push({ accountId: route.destinationAccountId, physicalEffect: personal, externalEffect: 0n, holdingId: null });
  }
  return { kind: "TRANSFER", eventClass: "PERSONAL_TRANSFER", effectiveBusinessDate: date, reportingClassification: null, legs };
}

/** Personal component of a transfer entry: personal effects landing on the destination. */
export function personalComponentOf(legs: readonly { accountId: string; physicalEffectMinor: bigint; externalEffectMinor: bigint }[], destination: string): bigint {
  return legs
    .filter((leg) => leg.accountId === destination)
    .reduce((sum, leg) => sum + leg.physicalEffectMinor - leg.externalEffectMinor, 0n);
}

export async function resolveComponents(tx: OwnerTx, ownerId: string, components: { subjectId: string; amount: string }[]): Promise<ExternalComponent[]> {
  const result: ExternalComponent[] = [];
  for (const component of components) {
    const [holding] = await tx
      .select({ id: externalHolding.id })
      .from(externalHolding)
      .where(and(eq(externalHolding.ownerId, ownerId), eq(externalHolding.subjectId, component.subjectId), eq(externalHolding.isDefault, true)));
    if (!holding) throw new ApiError("VALIDATION_FAILED", { issues: ["SUBJECT_NOT_FOUND"] });
    result.push({ holdingId: holding.id, amount: parseIdrDecimal(component.amount) });
  }
  if (new Set(result.map((component) => component.holdingId)).size !== result.length) {
    throw new ApiError("VALIDATION_FAILED", { issues: ["DUPLICATE_SUBJECT"] });
  }
  return result;
}

/** Records a completed provider transfer and allocates its personal component. */
export async function recordTransfer(tx: OwnerTx, ownerId: string, input: TransferInput, now: Date): Promise<PostResult> {
  const route = { sourceAccountId: input.sourceAccountId, destinationAccountId: input.destinationAccountId };
  if (route.sourceAccountId === route.destinationAccountId) throw new ApiError("VALIDATION_FAILED", { issues: ["SAME_ACCOUNT"] });
  await requireActiveCashAccounts(tx, ownerId, [route.sourceAccountId, route.destinationAccountId]);
  const components = await resolveComponents(tx, ownerId, input.externalComponents);
  return postTransfer(tx, ownerId, route, parseIdrDecimal(input.amount), components, input.businessDate, {
    now,
    note: input.note ?? null,
    cutoverDayAnswer: input.cutoverDayAnswer,
  });
}

export async function postTransfer(
  tx: OwnerTx,
  ownerId: string,
  route: Route,
  amount: bigint,
  components: ExternalComponent[],
  date: string,
  options: { now: Date; note?: string | null; cutoverDayAnswer?: CutoverDayAnswer; correctsEntryId?: string },
): Promise<PostResult> {
  const draft = transferDraft(route, amount, components, date);
  const posted = await postLedgerEntry(
    tx,
    ownerId,
    options.correctsEntryId ? { ...draft, correctionRole: "REPLACEMENT", correctsEntryId: options.correctsEntryId } : draft,
    { now: options.now, note: options.note ?? null, cutoverDayAnswer: options.cutoverDayAnswer, deferHoldingCheck: Boolean(options.correctsEntryId) },
  );
  if (posted.recorded) {
    await allocatePersonalComponent(tx, ownerId, posted.entryId, route, amount - components.reduce((sum, c) => sum + c.amount, 0n), date);
  }
  return posted;
}

/** Loads the route and external composition of a stored transfer entry. */
export async function transferShape(tx: OwnerTx, ownerId: string, entryId: string) {
  const legs = await tx.select().from(ledgerLeg).where(and(eq(ledgerLeg.ownerId, ownerId), eq(ledgerLeg.entryId, entryId)));
  const source = legs.find((leg) => leg.physicalEffectMinor < 0n)!;
  const destination = legs.find((leg) => leg.physicalEffectMinor > 0n)!;
  const components = legs
    .filter((leg) => leg.accountId === destination.accountId && leg.holdingId)
    .map((leg) => ({ holdingId: leg.holdingId!, amount: leg.externalEffectMinor }));
  return { route: { sourceAccountId: source.accountId, destinationAccountId: destination.accountId }, components };
}

export type TargetProgress =
  | "PENDING_READINESS"
  | "NO_TRANSFER_NEEDED"
  | "NOT_TRANSFERRED"
  | "PARTIALLY_TRANSFERRED"
  | "FULLY_TRANSFERRED"
  | "EXCEEDS_SUGGESTION"
  | "CLOSED";

/** Derived progress (PRD table); never stored on a transfer. */
export function progressOf(target: Pick<RouteTarget, "version" | "linked">): TargetProgress {
  if (!target.version) return "PENDING_READINESS";
  if (!target.version.isActionable) return "CLOSED";
  const amount = target.version.amountMinor;
  if (amount === 0n) return target.linked > 0n ? "EXCEEDS_SUGGESTION" : "NO_TRANSFER_NEEDED";
  if (target.linked === 0n) return "NOT_TRANSFERRED";
  if (target.linked < amount) return "PARTIALLY_TRANSFERRED";
  return target.linked === amount ? "FULLY_TRANSFERRED" : "EXCEEDS_SUGGESTION";
}

export type TargetView = {
  id: string;
  contextType: string;
  contextKey: string;
  contextOrder: string;
  route: { sourceAccountId: string; sourceName: string; destinationAccountId: string; destinationName: string };
  version: { id: string; amount: string; isActionable: boolean; retirementReason: string | null; basis: unknown; createdAt: string } | null;
  linked: string;
  remaining: string;
  progress: TargetProgress;
};

export async function listTargets(tx: OwnerTx, ownerId: string): Promise<TargetView[]> {
  const accounts = await tx.select({ id: account.id, name: account.displayName }).from(account).where(eq(account.ownerId, ownerId));
  const names = new Map(accounts.map((row) => [row.id, row.name]));
  const routes = await tx
    .selectDistinct({ sourceAccountId: transferTarget.sourceAccountId, destinationAccountId: transferTarget.destinationAccountId })
    .from(transferTarget)
    .where(eq(transferTarget.ownerId, ownerId));
  const views: TargetView[] = [];
  for (const route of routes) {
    for (const target of await routeTargets(tx, ownerId, route)) {
      views.push({
        id: target.id,
        contextType: target.contextType,
        contextKey: target.contextKey,
        contextOrder: target.contextOrder,
        route: { ...route, sourceName: names.get(route.sourceAccountId)!, destinationName: names.get(route.destinationAccountId)! },
        version: target.version && {
          id: target.version.id,
          amount: toIdrDecimal(target.version.amountMinor),
          isActionable: target.version.isActionable,
          retirementReason: target.version.retirementReason,
          basis: target.version.basis,
          createdAt: target.version.createdAt.toISOString(),
        },
        linked: toIdrDecimal(target.linked),
        remaining: toIdrDecimal(remainingOf(target)),
        progress: progressOf(target),
      });
    }
  }
  return views.sort((a, b) => (a.contextOrder < b.contextOrder ? -1 : a.contextOrder > b.contextOrder ? 1 : 0));
}

/**
 * `Tutup target` (PRD v0.18): an explicit, final write-off of an actionable
 * target that can no longer be fulfilled. Allocations and transfers stay.
 */
export async function closeTarget(tx: OwnerTx, ownerId: string, targetId: string): Promise<void> {
  const [target] = await tx.select().from(transferTarget).where(and(eq(transferTarget.ownerId, ownerId), eq(transferTarget.id, targetId)));
  if (!target) throw new ApiError("NOT_FOUND");
  const version = await currentVersion(tx, ownerId, targetId);
  const linked = (await linkedAmounts(tx, ownerId, [targetId])).get(targetId) ?? 0n;
  if (!version || !version.isActionable || remainingOf({ version, linked }) === 0n) {
    throw new ApiError("VALIDATION_FAILED", { issues: ["TARGET_NOT_CLOSABLE"] });
  }
  await createTargetVersion(tx, ownerId, targetId, {
    amount: version.amountMinor,
    basis: version.basis as Record<string, unknown>,
    isActionable: false,
    retirementReason: "LIQUIDITY_WRITE_OFF",
  });
}

/**
 * Operational "transfer sekarang" suggestion per saving route: remaining
 * actionable targets capped by the current personal source balance above the
 * operational floor (DANA Rp0; BCA the retained floor).
 */
export async function transferSuggestions(tx: OwnerTx, ownerId: string) {
  const reserve = await reserveAccountId(tx, ownerId);
  const { accounts } = await accountBalances(tx, ownerId);
  const floors = await tx.select().from(monthlyAccountSetting).where(eq(monthlyAccountSetting.ownerId, ownerId));
  const suggestions = [];
  for (const balance of accounts) {
    if (balance.id === reserve) continue;
    const route = { sourceAccountId: balance.id, destinationAccountId: reserve };
    const kind = await routeKind(tx, ownerId, route);
    if (!kind) continue;
    const outstanding = (await routeTargets(tx, ownerId, route)).reduce((sum, target) => sum + remainingOf(target), 0n);
    const floor = kind === "BCA" ? (floors.find((row) => row.accountId === balance.id)?.retainedBalanceFloorMinor ?? 0n) : 0n;
    const available = parseIdrDecimal(balance.personal) - floor;
    const liquidity = available > 0n ? available : 0n;
    const transferNow = outstanding < liquidity ? outstanding : liquidity;
    suggestions.push({
      kind,
      route,
      sourceName: balance.displayName,
      outstanding: toIdrDecimal(outstanding),
      transferNow: toIdrDecimal(transferNow),
      /** Outstanding targets exceed what the source can currently cover. */
      liquidityWarning: outstanding > liquidity,
    });
  }
  return suggestions;
}
