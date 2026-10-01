"use client";

import { useState } from "react";

import { AmountInput } from "@/components/amount-input";
import { DateField, SelectField, TextArea, TextField } from "@/components/form";
import { RecordingForm } from "@/components/recording-form";
import { todayInJakarta } from "@/lib/api-client";
import type { RecordingContext } from "@/server/application/recording-context";

const NEW_CATEGORY = "__new__";

export function SpecialExpenseForm({ context }: { context: RecordingContext }) {
  const today = todayInJakarta();
  const [amount, setAmount] = useState<string | null>(null);
  const [category, setCategory] = useState(context.categories[0]?.id ?? NEW_CATEGORY);
  const [newCategory, setNewCategory] = useState("");
  const [source, setSource] = useState(context.defaultSpecialSourceAccountId ?? context.accounts[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");

  return (
    <RecordingForm
      path="/api/v1/special-expenses"
      submitLabel="Simpan pengeluaran"
      validate={() => [...(amount ? [] : ["Isi nominal."]), ...(category === NEW_CATEGORY && !newCategory.trim() ? ["Isi nama kategori baru."] : [])]}
      body={() => ({
        amount,
        ...(category === NEW_CATEGORY ? { newCategoryName: newCategory.trim() } : { categoryId: category }),
        sourceAccountId: source,
        businessDate: date,
        note: note.trim() || undefined,
      })}
      onReset={() => {
        setAmount(null);
        setNote("");
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
    </RecordingForm>
  );
}
