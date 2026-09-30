// Ledger rules shared by every financial feature (PRD: Accounting invariants,
// Rumus agregat, Time rules). Pure functions only.
import { businessDateOf } from "@/lib/business-time";
import type { MinorUnits } from "@/lib/money";

export const ledgerEntryKinds = [
  "INCOME",
  "EXPENSE",
  "TRANSFER",
  "EXTERNAL_MOVEMENT",
  "CORRECTION_POSTING",
  "BALANCE_ADJUSTMENT",
  "SETTLEMENT_LIVING_CONTRIBUTION",
] as const;
export type LedgerEntryKind = (typeof ledgerEntryKinds)[number];

/** Personal reporting classification for ownership conversions (PRD: External funds). */
export type ReportingClassification = "OTHER_GIFT_INCOME" | "OWNERSHIP_OUTFLOW";

/** Reporting group of an entry; corrections inherit the group of what they correct. */
export const eventClasses = [
  "MONTHLY_INCOME",
  "OTHER_INCOME",
  "SPECIAL_EXPENSE",
  "RECURRING_EXPENSE",
  "OTHER_EXPENSE",
  "PERSONAL_TRANSFER",
  "EXTERNAL_MOVEMENT",
  "LIVING",
  "ADJUSTMENT",
] as const;
export type EventClass = (typeof eventClasses)[number];

export const movementTypes = [
  "RECEIPT",
  "RETURN",
  "OWNER_USE",
  "INTERNAL_TRANSFER",
  "CONVERT_TO_PERSONAL",
  "CONVERT_TO_EXTERNAL",
] as const;
export type MovementType = (typeof movementTypes)[number];

export type CorrectionRole = "REVERSAL" | "REPLACEMENT";

/**
 * One account effect. `physicalEffect` changes the provider balance and
 * `externalEffect` changes what external subjects own; the personal effect is
 * always derived as physical − external. Positive values increase the account.
 */
export type LedgerLeg = {
  readonly accountId: string;
  readonly physicalEffect: MinorUnits;
  readonly externalEffect: MinorUnits;
  readonly holdingId: string | null;
};

export type LedgerEntryDraft = {
  readonly kind: LedgerEntryKind;
  readonly eventClass: EventClass;
  readonly effectiveBusinessDate: string;
  readonly reportingClassification: ReportingClassification | null;
  readonly legs: readonly LedgerLeg[];
  readonly movementType?: MovementType | null;
  readonly correctionRole?: CorrectionRole | null;
  readonly correctsEntryId?: string | null;
  readonly correctedKind?: LedgerEntryKind | null;
  readonly sourceType?: string | null;
  readonly sourceId?: string | null;
};

export const personalEffect = (leg: Pick<LedgerLeg, "physicalEffect" | "externalEffect">): MinorUnits =>
  leg.physicalEffect - leg.externalEffect;

export type LedgerIssueCode =
  | "NO_LEGS"
  | "EMPTY_LEG"
  | "HOLDING_REQUIRED"
  | "HOLDING_NOT_ALLOWED"
  | "SINGLE_LEG_REQUIRED"
  | "INCOME_MUST_INCREASE"
  | "EXPENSE_MUST_DECREASE"
  | "EXTERNAL_NOT_ALLOWED"
  | "TRANSFER_NEEDS_TWO_ACCOUNTS"
  | "TRANSFER_MUST_BALANCE"
  | "EXTERNAL_EFFECT_REQUIRED"
  | "CLASSIFICATION_MISMATCH"
  | "MOVEMENT_TYPE_MISMATCH"
  | "CORRECTION_REFERENCE_REQUIRED";

const sum = (values: MinorUnits[]) => values.reduce((total, value) => total + value, 0n);

/**
 * Generic invariants every posted entry must satisfy. Feature slices add their
 * own rules on top (for example settlement or correction references).
 */
