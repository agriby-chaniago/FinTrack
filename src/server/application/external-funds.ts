// External funds (PRD: External funds, External fund workflow). Every movement
// is an append-only ledger entry with physical and ownership effects.
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { parseIdrDecimal, toIdrDecimal } from "@/lib/money";
import { ApiError } from "@/server/api/errors";
import { businessDate, cutoverDayAnswer, note, positiveAmount } from "@/server/api/schemas";
import type { OwnerTx } from "@/server/db/owner";
import { externalHolding, externalSubject } from "@/server/db/schema/onboarding";
import type { LedgerEntryDraft, LedgerLeg, MovementType } from "@/server/domain/ledger";
import { cleanDisplayName, normalizeName } from "@/server/domain/names";

import { requireActiveCashAccounts } from "./accounts";
import { postLedgerEntry, type PostResult } from "./ledger";

const common = { amount: positiveAmount, businessDate, note, cutoverDayAnswer };
const subjectRef = { subjectId: z.uuid().optional(), subjectName: z.string().trim().min(1).max(80).optional() };

export const externalMovementSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("RECEIPT"), accountId: z.uuid(), ...subjectRef, ...common }),
  z.object({ type: z.literal("RETURN"), accountId: z.uuid(), subjectId: z.uuid(), ...common }),
  z.object({ type: z.literal("OWNER_USE"), accountId: z.uuid(), subjectId: z.uuid(), ...common }),
  z.object({ type: z.literal("CONVERT_TO_PERSONAL"), accountId: z.uuid(), subjectId: z.uuid(), ...common }),
  z.object({ type: z.literal("CONVERT_TO_EXTERNAL"), accountId: z.uuid(), ...subjectRef, ...common }),
  z.object({
    type: z.literal("INTERNAL_TRANSFER"),
    fromAccountId: z.uuid(),
    toAccountId: z.uuid(),
    subjectId: z.uuid(),
    ...common,
  }),
]);
export type ExternalMovementInput = z.infer<typeof externalMovementSchema>;

/** Default holding of a subject; creates the subject when a new name is allowed. */
async function resolveHolding(
  tx: OwnerTx,
  ownerId: string,
  ref: { subjectId?: string; subjectName?: string },
  options: { allowCreate: boolean },
): Promise<string> {
  if (ref.subjectId) {
    const [row] = await tx
      .select({ holdingId: externalHolding.id, isArchived: externalSubject.isArchived })
      .from(externalSubject)
      .innerJoin(externalHolding, and(eq(externalHolding.subjectId, externalSubject.id), eq(externalHolding.isDefault, true)))
      .where(and(eq(externalSubject.ownerId, ownerId), eq(externalSubject.id, ref.subjectId)));
    if (!row) throw new ApiError("NOT_FOUND", { subjectId: ref.subjectId });
    if (row.isArchived) {
      if (!options.allowCreate) throw new ApiError("VALIDATION_FAILED", { issues: ["SUBJECT_ARCHIVED"] });
      // A new receipt reopens a cleared, archived subject (PRD: External funds).
      await tx.update(externalSubject).set({ isArchived: false }).where(eq(externalSubject.id, ref.subjectId));
    }
    return row.holdingId;
  }
  if (!ref.subjectName || !options.allowCreate) throw new ApiError("VALIDATION_FAILED", { issues: ["SUBJECT_REQUIRED"] });

  const normalized = normalizeName(ref.subjectName);
  const [existing] = await tx
    .select({ subjectId: externalSubject.id })
    .from(externalSubject)
    .where(and(eq(externalSubject.ownerId, ownerId), eq(externalSubject.normalizedName, normalized)));
  if (existing) return resolveHolding(tx, ownerId, { subjectId: existing.subjectId }, options);

  const subjectId = crypto.randomUUID();
  const holdingId = crypto.randomUUID();
  await tx.insert(externalSubject).values({ id: subjectId, ownerId, displayName: cleanDisplayName(ref.subjectName), normalizedName: normalized });
  await tx.insert(externalHolding).values({ id: holdingId, ownerId, subjectId, isDefault: true });
  return holdingId;
}

/** Ledger entry for one external movement subtype (PRD: Efek setiap kejadian). */
export function externalMovementDraft(
  type: MovementType,
  holdingId: string,
  accounts: { accountId: string; toAccountId?: string },
  amount: bigint,
  date: string,
): LedgerEntryDraft {
  const leg = (accountId: string, physical: bigint, external: bigint): LedgerLeg => ({
    accountId,
    physicalEffect: physical,
    externalEffect: external,
    holdingId,
  });
  const base = { kind: "EXTERNAL_MOVEMENT" as const, eventClass: "EXTERNAL_MOVEMENT" as const, effectiveBusinessDate: date, movementType: type };
  switch (type) {
    case "RECEIPT":
      return { ...base, reportingClassification: null, legs: [leg(accounts.accountId, amount, amount)] };
    case "RETURN":
    case "OWNER_USE":
      return { ...base, reportingClassification: null, legs: [leg(accounts.accountId, -amount, -amount)] };
    case "CONVERT_TO_PERSONAL":
      return { ...base, reportingClassification: "OTHER_GIFT_INCOME", legs: [leg(accounts.accountId, 0n, -amount)] };
    case "CONVERT_TO_EXTERNAL":
      return { ...base, reportingClassification: "OWNERSHIP_OUTFLOW", legs: [leg(accounts.accountId, 0n, amount)] };
    case "INTERNAL_TRANSFER":
      return {
        ...base,
        reportingClassification: null,
        legs: [leg(accounts.accountId, -amount, -amount), leg(accounts.toAccountId!, amount, amount)],
      };
  }
}

