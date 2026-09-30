"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AmountInput } from "@/components/amount-input";
import { DateField, FormErrors, SubmitBar, SubmitButton } from "@/components/form";
import { Alert, buttonClass, Card, Money, SectionTitle } from "@/components/ui";
import { useMutation } from "@/lib/api-client";
import { formatDate, formatDateTime, jakartaInputValue, jakartaIso } from "@/lib/format";
import type { SettlementView } from "@/server/application/settlement";

import { ReconstructionList, settlementWarning } from "./reconstruction";

function defaultClosing(endDate: string, nowInput: string): string {
  return nowInput.startsWith(endDate) ? nowInput : `${endDate}T21:00`;
}

function ClosingFields(props: {
  endDate: string;
  nowInput: string;
  amount: string | null;
  onAmount: (value: string | null) => void;
  closing: string;
  onClosing: (value: string) => void;
}) {
  const max = props.nowInput.startsWith(props.endDate) ? props.nowInput : `${props.endDate}T23:59`;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <AmountInput label="Saldo DANA saat penutupan" hint="Sesuai aplikasi DANA, sebelum sisa ditransfer ke reserve." value={props.amount} onChange={props.onAmount} />
      <DateField type="datetime-local" label="Waktu saldo dilihat" value={props.closing} min={`${props.endDate}T00:00`} max={max} onChange={props.onClosing} />
    </div>
  );
}

export function StartSettlement(props: { mode: "NORMAL" | "OVERDUE"; periodStart: string; normalEnd: string; today: string; nowInput: string }) {
  const router = useRouter();
  const { nowInput } = props;
  const [catchUp, setCatchUp] = useState(false);
  const [endDate, setEndDate] = useState(props.normalEnd);
  const [amount, setAmount] = useState<string | null>(null);
  const [closing, setClosing] = useState(() => defaultClosing(props.normalEnd, nowInput));
  const create = useMutation<Record<string, unknown>, { id: string }>("/api/v1/settlements");

  function chooseEnd(next: string) {
    setEndDate(next);
    setClosing(defaultClosing(next, nowInput));
  }

  return (
    <form
      className="space-y-5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!amount) {
          create.setError(["Isi saldo DANA saat penutupan."]);
          return;
        }
        const result = await create.submit({ endDate, closingPhysicalBalance: amount, closingAt: jakartaIso(closing) });
        if (result.ok) router.refresh();
      }}
    >
      <Card>
        <SectionTitle>Periode</SectionTitle>
        <p className="text-sm">
          {formatDate(props.periodStart)} – {formatDate(endDate)}
        </p>
        {props.mode === "OVERDUE" ? (
          <div className="mt-3 space-y-2">
            <Alert tone="review" title="Settlement terlambat">
              Jika Anda masih tahu saldo DANA pada {formatDate(props.normalEnd)}, gunakan periode normal. Jika tidak, gabungkan sampai tanggal saldo yang Anda ketahui.
            </Alert>
            <fieldset className="space-y-1">
              <legend className="sr-only">Pilih akhir periode</legend>
              <label className="flex min-h-11 items-center gap-3">
                <input type="radio" name="range" className="radio radio-primary" checked={!catchUp} onChange={() => { setCatchUp(false); chooseEnd(props.normalEnd); }} />
                <span className="text-sm">Periode normal sampai {formatDate(props.normalEnd)}</span>
              </label>
              <label className="flex min-h-11 items-center gap-3">
                <input type="radio" name="range" className="radio radio-primary" checked={catchUp} onChange={() => { setCatchUp(true); chooseEnd(props.today); }} />
                <span className="text-sm">Catch-up sampai tanggal saldo yang diketahui</span>
              </label>
            </fieldset>
            {catchUp ? <DateField label="Akhir periode" value={endDate} min={props.normalEnd} max={props.today} onChange={chooseEnd} /> : null}
          </div>
        ) : null}
      </Card>

      <Card>
        <SectionTitle>Saldo penutupan</SectionTitle>
        <ClosingFields endDate={endDate} nowInput={nowInput} amount={amount} onAmount={setAmount} closing={closing} onClosing={setClosing} />
      </Card>

      <FormErrors errors={create.error} />
      <SubmitBar>
        <SubmitButton pending={create.pending}>Lihat hasil settlement</SubmitButton>
      </SubmitBar>
    </form>
  );
}

