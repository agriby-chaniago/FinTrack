"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AmountInput } from "@/components/amount-input";
import { FormErrors, SelectField, SubmitBar, SubmitButton, TextField } from "@/components/form";
import { Alert, buttonClass } from "@/components/ui";
import { useMutation } from "@/lib/api-client";
import type { OpeningSnapshotView } from "@/server/application/recording-context";

type External = { accountId: string; subjectName: string; amount: string | null };

/** Superseding opening snapshot: same accounts, corrected balances and external positions. */
export function OpeningCorrectionForm({ snapshot }: { snapshot: OpeningSnapshotView }) {
  const router = useRouter();
  const [balances, setBalances] = useState<Record<string, string | null>>(Object.fromEntries(snapshot.accounts.map((a) => [a.accountId, a.physicalBalance])));
  const [externals, setExternals] = useState<External[]>(snapshot.externals);
  const [saved, setSaved] = useState(false);
  const save = useMutation<Record<string, unknown>>("/api/v1/onboarding/opening-corrections");

  return (
    <form
      className="space-y-5"
      onSubmit={async (event) => {
        event.preventDefault();
        const issues: string[] = [];
        if (snapshot.accounts.some((a) => balances[a.accountId] === null)) issues.push("Isi saldo setiap akun.");
        if (externals.some((x) => !x.subjectName.trim() || !x.amount)) issues.push("Lengkapi nama dan nominal setiap dana titipan.");
        if (issues.length) {
          save.setError(issues);
          return;
        }
        const result = await save.submit(
          {
            accounts: snapshot.accounts.map((a) => ({ accountId: a.accountId, physicalBalance: balances[a.accountId] })),
            externals: externals.map((x) => ({ accountId: x.accountId, subjectName: x.subjectName.trim(), amount: x.amount })),
          },
          { ifMatch: snapshot.snapshotId },
        );
        if (result.ok) {
          setSaved(true);
          router.refresh();
        }
      }}
    >
      <Alert tone="review">Semua saldo tercatat dihitung ulang dari saldo awal yang baru. Catatan setelah saldo awal tidak berubah.</Alert>
      <fieldset className="space-y-3">
        <legend className="mb-2 font-medium">Saldo fisik per akun</legend>
        {snapshot.accounts.map((a) => (
          <AmountInput key={a.accountId} label={a.name} value={balances[a.accountId]} onChange={(value) => setBalances({ ...balances, [a.accountId]: value })} />
        ))}
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="mb-2 font-medium">Dana titipan saat mulai</legend>
        {externals.map((x, index) => (
          <div key={index} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-3 sm:items-end">
            <TextField label="Pemilik" value={x.subjectName} maxLength={80} onChange={(value) => setExternals(externals.map((row, i) => (i === index ? { ...row, subjectName: value } : row)))} />
            <SelectField
              label="Di akun"
              value={x.accountId}
              onChange={(value) => setExternals(externals.map((row, i) => (i === index ? { ...row, accountId: value } : row)))}
              options={snapshot.accounts.map((a) => ({ value: a.accountId, label: a.name }))}
            />
            <AmountInput label="Nominal" value={x.amount} onChange={(value) => setExternals(externals.map((row, i) => (i === index ? { ...row, amount: value } : row)))} />
            <button type="button" className={`${buttonClass.link} sm:col-span-3`} onClick={() => setExternals(externals.filter((_, i) => i !== index))}>
              Hapus dana titipan ini
            </button>
          </div>
        ))}
        <button type="button" className={buttonClass.link} onClick={() => setExternals([...externals, { accountId: snapshot.accounts[0]?.accountId ?? "", subjectName: "", amount: null }])}>
          Tambah dana titipan
        </button>
      </fieldset>
      <FormErrors errors={save.error} />
      <div aria-live="polite">{saved ? <Alert tone="success" title="Saldo awal dikoreksi" /> : null}</div>
      <SubmitBar>
        <SubmitButton pending={save.pending}>Simpan koreksi saldo awal</SubmitButton>
      </SubmitBar>
    </form>
  );
}