export async function recordExternalMovement(
  tx: OwnerTx,
  ownerId: string,
  input: ExternalMovementInput,
  now: Date,
): Promise<PostResult> {
  const accountIds = input.type === "INTERNAL_TRANSFER" ? [input.fromAccountId, input.toAccountId] : [input.accountId];
  await requireActiveCashAccounts(tx, ownerId, accountIds);
  if (input.type === "INTERNAL_TRANSFER" && input.fromAccountId === input.toAccountId) {
    throw new ApiError("VALIDATION_FAILED", { issues: ["SAME_ACCOUNT"] });
  }

  const allowCreate = input.type === "RECEIPT" || input.type === "CONVERT_TO_EXTERNAL";
  const holdingId = await resolveHolding(tx, ownerId, input, { allowCreate });
  const draft = externalMovementDraft(
    input.type,
    holdingId,
    input.type === "INTERNAL_TRANSFER" ? { accountId: input.fromAccountId, toAccountId: input.toAccountId } : { accountId: input.accountId },
    parseIdrDecimal(input.amount),
    input.businessDate,
  );
  return postLedgerEntry(tx, ownerId, draft, { now, note: input.note ?? null, cutoverDayAnswer: input.cutoverDayAnswer });
}

export type ExternalSubjectView = {
  id: string;
  displayName: string;
  isArchived: boolean;
  holdingId: string;
  status: "OPEN" | "CLEARED";
  total: string;
  positions: { accountId: string; accountName: string; amount: string }[];
};

/** Subjects with their current outstanding position per account. */
export async function listExternalSubjects(tx: OwnerTx, ownerId: string): Promise<ExternalSubjectView[]> {
  const rows = await tx.execute<{
    subject_id: string;
    display_name: string;
    is_archived: boolean;
    holding_id: string;
    account_id: string | null;
    account_name: string | null;
    amount: string | null;
  }>(sql`
    with effective as (
      select id from fintrack.onboarding_snapshot
      where owner_id = ${ownerId} and status = 'CONFIRMED' and superseded_by_id is null
    ),
    movements as (
      select e.holding_id, e.account_id, e.amount_minor as amount
      from fintrack.opening_external_position e join effective s on s.id = e.snapshot_id
      union all
      select l.holding_id, l.account_id, l.external_effect_minor
      from fintrack.ledger_leg l where l.owner_id = ${ownerId} and l.external_effect_minor <> 0
    ),
    positions as (select holding_id, account_id, sum(amount) as amount from movements group by 1, 2)
    select s.id as subject_id, s.display_name, s.is_archived, h.id as holding_id,
           p.account_id, a.display_name as account_name, p.amount::text as amount
    from fintrack.external_subject s
    join fintrack.external_holding h on h.subject_id = s.id and h.is_default
    left join positions p on p.holding_id = h.id
    left join fintrack.account a on a.id = p.account_id
    where s.owner_id = ${ownerId}
    order by s.display_name, a.sort_order`);

  const subjects = new Map<string, ExternalSubjectView & { totalMinor: bigint }>();
  for (const row of rows) {
    const subject =
      subjects.get(row.subject_id) ??
      ({ id: row.subject_id, displayName: row.display_name, isArchived: row.is_archived, holdingId: row.holding_id, status: "CLEARED", total: "0", totalMinor: 0n, positions: [] } as ExternalSubjectView & { totalMinor: bigint });
    if (row.account_id && row.amount && BigInt(row.amount) !== 0n) {
      subject.positions.push({ accountId: row.account_id, accountName: row.account_name!, amount: toIdrDecimal(BigInt(row.amount)) });
      subject.totalMinor += BigInt(row.amount);
    }
    subjects.set(row.subject_id, subject);
  }
  return [...subjects.values()].map(({ totalMinor, ...subject }) => ({
    ...subject,
    total: toIdrDecimal(totalMinor),
    status: totalMinor > 0n ? "OPEN" : "CLEARED",
  }));
}

/** Archives a subject only when every holding position is Rp0; history stays. */
export async function archiveExternalSubject(tx: OwnerTx, ownerId: string, subjectId: string): Promise<void> {
  const subject = (await listExternalSubjects(tx, ownerId)).find((row) => row.id === subjectId);
  if (!subject) throw new ApiError("NOT_FOUND");
  if (subject.status !== "CLEARED") throw new ApiError("VALIDATION_FAILED", { issues: ["SUBJECT_HAS_OUTSTANDING"] });
  await tx
    .update(externalSubject)
    .set({ isArchived: true })
    .where(and(eq(externalSubject.ownerId, ownerId), eq(externalSubject.id, subjectId)));
}
