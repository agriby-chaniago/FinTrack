"use client";

import { useState } from "react";

import { AmountInput } from "@/components/amount-input";
import { DateField, FormErrors } from "@/components/form";
import { Collapse, Swap } from "@/components/motion";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import { todayInJakarta, useMutation } from "@/lib/api-client";
import { formatDate, money } from "@/lib/format";

type OccurrenceProps = {
  type: "monthly-income" | "recurring-expense";
  /** What the toast names, e.g. "Income bulanan" or the subscription name. */
  name: string;
  occurrenceId: string;
  ruleId?: string;
  cycleKey: string;
  status: string;
  expectedDate: string | null;
  expectedDay: number | null;
  suggestedAmount: string | null;
  confirmedEntryId: string | null;
};

/**
 * One-tap monthly confirmation (PRD): `Konfirmasi sesuai saran`, with
 * `Ubah detail` for the actual date and amount, and the no-event outcome.
 */
export function OccurrenceActions(props: OccurrenceProps) {
  const today = todayInJakarta();
  const defaultDate = props.expectedDate && props.expectedDate <= today ? props.expectedDate : today;
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(defaultDate);
  const [amount, setAmount] = useState<string | null>(props.suggestedAmount);
  const [revisionOffer, setRevisionOffer] = useState<number | null>(null);
  const resolve = useMutation<Record<string, unknown>>(`/api/v1/occurrences/${props.type}/${props.occurrenceId}/resolutions`);
  const revise = useMutation<Record<string, unknown>>(`/api/v1/recurring-expense-rules/${props.ruleId}/revisions`);
  const noEvent = props.type === "monthly-income" ? "NOT_RECEIVED" : "NOT_CHARGED";
  const noEventLabel = props.type === "monthly-income" ? "Tidak diterima" : "Tidak ditagih";
  const toast = useToast();

  async function confirm(actualDate: string, actualAmount: string | null) {
    if (!actualAmount) {
      setEditing(true);
      resolve.setError(["Isi nominal aktual."]);
      return;
    }
    const result = await resolve.submit({ outcome: "CONFIRMED", actualDate, actualAmount });
    if (result.ok) {
      toast(`${props.name} dikonfirmasi`);
      const day = Number(actualDate.slice(8, 10));
      if (props.type === "recurring-expense" && props.ruleId && props.expectedDay !== null && day !== props.expectedDay && actualDate.startsWith(props.cycleKey)) {
        setRevisionOffer(day);
      }
      setEditing(false);
    }
  }

  async function markNoEvent() {
    const result = await resolve.submit({ outcome: noEvent });
    if (result.ok) toast(`${props.name} ditandai ${noEventLabel.toLowerCase()}`);
  }

  const confirmed = (
    <div className="flex flex-wrap gap-2">
      {revisionOffer !== null ? (
        <button
          type="button"
          className={buttonClass.secondary}
          disabled={revise.pending}
          onClick={async () => {
            // Schedule changes are explicit and prospective: next month at the earliest.
            const result = await revise.submit({ effectiveFromCycle: nextMonth(today), expectedDay: revisionOffer, expectedAmount: props.suggestedAmount });
            if (result.ok) setRevisionOffer(null);
          }}
        >
          Ubah perkiraan menjadi tanggal {revisionOffer} mulai bulan depan
        </button>
      ) : null}
      <button type="button" className={buttonClass.link} disabled={resolve.pending} onClick={markNoEvent}>
        Tandai {noEventLabel.toLowerCase()}
      </button>
      {props.confirmedEntryId ? (
        <a className={buttonClass.link} href={`/aktivitas/${props.confirmedEntryId}`}>
          Koreksi nominal/tanggal
        </a>
      ) : null}
      <FormErrors errors={resolve.error ?? revise.error} />
    </div>
  );

  const pending = (
    <div className="space-y-3">
      <Collapse open={editing}>
        <div className="grid gap-3 pb-1 sm:grid-cols-2">
          <DateField label="Tanggal aktual" value={date} max={today} onChange={setDate} />
          <AmountInput label="Nominal aktual" value={amount} onChange={setAmount} />
        </div>
      </Collapse>
      <div className="space-y-2">
        {editing ? (
          <button type="button" className={`${buttonClass.primary} w-full`} disabled={resolve.pending} onClick={() => confirm(date, amount)}>
            {resolve.pending ? "Menyimpan…" : props.status === "PENDING" ? "Konfirmasi" : "Konfirmasi masuk terlambat"}
          </button>
        ) : (
          <button type="button" className={`${buttonClass.primary} w-full`} disabled={resolve.pending} onClick={() => confirm(defaultDate, props.suggestedAmount)}>
            {resolve.pending ? "Menyimpan…" : props.status === "PENDING" ? `Konfirmasi sesuai saran${props.suggestedAmount ? ` · ${money(props.suggestedAmount)}` : ""}` : "Konfirmasi masuk terlambat"}
          </button>
        )}
        {/* Secondary actions split the row evenly under the full-width primary action. */}
        <div className="flex gap-2">
          <button type="button" className={`${buttonClass.secondary} flex-1`} aria-expanded={editing} onClick={() => setEditing(!editing)}>
            {editing ? "Tutup detail" : "Ubah detail"}
          </button>
          {props.status === "PENDING" ? (
            <button type="button" className={`${buttonClass.secondary} flex-1`} disabled={resolve.pending} onClick={markNoEvent}>
              {noEventLabel}
            </button>
          ) : null}
        </div>
      </div>
      {!editing ? <p className="text-xs text-muted">Tanggal {formatDate(defaultDate)}</p> : null}
      <FormErrors errors={resolve.error} />
    </div>
  );

  return <Swap swapKey={props.status}>{props.status === "CONFIRMED" ? confirmed : pending}</Swap>;
}