export function SettlementDraft({ draft, nowInput }: { draft: SettlementView; nowInput: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(draft.preview === null);
  const [amount, setAmount] = useState<string | null>(draft.closingPhysicalBalance);
  const [closing, setClosing] = useState(() => (draft.closingAt ? jakartaInputValue(draft.closingAt) : defaultClosing(draft.endDate, nowInput)));
  const update = useMutation<Record<string, unknown>>(`/api/v1/settlements/${draft.id}`, "PATCH");
  const settle = useMutation<Record<string, never>>(`/api/v1/settlements/${draft.id}/settle`);
  const remove = useMutation<undefined>(`/api/v1/settlements/${draft.id}`, "DELETE");
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle>Periode</SectionTitle>
        <p className="text-sm">
          {formatDate(draft.startDate)} – {formatDate(draft.endDate)}
          {draft.nonstandard ? " · catch-up" : ""}
        </p>
      </Card>

      <Card>
        <SectionTitle
          action={
            !editing ? (
              <button type="button" className={buttonClass.link} onClick={() => setEditing(true)}>
                Ubah saldo penutupan
              </button>
            ) : null
          }
        >
          Saldo penutupan
        </SectionTitle>
        {editing ? (
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!amount) {
                update.setError(["Isi saldo DANA saat penutupan."]);
                return;
              }
              const result = await update.submit({ closingPhysicalBalance: amount, closingAt: jakartaIso(closing) }, { ifMatch: draft.version });
              if (result.ok) {
                setEditing(false);
                router.refresh();
              }
            }}
          >
            <ClosingFields endDate={draft.endDate} nowInput={nowInput} amount={amount} onAmount={setAmount} closing={closing} onClosing={setClosing} />
            <FormErrors errors={update.error} />
            <button type="submit" className={buttonClass.primary} disabled={update.pending}>
              {update.pending ? "Menghitung…" : "Hitung ulang"}
            </button>
          </form>
        ) : (
          <p className="text-sm">
            <Money value={draft.closingPhysicalBalance} /> · dilihat {formatDateTime(draft.closingAt)}
          </p>
        )}
      </Card>

      {draft.preview ? (
        <Card>
          <SectionTitle>Hasil rekonstruksi</SectionTitle>
          <div className="space-y-2">
            {draft.warnings.map((code) => (
              <Alert key={code} tone="review" title={settlementWarning[code]?.title ?? code}>
                {settlementWarning[code]?.body}
              </Alert>
            ))}
          </div>
          <ReconstructionList values={draft.preview} />
          <p className="mt-3 text-sm text-muted">Setelah diselesaikan, settlement tidak dapat diubah. Koreksi berikutnya tampil sebagai nilai setelah koreksi.</p>
        </Card>
      ) : null}

      <FormErrors errors={settle.error ?? remove.error} />
      <SubmitBar>
        <button
          type="button"
          className={`${buttonClass.primary} flex-1 md:flex-none`}
          disabled={!draft.preview || editing || settle.pending}
          onClick={async () => {
            const result = await settle.submit({}, { ifMatch: draft.version });
            if (result.ok) router.push(`/rutinitas/settlement/${draft.id}`);
          }}
        >
          {settle.pending ? "Menyimpan…" : "Selesaikan settlement"}
        </button>
        {confirmDelete ? (
          <button
            type="button"
            className={buttonClass.danger}
            disabled={remove.pending}
            onClick={async () => {
              const result = await remove.submit(undefined);
              if (result.ok) router.refresh();
            }}
          >
            Ya, hapus draft
          </button>
        ) : (
          <button type="button" className={buttonClass.secondary} onClick={() => setConfirmDelete(true)}>
            Hapus draft
          </button>
        )}
      </SubmitBar>
    </div>
  );
}