export function ledgerIssues(entry: LedgerEntryDraft): LedgerIssueCode[] {
  const issues = new Set<LedgerIssueCode>();
  const { legs } = entry;
  if (legs.length === 0) return ["NO_LEGS"];

  for (const leg of legs) {
    if (leg.physicalEffect === 0n && leg.externalEffect === 0n) issues.add("EMPTY_LEG");
    if (leg.externalEffect !== 0n && leg.holdingId === null) issues.add("HOLDING_REQUIRED");
    if (leg.externalEffect === 0n && leg.holdingId !== null) issues.add("HOLDING_NOT_ALLOWED");
  }

  const totalPersonal = sum(legs.map(personalEffect));

  if ((entry.correctionRole || entry.kind === "CORRECTION_POSTING") && !entry.correctsEntryId) {
    issues.add("CORRECTION_REFERENCE_REQUIRED");
  }
  // Reversals and settled-history deltas are validated against the corrected
  // record by the correction flow; their signs legitimately oppose the kind.
  if (entry.correctionRole === "REVERSAL" || entry.kind === "CORRECTION_POSTING") return [...issues];

  switch (entry.kind) {
    case "INCOME":
    case "EXPENSE": {
      if (legs.length !== 1) issues.add("SINGLE_LEG_REQUIRED");
      if (legs.some((leg) => leg.externalEffect !== 0n)) issues.add("EXTERNAL_NOT_ALLOWED");
      if (entry.kind === "INCOME" && legs.some((leg) => leg.physicalEffect <= 0n)) issues.add("INCOME_MUST_INCREASE");
      if (entry.kind === "EXPENSE" && legs.some((leg) => leg.physicalEffect >= 0n)) issues.add("EXPENSE_MUST_DECREASE");
      if (entry.reportingClassification !== null) issues.add("CLASSIFICATION_MISMATCH");
      break;
    }
    case "TRANSFER": {
      // Physical money and each external component move between accounts;
      // total personal cash never changes (PRD: Transfer antar-akun).
      if (new Set(legs.map((leg) => leg.accountId)).size < 2) issues.add("TRANSFER_NEEDS_TWO_ACCOUNTS");
      if (sum(legs.map((leg) => leg.physicalEffect)) !== 0n || sum(legs.map((leg) => leg.externalEffect)) !== 0n) {
        issues.add("TRANSFER_MUST_BALANCE");
      }
      if (entry.reportingClassification !== null) issues.add("CLASSIFICATION_MISMATCH");
      break;
    }
    case "EXTERNAL_MOVEMENT": {
      if (legs.some((leg) => leg.externalEffect === 0n)) issues.add("EXTERNAL_EFFECT_REQUIRED");
      // Ownership-neutral movements carry no classification; conversions must.
      const expected: ReportingClassification | null =
        totalPersonal > 0n ? "OTHER_GIFT_INCOME" : totalPersonal < 0n ? "OWNERSHIP_OUTFLOW" : null;
      if (entry.reportingClassification !== expected) issues.add("CLASSIFICATION_MISMATCH");
      if (!movementShapeMatches(entry.movementType ?? null, legs)) issues.add("MOVEMENT_TYPE_MISMATCH");
      break;
    }
    default:
      break;
  }

  return [...issues];
}

/** Leg shape required by each external movement subtype (PRD: Efek setiap kejadian). */
function movementShapeMatches(type: MovementType | null, legs: readonly LedgerLeg[]): boolean {
  const [only] = legs;
  switch (type) {
    case "RECEIPT":
      return legs.length === 1 && only.physicalEffect > 0n && only.externalEffect === only.physicalEffect;
    case "RETURN":
    case "OWNER_USE":
      return legs.length === 1 && only.physicalEffect < 0n && only.externalEffect === only.physicalEffect;
    case "INTERNAL_TRANSFER":
      return (
        legs.length === 2 &&
        legs[0].accountId !== legs[1].accountId &&
        legs.every((leg) => leg.physicalEffect === leg.externalEffect) &&
        legs[0].physicalEffect + legs[1].physicalEffect === 0n &&
        legs[0].holdingId === legs[1].holdingId
      );
    case "CONVERT_TO_PERSONAL":
      return legs.length === 1 && only.physicalEffect === 0n && only.externalEffect < 0n;
    case "CONVERT_TO_EXTERNAL":
      return legs.length === 1 && only.physicalEffect === 0n && only.externalEffect > 0n;
    default:
      return false;
  }
}

