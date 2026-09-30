import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { jakartaInputValue } from "@/lib/format";
import { recordingContext } from "@/server/application/recording-context";
import { runAsPageOwner } from "@/server/auth/page-owner";

import { SaldoChooser } from "./saldo-chooser";

export default async function SaldoPage() {
  const now = new Date();
  const result = await runAsPageOwner((tx, { ownerId }) => recordingContext(tx, ownerId));
  if (result.status !== "OWNER") redirect("/login");
  return (
    <>
      <PageHeader title="Update saldo" description="Masukkan saldo sesuai aplikasi bank atau e-wallet. FinTrack membandingkannya dengan saldo tercatat." />
      <SaldoChooser accounts={result.value.accounts.map((a) => ({ id: a.id, name: a.name, weekly: a.weekly }))} nowInput={jakartaInputValue(now.toISOString())} />
    </>
  );
}
