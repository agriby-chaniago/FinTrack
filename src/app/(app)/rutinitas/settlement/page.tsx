import { redirect } from "next/navigation";

import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { formatDate, jakartaInputValue } from "@/lib/format";
import { settlementRouter, settlementView } from "@/server/application/settlement";
import { runAsPageOwner } from "@/server/auth/page-owner";

import { SettlementDraft, StartSettlement } from "./settlement-flow";

export default async function SettlementPage() {
  const now = new Date();
  const result = await runAsPageOwner(async (tx, { ownerId }) => {
    const router = await settlementRouter(tx, ownerId, now);
    const draft = router.mode === "DRAFT" && router.draftId ? await settlementView(tx, ownerId, router.draftId) : null;
    return { router, draft };
  });
  if (result.status !== "OWNER") redirect("/login");
  const { router, draft } = result.value;
  const nowInput = jakartaInputValue(now.toISOString());

  if (router.mode === "NO_WEEKLY_ACCOUNT") {
    return (
      <>
        <PageHeader title="Settlement DANA" />
        <EmptyState title="Tidak ada akun mingguan" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Settlement DANA"
        description="Masukkan saldo DANA sesuai aplikasi sebelum sisa uang ditransfer ke reserve. FinTrack menghitung biaya hidup dari saldo itu."
      />
      {draft ? (
        <SettlementDraft draft={draft} nowInput={nowInput} />
      ) : router.mode === "NORMAL" || router.mode === "OVERDUE" ? (
        <StartSettlement mode={router.mode} periodStart={router.periodStart} normalEnd={router.normalEnd} today={router.today} nowInput={nowInput} />
      ) : (
        <div className="space-y-4">
          <EmptyState title="Belum waktunya settlement">
            Periode berjalan {formatDate(router.periodStart)} – {formatDate(router.normalEnd)}. Settlement tersedia mulai {formatDate(router.normalEnd)}.
          </EmptyState>
          <LinkButton href="/rutinitas">Kembali ke Rutinitas</LinkButton>
        </div>
      )}
    </>
  );
}
