"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AmountInput } from "@/components/amount-input";
import { CutoverDayQuestion, DateField, FormErrors, SelectField, TextArea } from "@/components/form";
import { Alert, buttonClass, Money } from "@/components/ui";
import { todayInJakarta, useMutation } from "@/lib/api-client";
import { jakartaIso } from "@/lib/format";
import type { ReconciliationView } from "@/server/application/reconciliation";

/** `Update saldo` outside weekly settlement: the provider's physical balance only. */
export function BalanceConfirmationForm({ accountId, nowInput, onDone }: { accountId: string; nowInput: string; onDone?: () => void }) {
  const router = useRouter();
  const [amount, setAmount] = useState<string | null>(null);
  const [asOf, setAsOf] = useState(nowInput);
  const save = useMutation<Record<string, unknown>, ReconciliationView>("/api/v1/balance-confirmations");
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!amount) {
          save.setError(["Isi saldo sesuai aplikasi."]);
          return;
        }
        const result = await save.submit({ accountId, physicalBalance: amount, asOf: jakartaIso(asOf) });
        if (result.ok) {
          onDone?.();
          router.push(`/akun/${accountId}#rekonsiliasi`);
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <AmountInput label="Saldo sesuai aplikasi" hint="Total saldo yang terlihat, termasuk dana titipan." value={amount} onChange={setAmount} />
        <DateField type="datetime-local" label="Waktu saldo dilihat" value={asOf} max={nowInput} onChange={setAsOf} />
      </div>
      <FormErrors errors={save.error} />
      <button type="submit" className={buttonClass.primary} disabled={save.pending}>
        {save.pending ? "Menyimpan…" : "Konfirmasi saldo"}
      </button>
    </form>
  );
}

type Choice = "MISSING_EVENT" | "TYPO" | "ADJUST";

/**
 * Discrepancy resolution (PRD): record the missed event, replace a mistyped
 * confirmation, or make an explicit adjustment for an unknown cause.
 */
export function DiscrepancyResolver(props: { view: ReconciliationView; accountId: string; weekly: boolean; cutoverDate: string }) {
  const today = todayInJakarta();
  const discrepancy = props.view.discrepancy;
  const positive = !discrepancy.startsWith("-");
  const magnitude = discrepancy.replace(/^-/, "");
  const [choice, setChoice] = useState<Choice>("MISSING_EVENT");
  const [amount, setAmount] = useState<string | null>(magnitude);
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [replacement, setReplacement] = useState<string | null>(null);
  const event = useMutation<Record<string, unknown>>("/api/v1/events");
  const replace = useMutation<Record<string, unknown>>(`/api/v1/balance-confirmations/${props.view.confirmationId}/replacements`);
  const adjust = useMutation<Record<string, unknown>>("/api/v1/balance-adjustments");

  async function recordEvent(cutoverDayAnswer?: string) {
    if (!amount) {
      event.setError(["Isi nominal."]);
      return;
    }
    await event.submit({
      direction: positive ? "INCOME" : "EXPENSE",
      accountId: props.accountId,
      amount,
      businessDate: date,
      note: note.trim() || undefined,
      ...(cutoverDayAnswer ? { cutoverDayAnswer } : {}),
    });
  }

  return (
    <div className="space-y-4">
      <SelectField
        label="Apa penyebab selisihnya?"
        value={choice}
        onChange={(value) => setChoice(value as Choice)}
        options={[
          { value: "MISSING_EVENT", label: positive ? "Ada income yang belum dicatat" : "Ada pengeluaran yang belum dicatat" },
          { value: "TYPO", label: "Saldo yang saya masukkan salah ketik" },
          { value: "ADJUST", label: "Tidak tahu, sesuaikan saldo" },
        ]}
      />

      {choice === "MISSING_EVENT" ? (
        props.weekly && !positive ? (
          <Alert tone="info">Pengeluaran dari akun mingguan dicatat sebagai pengeluaran khusus melalui menu Catat.</Alert>
        ) : (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              await recordEvent();
            }}
          >
            <p className="text-sm text-muted">
              Catat sebagai {positive ? "income lain" : "pengeluaran lain"}. Untuk transfer atau dana titipan, gunakan menu Catat.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <AmountInput label="Nominal" value={amount} onChange={setAmount} />
              <DateField label="Tanggal" value={date} min={props.cutoverDate} max={today} onChange={setDate} />
            </div>
            <TextArea label="Keterangan (opsional)" value={note} onChange={setNote} />
            {event.needsCutoverAnswer ? <CutoverDayQuestion pending={event.pending} onAnswer={(answer) => recordEvent(answer)} /> : null}
            <FormErrors errors={event.error} />
            <button type="submit" className={buttonClass.primary} disabled={event.pending}>
              {event.pending ? "Menyimpan…" : positive ? "Catat income" : "Catat pengeluaran"}
            </button>
          </form>
        )
      ) : null}

      {choice === "TYPO" ? (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!replacement) {
              replace.setError(["Isi saldo yang benar."]);
              return;
            }
            await replace.submit({ physicalBalance: replacement });
          }}
        >
          <p className="text-sm text-muted">
            Saldo tercatat <Money value={props.view.confirmedPhysical} />. Konfirmasi lama tetap tersimpan sebagai riwayat.
          </p>
          <AmountInput label="Saldo yang benar" value={replacement} onChange={setReplacement} />
          <FormErrors errors={replace.error} />
          <button type="submit" className={buttonClass.primary} disabled={replace.pending}>
            {replace.pending ? "Menyimpan…" : "Ganti saldo"}
          </button>
        </form>
      ) : null}

      {choice === "ADJUST" ? (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            await adjust.submit({ balanceConfirmationId: props.view.confirmationId, reason: "UNKNOWN_DISCREPANCY", note: note.trim() || undefined });
          }}
        >
          <p className="text-sm text-muted">
            FinTrack menambah penyesuaian <Money value={discrepancy} signed /> pada uang pribadi. Penyesuaian bukan income, pengeluaran, atau transfer.
          </p>
          <TextArea label="Keterangan (opsional)" value={note} onChange={setNote} />
          <FormErrors errors={adjust.error} />
          <button type="submit" className={buttonClass.primary} disabled={adjust.pending}>
            {adjust.pending ? "Menyimpan…" : "Sesuaikan saldo"}
          </button>
        </form>
      ) : null}
    </div>
  );
}

