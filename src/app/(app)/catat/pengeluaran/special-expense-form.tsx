"use client";

import { useState } from "react";

import { AmountInput } from "@/components/amount-input";
import { CutoverDayQuestion, DateField, FormErrors, SelectField, SubmitBar, SubmitButton, TextArea, TextField } from "@/components/form";
import { Recorded, type PostResult } from "@/components/recorded";
import { todayInJakarta, useMutation } from "@/lib/api-client";
import type { RecordingContext } from "@/server/application/recording-context";

const NEW_CATEGORY = "__new__";

export function SpecialExpenseForm({ context }: { context: RecordingContext }) {
  const today = todayInJakarta();
  const [formKey, setFormKey] = useState(0);
  const [amount, setAmount] = useState<string | null>(null);
  const [category, setCategory] = useState(context.categories[0]?.id ?? NEW_CATEGORY);
  const [newCategory, setNewCategory] = useState("");
  const [source, setSource] = useState(context.defaultSpecialSourceAccountId ?? context.accounts[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [done, setDone] = useState<PostResult | null>(null);
  const save = useMutation<Record<string, unknown>, PostResult>("/api/v1/special-expenses");

  async function submit(cutoverDayAnswer?: string) {
    const issues: string[] = [];
    if (!amount) issues.push("Isi nominal.");
    if (category === NEW_CATEGORY && !newCategory.trim()) issues.push("Isi nama kategori baru.");
    if (issues.length) {
      save.setError(issues);
      return;
    }
    const result = await save.submit({
      amount,
      ...(category === NEW_CATEGORY ? { newCategoryName: newCategory.trim() } : { categoryId: category }),
      sourceAccountId: source,
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
      <AmountInput label="Nominal" value={amount} onChange={setAmount} />
      <SelectField
        label="Kategori"
        value={category}
        onChange={setCategory}
        options={[...context.categories.map((c) => ({ value: c.id, label: c.name })), { value: NEW_CATEGORY, label: "Lainnya…" }]}
      />
      {category === NEW_CATEGORY ? <TextField label="Nama kategori baru" value={newCategory} maxLength={60} onChange={setNewCategory} hint="Kategori baru bisa dipakai lagi nanti." /> : null}
      <SelectField label="Dibayar dari" value={source} onChange={setSource} options={context.accounts.map((a) => ({ value: a.id, label: a.name }))} />
      <DateField label="Tanggal" value={date} min={context.cutoverDate} max={today} onChange={setDate} />
      <TextArea label="Catatan (opsional)" value={note} onChange={setNote} />
      {save.needsCutoverAnswer ? <CutoverDayQuestion pending={save.pending} onAnswer={(answer) => submit(answer)} /> : null}
      <FormErrors errors={save.error} />
      <SubmitBar>
        <SubmitButton pending={save.pending}>Simpan pengeluaran</SubmitButton>
      </SubmitBar>
    </form>
  );
}
