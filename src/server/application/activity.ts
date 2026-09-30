// Aktivitas: audit-ordered timeline of ledger entries and opening snapshots.
import { sql } from "drizzle-orm";

import { toIdrDecimal } from "@/lib/money";
import type { OwnerTx } from "@/server/db/owner";

export type ActivityLeg = { accountId: string; accountName: string; physical: string; external: string; personal: string };

export type ActivityItem =
  | {
      type: "LEDGER_ENTRY";
      id: string;
      kind: string;
      eventClass: string;
      movementType: string | null;
      reportingClassification: string | null;
      businessDate: string;
      recordedAt: string;
      note: string | null;
      category: { id: string; displayName: string } | null;
      subjectName: string | null;
      correctionRole: string | null;
      correctsEntryId: string | null;
      correctedKind: string | null;
      sourceType: string | null;
      sourceId: string | null;
      /** ACTIVE, or CORRECTED/VOIDED once a reversal exists. */
      status: "ACTIVE" | "CORRECTED" | "VOIDED";
      legs: ActivityLeg[];
    }
  | { type: "OPENING_SNAPSHOT"; id: string; recordedAt: string; cutoverAt: string; supersedesId: string | null; superseded: boolean };

export async function listActivity(
  tx: OwnerTx,
  ownerId: string,
  options: { limit: number; before?: { recordedAt: string; id: string } },
): Promise<{ items: ActivityItem[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(options.limit, 1), 100);
  const before = options.before
    ? sql`and (e.recorded_at, e.id) < (${options.before.recordedAt}::timestamptz, ${options.before.id}::uuid)`
    : sql``;

  const entries = await tx.execute<{
    id: string;
    kind: string;
    event_class: string;
    movement_type: string | null;
    reporting_classification: string | null;
    business_date: string;
    recorded_at: string;
    note: string | null;
    category_id: string | null;
    category_name: string | null;
    correction_role: string | null;
    corrects_entry_id: string | null;
    corrected_kind: string | null;
    source_type: string | null;
    source_id: string | null;
    reversed_by_role: string | null;
    has_replacement: boolean;
    settled_status: "VOIDED" | "CORRECTED" | null;
    subject_name: string | null;
  }>(sql`
    select e.id, e.kind, e.event_class, e.movement_type, e.reporting_classification,
           e.effective_business_date::text as business_date,
           to_char(e.recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as recorded_at,
           e.note, e.category_id, c.display_name as category_name,
           e.correction_role, e.corrects_entry_id, e.corrected_kind, e.source_type, e.source_id,
           (select r.correction_role from fintrack.ledger_entry r
             where r.owner_id = ${ownerId} and r.corrects_entry_id = e.id and r.correction_role = 'REVERSAL' limit 1) as reversed_by_role,
           exists (select 1 from fintrack.ledger_entry r
             where r.owner_id = ${ownerId} and r.corrects_entry_id = e.id and r.correction_role = 'REPLACEMENT') as has_replacement,
           (select case when count(*) = 0 then null
                        when sum(abs(x.physical)) + sum(abs(x.external)) = 0 then 'VOIDED' else 'CORRECTED' end
              from (select l.account_id, l.holding_id,
                           sum(l.physical_effect_minor) as physical, sum(l.external_effect_minor) as external
                      from fintrack.ledger_leg l
                     where l.entry_id = e.id
                        or l.entry_id in (select p.id from fintrack.ledger_entry p
                                           where p.owner_id = ${ownerId} and p.corrects_entry_id = e.id and p.kind = 'CORRECTION_POSTING')
                     group by 1, 2) x
             where exists (select 1 from fintrack.ledger_entry p
                            where p.owner_id = ${ownerId} and p.corrects_entry_id = e.id and p.kind = 'CORRECTION_POSTING')) as settled_status,
           (select s.display_name from fintrack.ledger_leg l
              join fintrack.external_holding h on h.id = l.holding_id
              join fintrack.external_subject s on s.id = h.subject_id
             where l.entry_id = e.id limit 1) as subject_name
    from fintrack.ledger_entry e
    left join fintrack.special_expense_category c on c.id = e.category_id
    where e.owner_id = ${ownerId} ${before}
    order by e.recorded_at desc, e.id desc
    limit ${limit + 1}`);

  const page = entries.slice(0, limit);
  const ids = page.map((row) => row.id);
  const legs = ids.length
    ? await tx.execute<{ entry_id: string; account_id: string; account_name: string; physical: string; external: string }>(sql`
        select l.entry_id, l.account_id, a.display_name as account_name,
               l.physical_effect_minor::text as physical, l.external_effect_minor::text as external
        from fintrack.ledger_leg l join fintrack.account a on a.id = l.account_id
        where l.owner_id = ${ownerId} and l.entry_id in ${sql`(${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`}
        order by a.sort_order`)
    : [];

  const items: ActivityItem[] = page.map((row) => ({
    type: "LEDGER_ENTRY",
    id: row.id,
    kind: row.kind,
    eventClass: row.event_class,
    movementType: row.movement_type,
    reportingClassification: row.reporting_classification,
    businessDate: row.business_date,
    recordedAt: row.recorded_at,
    note: row.note,
    category: row.category_id ? { id: row.category_id, displayName: row.category_name! } : null,
    subjectName: row.subject_name,
    correctionRole: row.correction_role,
    correctsEntryId: row.corrects_entry_id,
    correctedKind: row.corrected_kind,
    sourceType: row.source_type,
    sourceId: row.source_id,
    status: row.reversed_by_role ? (row.has_replacement ? "CORRECTED" : "VOIDED") : (row.settled_status ?? "ACTIVE"),
    legs: legs
      .filter((leg) => leg.entry_id === row.id)
      .map((leg) => {
        const physical = BigInt(leg.physical);
        const external = BigInt(leg.external);
        return {
          accountId: leg.account_id,
          accountName: leg.account_name,
          physical: toIdrDecimal(physical),
          external: toIdrDecimal(external),
          personal: toIdrDecimal(physical - external),
        };
      }),
  }));

  // Opening snapshots appear in the audit history on the first page only.
  if (!options.before) {
    const snapshots = await tx.execute<{ id: string; confirmed_at: string; cutover_at: string; supersedes_id: string | null; superseded: boolean }>(sql`
      select id, to_char(confirmed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as confirmed_at,
             to_char(cutover_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as cutover_at,
             supersedes_id, superseded_by_id is not null as superseded
      from fintrack.onboarding_snapshot
      where owner_id = ${ownerId} and status = 'CONFIRMED'`);
    for (const snapshot of snapshots) {
      items.push({
        type: "OPENING_SNAPSHOT",
        id: snapshot.id,
        recordedAt: snapshot.confirmed_at,
        cutoverAt: snapshot.cutover_at,
        supersedesId: snapshot.supersedes_id,
        superseded: snapshot.superseded,
      });
    }
    items.sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : a.recordedAt > b.recordedAt ? -1 : 0));
  }

  const last = page.at(-1);
  const nextCursor = entries.length > limit && last ? `${last.recorded_at}|${last.id}` : null;
  return { items, nextCursor };
}
