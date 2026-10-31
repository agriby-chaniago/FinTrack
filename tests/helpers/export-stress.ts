// LOCAL synthetic fixtures only. Bulk history follows two real settlements,
// including Tunai activation, then repeats their zero-closing balance model.
import { randomUUID } from "node:crypto";

import { addDays, businessDateOf } from "@/lib/business-time";
import { toIdrDecimal } from "@/lib/money";
import { createSettlementDraft, replaceSettlementClosing, settle } from "@/server/application/settlement";
import { dayOfWeek, daysBetweenInclusive } from "@/server/domain/daily-income";

import { asOwner, resetWithConfirmedFixture, type TestClients, type TestUser } from "./owner";

type FixtureRow = Record<string, unknown>;
type FixtureTable = "balance_confirmation" | "settlement" | "ledger_entry" | "ledger_leg" | "transfer_target" | "transfer_target_version";

async function insertRows(clients: TestClients, table: FixtureTable, rows: FixtureRow[]) {
  for (let offset = 0; offset < rows.length; offset += 2000) {
    const json = clients.admin.json(JSON.parse(JSON.stringify(rows.slice(offset, offset + 2000))));
    // Table names are fixed here; values remain parameters, with no SQL money
    // passing through JavaScript numbers or runtime-role policy bypasses.
    switch (table) {
      case "balance_confirmation": await clients.admin`insert into fintrack.balance_confirmation select * from jsonb_populate_recordset(null::fintrack.balance_confirmation, ${json}::jsonb)`; break;
      case "settlement": await clients.admin`insert into fintrack.settlement select * from jsonb_populate_recordset(null::fintrack.settlement, ${json}::jsonb)`; break;
      case "ledger_entry": await clients.admin`insert into fintrack.ledger_entry select * from jsonb_populate_recordset(null::fintrack.ledger_entry, ${json}::jsonb)`; break;
      case "ledger_leg": await clients.admin`insert into fintrack.ledger_leg select * from jsonb_populate_recordset(null::fintrack.ledger_leg, ${json}::jsonb)`; break;
      case "transfer_target": await clients.admin`insert into fintrack.transfer_target select * from jsonb_populate_recordset(null::fintrack.transfer_target, ${json}::jsonb)`; break;
      case "transfer_target_version": await clients.admin`insert into fintrack.transfer_target_version select * from jsonb_populate_recordset(null::fintrack.transfer_target_version, ${json}::jsonb)`; break;
    }
  }
}

