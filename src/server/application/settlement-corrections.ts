// Settled-history corrections (PRD: CORRECTION_POSTING). Implemented with the
// weekly settlement slice; until settlements exist nothing is settled.
import { ApiError } from "@/server/api/errors";
import type { OwnerTx } from "@/server/db/owner";
import type { LedgerEntryDraft } from "@/server/domain/ledger";

import type { CorrectionResult, LoadedEntry } from "./corrections";

/** The SETTLED settlement whose range contains this record on a weekly-settlement account, if any. */
export async function settledSettlementFor(_tx: OwnerTx, _ownerId: string, _entry: LoadedEntry): Promise<string | null> {
  return null;
}

export async function correctSettledEntry(
  _tx: OwnerTx,
  _ownerId: string,
  _entry: LoadedEntry,
  _replacement: { draft: LedgerEntryDraft; categoryId: string | null } | null,
  _now: Date,
): Promise<CorrectionResult> {
  throw new ApiError("INTERNAL_ERROR");
}