function nextMonth(today: string): string {
  const [year, month] = today.split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

/** `Tutup target`: explicit and final; allocations and transfers stay. */
export function CloseTargetButton({ targetId }: { targetId: string }) {
  const [confirming, setConfirming] = useState(false);
  const close = useMutation(`/api/v1/transfer-targets/${targetId}/close`);
  const toast = useToast();
  return (
    <Swap swapKey={confirming ? "confirm" : "idle"}>
      {confirming ? (
        <div className="space-y-2 bg-review-bg p-3 text-review-fg">
          <p className="text-sm">Target yang ditutup tidak lagi disarankan dan tidak dapat dibuka kembali. Transfer yang sudah terjadi tetap tercatat.</p>
          <div className="flex gap-2">
            <button
              type="button"
              className={buttonClass.danger}
              disabled={close.pending}
              onClick={async () => {
                const result = await close.submit({});
            if (result.ok) toast("Target ditutup");
              }}
            >
              Ya, tutup target
            </button>
            <button type="button" className={buttonClass.secondary} onClick={() => setConfirming(false)}>
              Batal
            </button>
          </div>
          <FormErrors errors={close.error} />
        </div>
      ) : (
        <button type="button" className={buttonClass.link} onClick={() => setConfirming(true)}>
          Tutup target
        </button>
      )}
    </Swap>
  );
}

/** Daily-income exception: an ACTIVE day with a different actual amount (Rp0 = not received). */
export function OverrideForm({ ruleId, minDate }: { ruleId: string; minDate: string }) {
  const today = todayInJakarta();
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState<string | null>("0");
  const save = useMutation<Record<string, unknown>>(`/api/v1/daily-income/${ruleId}/overrides`, "PUT");
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const result = await save.submit({ businessDate: date, amount });
        setSaved(result.ok);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <DateField label="Tanggal" value={date} min={minDate} max={today} onChange={setDate} />
        <AmountInput label="Income yang benar-benar diterima" hint="Rp0 berarti tidak diterima." value={amount} onChange={setAmount} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={buttonClass.primary} disabled={save.pending}>
          {save.pending ? "Menyimpan…" : "Simpan pengecualian"}
        </button>
        <button type="button" className={buttonClass.secondary} disabled={save.pending} onClick={async () => {
          const result = await save.submit({ businessDate: date, amount: null });
          setSaved(result.ok);
        }}>
          Kembalikan ke nominal default
        </button>
      </div>
      <div aria-live="polite">{saved ? <p className="text-sm text-success-fg">Tersimpan.</p> : null}</div>
      <FormErrors errors={save.error} />
    </form>
  );
}
