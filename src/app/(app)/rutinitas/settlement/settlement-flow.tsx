"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AmountInput } from "@/components/amount-input";
import { Checkbox, DateField, FormErrors, SubmitBar, SubmitButton } from "@/components/form";
import { Reveal, Swap } from "@/components/motion";
import { Alert, buttonClass, Card, Money, SectionTitle } from "@/components/ui";
import { useMutation } from "@/lib/api-client";
import { formatDate, formatDateTime, jakartaInputValue, jakartaIso } from "@/lib/format";
import type { SettlementView } from "@/server/application/settlement";

import { ReconstructionList, settlementWarning } from "./reconstruction";

function defaultClosing(endDate: string, nowInput: string): string {
  return nowInput.startsWith(endDate) ? nowInput : `${endDate}T21:00`;
}

type CashState = { tracked: boolean; canStart: boolean };
type CashValues = { closing: string | null; start: boolean; startAmount: string | null };

/**
 * Tunai (PRD v0.19): once tracked, the wallet count is required at every
 * closing; until then the settlement offers `Mulai lacak uang tunai`.
 */
function CashFields({ state, values, onChange }: { state: CashState; values: CashValues; onChange: (next: CashValues) => void }) {
  if (state.tracked) {
    return (
      <AmountInput
        label="Uang tunai di dompet"
        hint="Hitung uang fisik di dompet pada waktu yang sama. Sisa tunai tidak dihitung sebagai biaya hidup."
        value={values.closing}
        onChange={(closing) => onChange({ ...values, closing })}
      />
    );
  }
  if (!state.canStart) return null;
  return (
    <div className="border border-border p-3">
      <Checkbox
        label="Mulai lacak uang tunai"
        hint="Mulai periode berikutnya, tarik tunai dari DANA tidak perlu dicatat dan sisa uang di dompet tidak dihitung sebagai biaya hidup."
        checked={values.start}
        onChange={(start) => onChange({ ...values, start })}
      />
      {values.start ? (
        <AmountInput label="Uang tunai di dompet sekarang" value={values.startAmount} onChange={(startAmount) => onChange({ ...values, startAmount })} />
      ) : null}
    </div>
  );
}

/** Request fields and inline issues for the wallet part of a closing. */
function cashBody(state: CashState, values: CashValues): { body: Record<string, unknown>; issues: string[] } {
  if (state.tracked) {
    return values.closing === null ? { body: {}, issues: ["Isi uang tunai di dompet."] } : { body: { cashClosingBalance: values.closing }, issues: [] };
  }
  if (!state.canStart) return { body: {}, issues: [] };
  if (!values.start) return { body: { startCashTracking: null }, issues: [] };
  return values.startAmount === null
    ? { body: {}, issues: ["Isi uang tunai di dompet sekarang."] }
    : { body: { startCashTracking: values.startAmount }, issues: [] };
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

export function StartSettlement(props: { mode: "NORMAL" | "OVERDUE"; periodStart: string; normalEnd: string; today: string; nowInput: string; cash: CashState }) {
  const { nowInput } = props;
  const [cash, setCash] = useState<CashValues>({ closing: null, start: false, startAmount: null });
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
        const wallet = cashBody(props.cash, cash);
        const issues = [...(amount ? [] : ["Isi saldo DANA saat penutupan."]), ...wallet.issues];
        if (issues.length) {
          create.setError(issues);
          return;
        }
        await create.submit({ endDate, closingPhysicalBalance: amount, closingAt: jakartaIso(closing), ...wallet.body });
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
        <div className="space-y-4">
          <ClosingFields endDate={endDate} nowInput={nowInput} amount={amount} onAmount={setAmount} closing={closing} onClosing={setClosing} />
          <CashFields state={props.cash} values={cash} onChange={setCash} />
        </div>
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
  const [cash, setCash] = useState<CashValues>({
    closing: draft.cash.closingPhysicalBalance,
    start: draft.cash.startTracking !== null,
    startAmount: draft.cash.startTracking,
  });
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
        <Swap swapKey={editing ? "edit" : "summary"}>
          {editing ? (
            <form
              className="space-y-4"
              onSubmit={async (event) => {
                event.preventDefault();
                const wallet = cashBody(draft.cash, cash);
                const issues = [...(amount ? [] : ["Isi saldo DANA saat penutupan."]), ...wallet.issues];
                if (issues.length) {
                  update.setError(issues);
                  return;
                }
                const result = await update.submit({ closingPhysicalBalance: amount, closingAt: jakartaIso(closing), ...wallet.body }, { ifMatch: draft.version });
                if (result.ok) {
                  setEditing(false);
                }
              }}
            >
              <ClosingFields endDate={draft.endDate} nowInput={nowInput} amount={amount} onAmount={setAmount} closing={closing} onClosing={setClosing} />
              <CashFields state={draft.cash} values={cash} onChange={setCash} />
              <FormErrors errors={update.error} />
              <button type="submit" className={buttonClass.primary} disabled={update.pending}>
                {update.pending ? "Menghitung…" : "Hitung ulang"}
              </button>
            </form>
          ) : (
            <div className="space-y-1 text-sm">
              <p>
                DANA <Money value={draft.closingPhysicalBalance} /> · dilihat {formatDateTime(draft.closingAt)}
              </p>
              {draft.cash.tracked ? (
                <p>
                  Tunai di dompet <Money value={draft.cash.closingPhysicalBalance} />
                </p>
              ) : null}
              {draft.cash.startTracking !== null ? (
                <p className="text-calculated-fg">
                  Tunai mulai dilacak dengan <Money value={draft.cash.startTracking} /> setelah settlement ini. Setelah diselesaikan, nilai awal ini tidak dapat diubah.
                </p>
              ) : null}
            </div>
          )}
        </Swap>
      </Card>

      {draft.preview ? (
        <Reveal revealKey={String(draft.version)}>
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
        </Reveal>
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
              await remove.submit(undefined);
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
