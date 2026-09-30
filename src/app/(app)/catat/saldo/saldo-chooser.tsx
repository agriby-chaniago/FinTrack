"use client";

import { useState } from "react";

import { SelectField } from "@/components/form";
import { Alert, LinkButton } from "@/components/ui";

import { BalanceConfirmationForm } from "../../akun/balance-forms";

/** DANA goes to the settlement router; other accounts get a physical balance confirmation. */
export function SaldoChooser({ accounts, nowInput }: { accounts: { id: string; name: string; weekly: boolean }[]; nowInput: string }) {
  const [accountId, setAccountId] = useState(accounts.find((a) => !a.weekly)?.id ?? accounts[0]?.id ?? "");
  const selected = accounts.find((a) => a.id === accountId);
  return (
    <div className="max-w-xl space-y-4">
      <SelectField label="Akun" value={accountId} onChange={setAccountId} options={accounts.map((a) => ({ value: a.id, label: a.name }))} />
      {selected?.weekly ? (
        <div className="space-y-3">
          <Alert tone="info">Saldo {selected.name} diperbarui melalui settlement mingguan, karena biaya hidupnya dihitung dari saldo itu.</Alert>
          <LinkButton href="/rutinitas/settlement" variant="primary">
            Buka settlement
          </LinkButton>
        </div>
      ) : selected ? (
        <BalanceConfirmationForm key={selected.id} accountId={selected.id} nowInput={nowInput} />
      ) : null}
    </div>
  );
}
