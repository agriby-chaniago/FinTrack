"use client";

import { useState } from "react";

import { AmountInput } from "@/components/amount-input";
import { Checkbox, DateField, SelectField, TextArea } from "@/components/form";
import { RecordingForm } from "@/components/recording-form";
import { Alert, buttonClass, Money } from "@/components/ui";
import { todayInJakarta } from "@/lib/api-client";
import { money } from "@/lib/format";
import type { RecordingContext } from "@/server/application/recording-context";

type RouteHint = { sourceAccountId: string; destinationAccountId: string; outstanding: string; transferNow: string };
type Component = { subjectId: string; amount: string | null };

export function TransferForm(props: {
  context: RecordingContext;
  prefill: { sourceAccountId: string; destinationAccountId: string; amount: string | null } | null;
  routeHints: RouteHint[];
}) {
  const { context } = props;
  const today = todayInJakarta();
  const firstOther = (id: string) => context.accounts.find((a) => a.id !== id)?.id ?? "";
  // Most transfers go into the reserve, so the default source is the first other account.
  const initialSource = props.prefill?.sourceAccountId ?? context.accounts.find((a) => a.id !== context.reserveAccountId)?.id ?? context.accounts[0]?.id ?? "";
  const [source, setSource] = useState(initialSource);
  const [destination, setDestination] = useState(() => {
    // The Ke list never offers the source, so state must never start equal to it.
    const preferred = props.prefill?.destinationAccountId ?? context.reserveAccountId;
    return preferred && preferred !== initialSource ? preferred : firstOther(initialSource);
  });
  const [amount, setAmount] = useState<string | null>(props.prefill?.amount ?? null);
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [includesExternal, setIncludesExternal] = useState(false);
  const [components, setComponents] = useState<Component[]>([]);

  const heldHere = context.subjects.filter((s) => s.positions.some((p) => p.accountId === source));
  const hint = props.routeHints.find((h) => h.sourceAccountId === source && h.destinationAccountId === destination);

  const external = includesExternal ? components.filter((c) => c.subjectId) : [];

  return (
    <RecordingForm
      path="/api/v1/transfers"
      submitLabel="Simpan transfer"
      validate={() => [
        ...(amount ? [] : ["Isi nominal transfer."]),
        ...(source === destination ? ["Akun asal dan tujuan harus berbeda."] : []),
        ...(external.some((c) => !c.amount) ? ["Isi nominal setiap bagian dana titipan."] : []),
      ]}
      body={() => ({
        sourceAccountId: source,
        destinationAccountId: destination,
        amount,
        externalComponents: external.map((c) => ({ subjectId: c.subjectId, amount: c.amount })),
        businessDate: date,
        note: note.trim() || undefined,
      })}
      onReset={() => {
        setAmount(null);
        setNote("");
        setComponents([]);
        setIncludesExternal(false);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Dari"
          value={source}
          onChange={(value) => {
            setSource(value);
            setComponents([]);
            if (value === destination) setDestination(firstOther(value));
          }}
          options={context.accounts.map((a) => ({ value: a.id, label: a.name }))}
        />
        <SelectField label="Ke" value={destination} onChange={setDestination} options={context.accounts.filter((a) => a.id !== source).map((a) => ({ value: a.id, label: a.name }))} />
      </div>
      {hint && hint.outstanding !== "0" ? (
        <Alert tone="info">
          Sisa saran transfer <Money value={hint.outstanding} />, bisa ditransfer sekarang <Money value={hint.transferNow} />.
        </Alert>
      ) : null}
      <AmountInput label="Nominal transfer" value={amount} onChange={setAmount} />
      <DateField label="Tanggal transfer" value={date} min={context.cutoverDate} max={today} onChange={setDate} />

      {heldHere.length > 0 ? (
        <div className="border border-border p-3">
          <Checkbox
            label="Sebagian adalah dana titipan"
            hint="Pilih jika transfer ini ikut memindahkan uang milik orang lain."
            checked={includesExternal}
            onChange={(checked) => {
              setIncludesExternal(checked);
              if (checked && components.length === 0) setComponents([{ subjectId: heldHere[0].id, amount: null }]);
            }}
          />
          {includesExternal ? (
            <div className="mt-3 space-y-3">
              {components.map((component, index) => (
                <div key={index} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <SelectField
                    label="Milik"
                    value={component.subjectId}
                    onChange={(value) => setComponents(components.map((c, i) => (i === index ? { ...c, subjectId: value } : c)))}
                    options={heldHere.map((s) => ({ value: s.id, label: `${s.name} · ${money(s.positions.find((p) => p.accountId === source)?.amount ?? "0")}` }))}
                  />
                  <AmountInput label="Bagian titipan" value={component.amount} onChange={(value) => setComponents(components.map((c, i) => (i === index ? { ...c, amount: value } : c)))} />
                  <button type="button" className={buttonClass.link} onClick={() => setComponents(components.filter((_, i) => i !== index))}>
                    Hapus
                  </button>
                </div>
              ))}
              {components.length < heldHere.length ? (
                <button type="button" className={buttonClass.link} onClick={() => setComponents([...components, { subjectId: heldHere.find((s) => !components.some((c) => c.subjectId === s.id))!.id, amount: null }])}>
                  Tambah pemilik lain
                </button>
              ) : null}
              <p className="text-sm text-muted">Sisanya dihitung sebagai uang pribadi Anda.</p>
            </div>
          ) : null}
        </div>
      ) : null}

      <TextArea label="Catatan (opsional)" value={note} onChange={setNote} />
    </RecordingForm>
  );
}
