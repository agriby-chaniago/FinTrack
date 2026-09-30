"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AmountInput } from "@/components/amount-input";
import { CutoverDayQuestion, DateField, FormErrors, SelectField, TextArea, TextField } from "@/components/form";
import { buttonClass } from "@/components/ui";
import { todayInJakarta, useMutation } from "@/lib/api-client";

const NEW_CATEGORY = "__new__";

type Props = {
  entryId: string;
  eventClass: string;
  amount: string;
  businessDate: string;
  note: string | null;
  categoryId: string | null;
  categories: { id: string; name: string }[];
  allowVoid: boolean;
};

export function CorrectionForm(props: Props) {
  const router = useRouter();
  const today = todayInJakarta();
  const [amount, setAmount] = useState<string | null>(props.amount);
  const [date, setDate] = useState(props.businessDate);
  const [note, setNote] = useState(props.note ?? "");
  const [category, setCategory] = useState(props.categoryId ?? props.categories[0]?.id ?? NEW_CATEGORY);
  const [newCategory, setNewCategory] = useState("");
  const [confirmVoid, setConfirmVoid] = useState(false);
  const correct = useMutation<Record<string, unknown>, { mode: string; entryIds: string[] }>(`/api/v1/ledger-entries/${props.entryId}/corrections`);
  const special = props.eventClass === "SPECIAL_EXPENSE";

  function body(answer?: string) {
    // The original was recorded after cutover; keeping its date keeps that answer.
    const cutoverDayAnswer = answer ?? (date === props.businessDate ? "NOT_IN_OPENING" : undefined);
    return {
      action: "REPLACE",
      amount,
      businessDate: date,
      note: note.trim() || undefined,
      ...(special ? (category === NEW_CATEGORY ? { newCategoryName: newCategory } : { categoryId: category }) : {}),
      ...(cutoverDayAnswer ? { cutoverDayAnswer } : {}),
    };
  }

  async function submit(cutoverDayAnswer?: string) {
    if (!amount) {
      correct.setError(["Isi nominal yang benar."]);
      return;
    }
    const result = await correct.submit(body(cutoverDayAnswer));
    if (result.ok) {
      const replacement = result.data.entryIds.at(-1);
      router.push(replacement ? `/aktivitas/${replacement}` : "/aktivitas");
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          await submit();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <AmountInput label="Nominal yang benar" value={amount} onChange={setAmount} />
          <DateField label="Tanggal yang benar" value={date} max={today} onChange={setDate} />
        </div>
        {special ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Kategori"
              value={category}
              onChange={setCategory}
              options={[...props.categories.map((c) => ({ value: c.id, label: c.name })), { value: NEW_CATEGORY, label: "Lainnya…" }]}
            />
            {category === NEW_CATEGORY ? <TextField label="Nama kategori baru" value={newCategory} maxLength={60} onChange={setNewCategory} /> : null}
          </div>
        ) : null}
        <TextArea label="Catatan (opsional)" value={note} onChange={setNote} />
        {correct.needsCutoverAnswer ? <CutoverDayQuestion pending={correct.pending} onAnswer={(answer) => submit(answer)} /> : null}
        <FormErrors errors={correct.error} />
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={buttonClass.primary} disabled={correct.pending}>
            {correct.pending ? "Menyimpan…" : "Simpan koreksi"}
          </button>
        </div>
      </form>

      {props.allowVoid ? (
        <div className="border-t border-border pt-4">
          {confirmVoid ? (
            <div className="space-y-2 rounded-lg bg-review-bg p-3 text-review-fg">
              <p className="text-sm">Catatan ini akan dibatalkan dengan catatan pembalik. Riwayat tetap terlihat di Aktivitas.</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={buttonClass.danger}
                  disabled={correct.pending}
                  onClick={async () => {
                    const result = await correct.submit({ action: "VOID" });
                    if (result.ok) router.refresh();
                  }}
                >
                  Ya, batalkan catatan
                </button>
                <button type="button" className={buttonClass.secondary} onClick={() => setConfirmVoid(false)}>
                  Tidak jadi
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className={buttonClass.link} onClick={() => setConfirmVoid(true)}>
              Kejadian ini tidak pernah terjadi
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
