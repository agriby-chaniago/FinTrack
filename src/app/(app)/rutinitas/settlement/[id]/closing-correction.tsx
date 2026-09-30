"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AmountInput } from "@/components/amount-input";
import { FormErrors } from "@/components/form";
import { buttonClass } from "@/components/ui";
import { useMutation } from "@/lib/api-client";

export function ClosingCorrectionForm({ settlementId }: { settlementId: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState<string | null>(null);
  const save = useMutation<{ closingPhysicalBalance: string }>(`/api/v1/settlements/${settlementId}/closing-corrections`);
  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!amount) {
          save.setError(["Isi saldo penutupan yang benar."]);
          return;
        }
        const result = await save.submit({ closingPhysicalBalance: amount });
        if (result.ok) {
          setAmount(null);
          router.refresh();
        }
      }}
    >
      <AmountInput label="Saldo penutupan yang benar" value={amount} onChange={setAmount} />
      <FormErrors errors={save.error} />
      <button type="submit" className={buttonClass.primary} disabled={save.pending}>
        {save.pending ? "Menyimpan…" : "Simpan koreksi saldo"}
      </button>
    </form>
  );
}
