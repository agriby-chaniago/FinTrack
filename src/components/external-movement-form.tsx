"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AmountInput } from "@/components/amount-input";
import { CutoverDayQuestion, DateField, FormErrors, SelectField, SubmitBar, SubmitButton, TextArea, TextField } from "@/components/form";
import { Recorded, type PostResult } from "@/components/recorded";
import { todayInJakarta, useMutation } from "@/lib/api-client";
import { money } from "@/lib/format";
import { movementTypeLabel } from "@/lib/labels";
import type { RecordingContext } from "@/server/application/recording-context";

export type MovementType = "RECEIPT" | "RETURN" | "OWNER_USE" | "INTERNAL_TRANSFER" | "CONVERT_TO_PERSONAL" | "CONVERT_TO_EXTERNAL";

const description: Record<MovementType, string> = {
  RECEIPT: "Uang milik orang lain masuk ke akun Anda.",
  RETURN: "Uang dikembalikan kepada pemiliknya.",
  OWNER_USE: "Uang dipakai untuk membayar kebutuhan pemiliknya.",
  INTERNAL_TRANSFER: "Dana titipan dipindah dari satu akun Anda ke akun lain.",
  CONVERT_TO_PERSONAL: "Pemilik merelakan uangnya menjadi milik Anda.",
  CONVERT_TO_EXTERNAL: "Sebagian uang pribadi Anda menjadi milik orang lain.",
};

const NEW_SUBJECT = "__new__";

/** Every external-fund movement (PRD: External fund workflow), one form. */
export function ExternalMovementForm(props: { context: RecordingContext; types: MovementType[]; subjectId?: string }) {
  const { context } = props;
  const router = useRouter();
  const today = todayInJakarta();
  const [type, setType] = useState<MovementType>(props.types[0]);
  const creates = type === "RECEIPT" || type === "CONVERT_TO_EXTERNAL";
  const openSubjects = context.subjects.filter((s) => s.positions.length > 0);
  const choosable = creates ? context.subjects : openSubjects;
  const [subject, setSubject] = useState(props.subjectId ?? choosable[0]?.id ?? NEW_SUBJECT);
  const [subjectName, setSubjectName] = useState("");
  const held = context.subjects.find((s) => s.id === subject)?.positions ?? [];
  const [account, setAccount] = useState(held[0]?.accountId ?? context.accounts[0]?.id ?? "");
  const [toAccount, setToAccount] = useState(context.accounts.find((a) => a.id !== account)?.id ?? "");
  const [formKey, setFormKey] = useState(0);
  const [amount, setAmount] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [done, setDone] = useState<PostResult | null>(null);
  const save = useMutation<Record<string, unknown>, PostResult>("/api/v1/external-movements");

  const accountOptions = (creates ? context.accounts : context.accounts.filter((a) => held.some((p) => p.accountId === a.id))).map((a) => {
    const position = held.find((p) => p.accountId === a.id);
    return { value: a.id, label: position && !creates ? `${a.name} · ${money(position.amount)}` : a.name };
  });

  function chooseType(next: MovementType) {
    setType(next);
    const nextCreates = next === "RECEIPT" || next === "CONVERT_TO_EXTERNAL";
    if (!nextCreates && subject === NEW_SUBJECT) setSubject(props.subjectId ?? openSubjects[0]?.id ?? NEW_SUBJECT);
  }

  function chooseSubject(next: string) {
    setSubject(next);
    const positions = context.subjects.find((s) => s.id === next)?.positions ?? [];
    if (!creates && positions[0]) setAccount(positions[0].accountId);
  }

  async function submit(cutoverDayAnswer?: string) {
    const issues: string[] = [];
    if (!amount) issues.push("Isi nominal.");
    if (subject === NEW_SUBJECT && !subjectName.trim()) issues.push("Isi nama pemilik dana.");
    if (type === "INTERNAL_TRANSFER" && account === toAccount) issues.push("Akun asal dan tujuan harus berbeda.");
    if (issues.length) {
      save.setError(issues);
      return;
    }
    const subjectRef = subject === NEW_SUBJECT ? { subjectName: subjectName.trim() } : { subjectId: subject };
    const accounts = type === "INTERNAL_TRANSFER" ? { fromAccountId: account, toAccountId: toAccount } : { accountId: account };
    const result = await save.submit({
      type,
      ...accounts,
      ...subjectRef,
      amount,
      businessDate: date,
      note: note.trim() || undefined,
      ...(cutoverDayAnswer ? { cutoverDayAnswer } : {}),
    });
    if (result.ok) {
      setDone(result.data);
      router.refresh();
    }
  }

  if (done) {
    return (
      <Recorded
        result={done}
        onAgain={() => {
          setDone(null);
          setAmount(null);
          setNote("");
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
      {props.types.length > 1 ? (
        <fieldset>
          <legend className="text-sm font-medium">Jenis</legend>
          <div className="mt-1 space-y-1">
            {props.types.map((option) => (
              <label key={option} className="flex min-h-11 items-start gap-3 rounded-lg px-2 py-2 hover:bg-surface-subtle">
                <input type="radio" name="movement-type" className="radio radio-primary mt-0.5" checked={type === option} onChange={() => chooseType(option)} />
                <span>
                  <span className="block text-sm font-medium">{movementTypeLabel[option]}</span>
                  <span className="block text-sm text-muted">{description[option]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <p className="text-sm text-muted">{description[type]}</p>
      )}

      {props.subjectId ? null : (
        <>
          <SelectField
            label="Pemilik dana"
            value={subject}
            onChange={chooseSubject}
            options={[...choosable.map((s) => ({ value: s.id, label: s.name })), ...(creates ? [{ value: NEW_SUBJECT, label: "Orang baru…" }] : [])]}
          />
          {subject === NEW_SUBJECT ? <TextField label="Nama pemilik" value={subjectName} maxLength={80} onChange={setSubjectName} /> : null}
        </>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label={type === "INTERNAL_TRANSFER" ? "Dari akun" : "Akun"} value={account} onChange={setAccount} options={accountOptions} />
        {type === "INTERNAL_TRANSFER" ? (
          <SelectField label="Ke akun" value={toAccount} onChange={setToAccount} options={context.accounts.filter((a) => a.id !== account).map((a) => ({ value: a.id, label: a.name }))} />
        ) : null}
      </div>
      <AmountInput label="Nominal" value={amount} onChange={setAmount} />
      <DateField label="Tanggal" value={date} min={context.cutoverDate} max={today} onChange={setDate} />
      <TextArea label="Catatan (opsional)" value={note} onChange={setNote} />
      {save.needsCutoverAnswer ? <CutoverDayQuestion pending={save.pending} onAnswer={(answer) => submit(answer)} /> : null}
      <FormErrors errors={save.error} />
      <SubmitBar>
        <SubmitButton pending={save.pending}>Simpan</SubmitButton>
      </SubmitBar>
    </form>
  );
}
