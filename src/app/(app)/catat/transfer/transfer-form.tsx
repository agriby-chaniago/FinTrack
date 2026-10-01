"use client";

import { useState } from "react";

import { AmountInput } from "@/components/amount-input";
import { Checkbox, CutoverDayQuestion, DateField, FormErrors, SelectField, SubmitBar, SubmitButton, TextArea } from "@/components/form";
import { Recorded, type PostResult } from "@/components/recorded";
import { Alert, buttonClass, Money } from "@/components/ui";
import { todayInJakarta, useMutation } from "@/lib/api-client";
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
  const initialSource = props.prefill?.sourceAccountId ?? context.accounts[0]?.id ?? "";
  const [formKey, setFormKey] = useState(0);
  const [source, setSource] = useState(initialSource);
  const [destination, setDestination] = useState(props.prefill?.destinationAccountId ?? context.reserveAccountId ?? firstOther(initialSource));
  const [amount, setAmount] = useState<string | null>(props.prefill?.amount ?? null);
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [includesExternal, setIncludesExternal] = useState(false);
  const [components, setComponents] = useState<Component[]>([]);
  const [done, setDone] = useState<PostResult | null>(null);
  const save = useMutation<Record<string, unknown>, PostResult>("/api/v1/transfers");

  const heldHere = context.subjects.filter((s) => s.positions.some((p) => p.accountId === source));
  const hint = props.routeHints.find((h) => h.sourceAccountId === source && h.destinationAccountId === destination);

  async function submit(cutoverDayAnswer?: string) {
    const issues: string[] = [];
    if (!amount) issues.push("Isi nominal transfer.");
    if (source === destination) issues.push("Akun asal dan tujuan harus berbeda.");
    const external = includesExternal ? components.filter((c) => c.subjectId) : [];
    if (external.some((c) => !c.amount)) issues.push("Isi nominal setiap bagian dana titipan.");
    if (issues.length) {
      save.setError(issues);
      return;
    }
    const result = await save.submit({
      sourceAccountId: source,
      destinationAccountId: destination,
      amount,
      externalComponents: external.map((c) => ({ subjectId: c.subjectId, amount: c.amount })),
      businessDate: date,
      note: note.trim() || undefined,
      ...(cutoverDayAnswer ? { cutoverDayAnswer } : {}),
    });
    if (result.ok) setDone(result.data);
  }

  if (done) {
    return (
      <Recorded
        result={done}
        onAgain={() => {
          setDone(null);
          setAmount(null);
          setNote("");
          setComponents([]);
          setIncludesExternal(false);
          setFormKey((key) => key + 1);
        }}
      />
    );
  }

  return (
    <form
      key={formKey}
      className="max-w-xl space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        await submit();
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
      {save.needsCutoverAnswer ? <CutoverDayQuestion pending={save.pending} onAnswer={(answer) => submit(answer)} /> : null}
      <FormErrors errors={save.error} />
      <SubmitBar>
        <SubmitButton pending={save.pending}>Simpan transfer</SubmitButton>
      </SubmitBar>
    </form>
  );
}