/**
 * Reporting contribution of an account effect (PRD: `account_effect`
 * convention): income reports the effect as-is, expenses report its negation,
 * and personal transfers report nothing.
 */
export function reportingContribution(kind: LedgerEntryKind, accountEffect: MinorUnits): MinorUnits {
  if (kind === "INCOME") return accountEffect;
  if (kind === "EXPENSE") return -accountEffect;
  return 0n;
}

/**
 * Inclusion of a date-only event in a position as of timestamp `asOf` (PRD
 * v0.18): earlier business dates always count; on the same Jakarta date the
 * event counts only if it was recorded no later than the record holding `asOf`.
 */
export function includedAsOf(
  event: { effectiveBusinessDate: string; recordedAt: Date },
  asOf: { instant: Date; recordedAt: Date },
): boolean {
  const asOfDate = businessDateOf(asOf.instant);
  if (event.effectiveBusinessDate < asOfDate) return true;
  if (event.effectiveBusinessDate > asOfDate) return false;
  return event.recordedAt.getTime() <= asOf.recordedAt.getTime();
}

export type CutoverRelation = "BEFORE_CUTOVER" | "CUTOVER_DAY" | "AFTER_CUTOVER";

/**
 * Where a business date falls relative to an account's cutover. Dates before
 * are rejected; the cutover day requires the owner's explicit answer to
 * "Sudah termasuk saldo awal?".
 */
export function cutoverRelation(businessDate: string, cutoverAt: Date): CutoverRelation {
  const cutoverDate = businessDateOf(cutoverAt);
  if (businessDate < cutoverDate) return "BEFORE_CUTOVER";
  return businessDate === cutoverDate ? "CUTOVER_DAY" : "AFTER_CUTOVER";
}

export type Position = { physical: MinorUnits; external: MinorUnits };

export type AccountBalance = {
  readonly physical: MinorUnits;
  readonly external: MinorUnits;
  /** Signed; never clamped to Rp0. */
  readonly personal: MinorUnits;
  /** max(0, external − physical) = max(0, −personal). */
  readonly shortfall: MinorUnits;
};

/** Opening position plus every effect, per account (PRD: Rumus agregat). */
export function balancesFrom(
  openings: ReadonlyMap<string, Position>,
  legs: readonly Pick<LedgerLeg, "accountId" | "physicalEffect" | "externalEffect">[],
): Map<string, AccountBalance> {
  const running = new Map<string, Position>();
  for (const [accountId, opening] of openings) running.set(accountId, { ...opening });
  for (const leg of legs) {
    const current = running.get(leg.accountId) ?? { physical: 0n, external: 0n };
    running.set(leg.accountId, {
      physical: current.physical + leg.physicalEffect,
      external: current.external + leg.externalEffect,
    });
  }
  return new Map(
    [...running].map(([accountId, { physical, external }]) => {
      const personal = physical - external;
      return [accountId, { physical, external, personal, shortfall: personal < 0n ? -personal : 0n }];
    }),
  );
}

export type HoldingPositionKey = `${string}:${string}`; // accountId:holdingId

/**
 * Replays opening external positions and external effects in canonical ledger
 * order and returns every (account, holding) whose position ever goes below
 * zero. External positions may never be negative (PRD: External funds).
 */
export function negativeHoldingPositions(
  openings: readonly { accountId: string; holdingId: string; amount: MinorUnits }[],
  orderedEffects: readonly { accountId: string; holdingId: string; externalEffect: MinorUnits }[],
): HoldingPositionKey[] {
  const positions = new Map<HoldingPositionKey, MinorUnits>();
  const negative = new Set<HoldingPositionKey>();
  for (const opening of openings) {
    const key: HoldingPositionKey = `${opening.accountId}:${opening.holdingId}`;
    positions.set(key, (positions.get(key) ?? 0n) + opening.amount);
  }
  for (const effect of orderedEffects) {
    const key: HoldingPositionKey = `${effect.accountId}:${effect.holdingId}`;
    const next = (positions.get(key) ?? 0n) + effect.externalEffect;
    positions.set(key, next);
    if (next < 0n) negative.add(key);
  }
  return [...negative];
}
