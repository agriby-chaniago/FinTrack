// Plain-language summary of one ledger entry for the Aktivitas timeline.
import { eventClassLabel, movementTypeLabel } from "@/lib/labels";
import { parseIdrDecimal, toIdrDecimal } from "@/lib/money";
import type { ActivityItem } from "@/server/application/activity";

type Entry = Extract<ActivityItem, { type: "LEDGER_ENTRY" }>;

export function entryTitle(entry: Entry): string {
  const destination = entry.legs.find((leg) => parseIdrDecimal(leg.physical) > 0n);
  const source = entry.legs.find((leg) => parseIdrDecimal(leg.physical) < 0n);
  let base: string;
  switch (entry.eventClass) {
    case "SPECIAL_EXPENSE":
      base = entry.category?.displayName ?? eventClassLabel.SPECIAL_EXPENSE;
      break;
    case "EXTERNAL_MOVEMENT":
      base = `${movementTypeLabel[entry.movementType ?? ""] ?? eventClassLabel.EXTERNAL_MOVEMENT}${entry.subjectName ? ` · ${entry.subjectName}` : ""}`;
      break;
    case "PERSONAL_TRANSFER":
      base = source && destination ? `Transfer ${source.accountName} → ${destination.accountName}` : eventClassLabel.PERSONAL_TRANSFER;
      break;
    default:
      base = eventClassLabel[entry.eventClass] ?? entry.eventClass;
  }
  if (entry.kind === "CORRECTION_POSTING") return `Koreksi riwayat settlement · ${base}`;
  if (entry.correctionRole === "REVERSAL") return `Pembalik · ${base}`;
  if (entry.correctionRole === "REPLACEMENT") return `Pengganti · ${base}`;
  return base;
}

/** The amount people recognise: the moved amount for transfers, else the net physical change. */
export function entryAmount(entry: Entry): { value: string; signed: boolean } {
  if (entry.eventClass === "PERSONAL_TRANSFER" || entry.movementType === "INTERNAL_TRANSFER") {
    const moved = entry.legs.reduce((sum, leg) => (parseIdrDecimal(leg.physical) > 0n ? sum + parseIdrDecimal(leg.physical) : sum), 0n);
    return { value: toIdrDecimal(moved), signed: false };
  }
  const physical = entry.legs.reduce((sum, leg) => sum + parseIdrDecimal(leg.physical), 0n);
  if (physical !== 0n) return { value: toIdrDecimal(physical), signed: true };
  const external = entry.legs.reduce((sum, leg) => sum + parseIdrDecimal(leg.external), 0n);
  return { value: toIdrDecimal(external < 0n ? -external : external), signed: false };
}

export const statusTag: Record<Entry["status"], string | null> = { ACTIVE: null, CORRECTED: "Dikoreksi", VOIDED: "Dibatalkan" };

/** Classes a person may correct directly with `Koreksi`. */
export const correctableClasses = new Set(["SPECIAL_EXPENSE", "OTHER_INCOME", "OTHER_EXPENSE", "EXTERNAL_MOVEMENT", "PERSONAL_TRANSFER", "MONTHLY_INCOME", "RECURRING_EXPENSE"]);