/** `Catat income/expense lain` from Detail Akun. */
export function OtherEventForm({ accountId, weekly, cutoverDate }: { accountId: string; weekly: boolean; cutoverDate: string }) {
  const today = todayInJakarta();
  const [direction, setDirection] = useState<"INCOME" | "EXPENSE">("INCOME");
  const [formKey, setFormKey] = useState(0);
  const [amount, setAmount] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const save = useMutation<Record<string, unknown>>("/api/v1/events");

  async function submit(cutoverDayAnswer?: string) {
    if (!amount) {
      save.setError(["Isi nominal."]);
      return;
    }
    const result = await save.submit({ direction, accountId, amount, businessDate: date, note: note.trim() || undefined, ...(cutoverDayAnswer ? { cutoverDayAnswer } : {}) });
    if (result.ok) {
      setSaved(true);
      setAmount(null);
      setNote("");
      setFormKey((key) => key + 1);
    }
  }

  return (
    <form
      key={formKey}
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaved(false);
        await submit();
      }}
    >
      {weekly ? null : (
        <SelectField
          label="Jenis"
          value={direction}
          onChange={(value) => setDirection(value as "INCOME" | "EXPENSE")}
          options={[
            { value: "INCOME", label: "Income lain" },
            { value: "EXPENSE", label: "Pengeluaran lain" },
          ]}
        />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <AmountInput label="Nominal" value={amount} onChange={setAmount} />
        <DateField label="Tanggal" value={date} min={cutoverDate} max={today} onChange={setDate} />
      </div>
      <TextArea label="Keterangan (opsional)" value={note} onChange={setNote} />
      {save.needsCutoverAnswer ? <CutoverDayQuestion pending={save.pending} onAnswer={(answer) => submit(answer)} /> : null}
      <FormErrors errors={save.error} />
      <div aria-live="polite">{saved ? <p className="text-sm text-success-fg">Tersimpan.</p> : null}</div>
      <button type="submit" className={buttonClass.primary} disabled={save.pending}>
        {save.pending ? "Menyimpan…" : "Simpan"}
      </button>
    </form>
  );
}
