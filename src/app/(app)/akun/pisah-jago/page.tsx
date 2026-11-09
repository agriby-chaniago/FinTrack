import { redirect } from "next/navigation";

import { Alert, Card, LinkButton, PageHeader } from "@/components/ui";
import { accountSplitView } from "@/server/application/account-split";
import { runAsPageOwner } from "@/server/auth/page-owner";

import { AccountSplitForm } from "./split-form";

export default async function SplitAccountPage() {
  const result = await runAsPageOwner((tx, { ownerId }) => accountSplitView(tx, ownerId));
  if (result.status !== "OWNER") redirect("/login");
  const view = result.value;
  return (
    <div className="stagger space-y-5">
      <PageHeader title={`Pisahkan ${view.providerName}`} description="Pisahkan pencatatan saldo gabungan menjadi Utama dan Tabungan." action={<LinkButton href="/akun">Kembali</LinkButton>} />
      {view.primaryId ? (
        <Card><Alert tone="success">Rekening sudah dipisahkan. Saldo Utama dan Tabungan tersedia di halaman Akun.</Alert></Card>
      ) : (
        <Card><AccountSplitForm key={view.version} view={view} /></Card>
      )}
    </div>
  );
}
