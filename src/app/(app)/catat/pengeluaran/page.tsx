import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { recordingContext } from "@/server/application/recording-context";
import { runAsPageOwner } from "@/server/auth/page-owner";

import { SpecialExpenseForm } from "./special-expense-form";

export default async function PengeluaranPage() {
  const result = await runAsPageOwner((tx, { ownerId }) => recordingContext(tx, ownerId));
  if (result.status !== "OWNER") redirect("/login");
  return (
    <>
      <PageHeader title="Pengeluaran khusus" description="Vape dan pengeluaran tidak rutin lain. Tidak dihitung sebagai biaya hidup mingguan." />
      <SpecialExpenseForm context={result.value} />
    </>
  );
}