export async function seedExportStress(clients: TestClients, user: TestUser, profile: { years: number; events: number; revisions: number; closingRevisions: number }, now: Date) {
  const today = businessDateOf(now);
  const anniversary = addDays(today, -365 * profile.years);
  const start = addDays(anniversary, -((dayOfWeek(anniversary) + 6) % 7));
  const weeks = Math.floor(daysBetweenInclusive(start, addDays(today, -1)) / 7);
  const owner = await resetWithConfirmedFixture(clients, user.id, `${addDays(start, -1)}T20:00:00+07:00`);
  for (let week = 0; week < 2; week++) {
    const endDate = addDays(start, week * 7 + 6);
    await asOwner(clients.runtime, user.id, async (tx, principal) => {
      const draft = await createSettlementDraft(tx, principal.ownerId, { endDate, closingPhysicalBalance: "0", closingAt: `${endDate}T21:00:00+07:00`, ...(week === 0 ? { startCashTracking: "0" } : { cashClosingBalance: "0" }) }, now);
      await settle(tx, principal.ownerId, draft.id, draft.version, now);
    });
  }
  const [template] = await clients.admin<{ id: string; snapshot: Record<string, unknown> }[]>`select id, snapshot from fintrack.settlement where owner_id = ${owner.ownerId} order by end_date desc limit 1`;
  const [cash] = await clients.admin<{ id: string }[]>`select id from fintrack.account where owner_id = ${owner.ownerId} and account_type = 'CASH'`;
  const confirmations: FixtureRow[] = [];
  const settlements: FixtureRow[] = [];
  const entries: FixtureRow[] = [];
  const legs: FixtureRow[] = [];
  const targets: FixtureRow[] = [];
  const versions: FixtureRow[] = [];
  let lastSettlementId = template.id;
  const entry = (id: string, date: string, fields: FixtureRow = {}): FixtureRow => ({ id, owner_id: owner.ownerId, kind: "EXPENSE", event_class: "OTHER_EXPENSE", effective_business_date: date, recorded_at: now.toISOString(), ...fields });
  const leg = (entryId: string, accountId: string, amount: bigint): FixtureRow => ({ id: randomUUID(), owner_id: owner.ownerId, entry_id: entryId, account_id: accountId, physical_effect_minor: amount.toString(), external_effect_minor: "0", holding_id: null });

  for (let week = 2; week < weeks; week++) {
    const id = randomUUID();
    lastSettlementId = id;
    const from = addDays(start, week * 7);
    const end = addDays(from, 6);
    const closingAt = `${end}T21:00:00+07:00`;
    const dailyConfirmation = randomUUID();
    const cashConfirmation = randomUUID();
    for (const [confirmationId, accountId] of [[dailyConfirmation, owner.accountIds.daily], [cashConfirmation, cash.id]]) confirmations.push({ id: confirmationId, owner_id: owner.ownerId, account_id: accountId, physical_balance_minor: "0", as_of: closingAt, source: "SETTLEMENT", recorded_at: closingAt });
    settlements.push({ id, owner_id: owner.ownerId, account_id: owner.accountIds.daily, start_date: from, end_date: end, status: "SETTLED", closing_physical_minor: "0", closing_at: closingAt, closing_confirmation_id: dailyConfirmation, cash_closing_physical_minor: "0", cash_closing_confirmation_id: cashConfirmation, living_expense_minor: "35000000", snapshot: { ...template.snapshot, closingAt: new Date(closingAt).toISOString(), days: Array.from({ length: 7 }, (_, i) => ({ date: addDays(from, i), state: "ACTIVE", amount: "50000", overridden: false })) }, version: 2, settled_at: closingAt, created_at: closingAt, updated_at: closingAt });
    const livingId = randomUUID();
    entries.push(entry(livingId, end, { kind: "SETTLEMENT_LIVING_CONTRIBUTION", event_class: "LIVING", source_type: "SETTLEMENT", source_id: id, recorded_at: closingAt }));
    legs.push(leg(livingId, owner.accountIds.daily, -35_000_000n));
    const targetId = randomUUID();
    targets.push({ id: targetId, owner_id: owner.ownerId, context_type: "DANA_SETTLEMENT", context_key: id, context_order: end, source_account_id: owner.accountIds.daily, destination_account_id: owner.accountIds.reserve, created_at: closingAt });
    versions.push({ id: randomUUID(), owner_id: owner.ownerId, target_id: targetId, amount_minor: "0", basis: { closingPersonal: "0", priorOutstanding: "0", settlementId: id }, is_actionable: true, created_at: closingAt });
  }
  for (let i = 0; i < profile.events; i++) {
    const id = randomUUID();
    const income = i % 2 === 0;
    // Deterministic varied text prevents a misleading all-identical ZIP.
    const note = `Synthetic, "record"\n${i.toString(36)} ${randomUUID()} ${randomUUID()} Ω`;
    entries.push(entry(id, addDays(start, i % (weeks * 7)), { kind: income ? "INCOME" : "EXPENSE", event_class: income ? "OTHER_INCOME" : "OTHER_EXPENSE", note }));
    legs.push(leg(id, owner.accountIds.reserve, income ? 12_345n : -12_345n));
  }
  const root = randomUUID();
  const offset = randomUUID();
  entries.push(entry(root, start, { note: "Original synthetic correction family" }), entry(offset, start, { kind: "INCOME", event_class: "OTHER_INCOME" }));
  legs.push(leg(root, owner.accountIds.reserve, -10_000_000n), leg(offset, owner.accountIds.reserve, 10_000_000n));
  let previousId = root;
  let previousAmount = 10_000_000n;
  for (let i = 1; i <= profile.revisions; i++) {
    const reversal = randomUUID();
    const replacement = randomUUID();
    const amount = 10_000_000n + BigInt(i % 2);
    entries.push(entry(reversal, start, { correction_role: "REVERSAL", corrects_entry_id: previousId }), entry(replacement, start, { correction_role: "REPLACEMENT", corrects_entry_id: previousId, note: `Synthetic revision ${i}` }));
    legs.push(leg(reversal, owner.accountIds.reserve, previousAmount), leg(replacement, owner.accountIds.reserve, -amount));
    previousId = replacement;
    previousAmount = amount;
  }
  await insertRows(clients, "balance_confirmation", confirmations);
  await insertRows(clients, "settlement", settlements);
  await insertRows(clients, "ledger_entry", entries);
  await insertRows(clients, "ledger_leg", legs);
  await insertRows(clients, "transfer_target", targets);
  await insertRows(clients, "transfer_target_version", versions);
  // These are real application mutations on the isolated fixture, not fake
  // replacement pointers: they exercise the exact closing/resync/version path.
  for (let i = 0; i < profile.closingRevisions; i++) await asOwner(clients.runtime, user.id, (tx, principal) => replaceSettlementClosing(tx, principal.ownerId, lastSettlementId, { closingPhysicalBalance: i % 2 === 0 ? "1" : "0" }, now));
  const [counts] = await clients.admin<{ entries: number; legs: number; settlements: number }[]>`select (select count(*)::int from fintrack.ledger_entry where owner_id = ${owner.ownerId}) as entries, (select count(*)::int from fintrack.ledger_leg where owner_id = ${owner.ownerId}) as legs, (select count(*)::int from fintrack.settlement where owner_id = ${owner.ownerId}) as settlements`;
  return { ...profile, ...counts, root, expectedCorrection: toIdrDecimal(previousAmount), ownerId: owner.ownerId, weeks, start };
}
