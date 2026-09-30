"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AmountInput } from "@/components/amount-input";
import { FormErrors } from "@/components/form";
import { buttonClass } from "@/components/ui";
import { useMutation } from "@/lib/api-client";

export function ClosingCorrectionForm({ settlementId, cashTracked }: { settlementId: string; cashTracked: boolean }) {
  const router = useRouter();
  const [amount, setAmount] = useState<string | null>(null);
  const [cash, setCash] = useState<string | null>(null);
  const save = useMutation<{ closingPhysicalBalance?: string; closingCashBalance?: string }>(`/api/v1/settlements/${settlementId}/closing-corrections`);
  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!amount && !cash) {
          save.setError(["Isi saldo yang benar."]);
          return;
        }
        const result = await save.submit({ ...(amount ? { closingPhysicalBalance: amount } : {}), ...(cash ? { closingCashBalance: cash } : {}) });
        if (result.ok) router.refresh();
      }}
    >
      <AmountInput label="Saldo DANA yang benar" hint="Kosongkan jika tidak berubah." value={amount} onChange={setAmount} />
      {cashTracked ? <AmountInput label="Uang tunai di dompet yang benar" hint="Kosongkan jika tidak berubah." value={cash} onChange={setCash} /> : null}
      <FormErrors errors={save.error} />
      <button type="submit" className={buttonClass.primary} disabled={save.pending}>
        {save.pending ? "Menyimpan…" : "Simpan koreksi saldo"}
      </button>
    </form>
  );
}
