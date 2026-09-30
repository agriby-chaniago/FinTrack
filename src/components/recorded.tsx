"use client";

import Link from "next/link";

import { Alert, buttonClass } from "./ui";

export type PostResult = { recorded: true; entryId: string } | { recorded: false; reason: "ALREADY_IN_OPENING" };

/** Server-acknowledged outcome of a recording form (PRD: success only after acknowledgement). */
export function Recorded({ result, onAgain, againLabel = "Catat lagi" }: { result: PostResult; onAgain: () => void; againLabel?: string }) {
  return (
    <div className="space-y-4">
      {result.recorded ? (
        <Alert tone="success" title="Tersimpan" live>
          Catatan sudah masuk ke Aktivitas dan saldo tercatat.
        </Alert>
      ) : (
        <Alert tone="info" title="Tidak dicatat ulang" live>
          Kejadian ini sudah termasuk saldo awal, jadi FinTrack tidak mencatatnya lagi.
        </Alert>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="button" className={buttonClass.primary} onClick={onAgain}>
          {againLabel}
        </button>
        {result.recorded ? (
          <Link href={`/aktivitas/${result.entryId}`} className={buttonClass.secondary}>
            Lihat catatan
          </Link>
        ) : null}
        <Link href="/" className={buttonClass.secondary}>
          Ke Beranda
        </Link>
      </div>
    </div>
  );
}
