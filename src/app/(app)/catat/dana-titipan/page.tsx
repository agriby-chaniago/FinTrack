import { redirect } from "next/navigation";

import { ExternalMovementForm } from "@/components/external-movement-form";
import { PageHeader } from "@/components/ui";
import { recordingContext } from "@/server/application/recording-context";
import { runAsPageOwner } from "@/server/auth/page-owner";

export default async function DanaTitipanCatatPage() {
  const result = await runAsPageOwner((tx, { ownerId }) => recordingContext(tx, ownerId));
  if (result.status !== "OWNER") redirect("/login");
  const hasOpen = result.value.subjects.some((s) => s.positions.length > 0);
  return (
    <>
      <PageHeader title="Dana titipan" description="Uang milik orang lain yang Anda pegang. Tidak dihitung sebagai uang pribadi." />
      <ExternalMovementForm
        context={result.value}
        types={hasOpen ? ["RECEIPT", "RETURN", "OWNER_USE", "CONVERT_TO_PERSONAL", "INTERNAL_TRANSFER", "CONVERT_TO_EXTERNAL"] : ["RECEIPT", "CONVERT_TO_EXTERNAL"]}
      />
    </>
  );
}
