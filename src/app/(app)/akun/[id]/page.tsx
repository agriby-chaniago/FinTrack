import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AccountTile } from "@/components/account-tile";
import { Alert, Card, LinkButton, Money, PageHeader, Row, SectionTitle, StatusBadge, Tag } from "@/components/ui";
import { formatDateTime, jakartaInputValue } from "@/lib/format";
import { isUuid } from "@/server/api/responses";
import { accountsOverview } from "@/server/application/accounts-overview";
import { reconciliationView } from "@/server/application/reconciliation";
import { recordingContext } from "@/server/application/recording-context";
import { runAsPageOwner } from "@/server/auth/page-owner";

import { BalanceConfirmationForm, DiscrepancyResolver, OtherEventForm } from "../balance-forms";

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const now = new Date();
  const result = await runAsPageOwner(async (tx, { ownerId }) => {
    const overview = await accountsOverview(tx, ownerId, now);
    const reconciliation = await reconciliationView(tx, ownerId, id);
    const context = await recordingContext(tx, ownerId);
    return { overview, reconciliation, context };
  });
  if (result.status !== "OWNER") redirect("/login");
  const { overview, reconciliation, context } = result.value;
  const account = overview.accounts.find((a) => a.id === id);
  if (!account) notFound();
  const weekly = context.accounts.find((a) => a.id === id)?.weekly ?? false;
  const held = context.subjects.flatMap((s) => s.positions.filter((p) => p.accountId === id).map((p) => ({ subjectId: s.id, name: s.name, amount: p.amount })));
  const nowInput = jakartaInputValue(now.toISOString());

  return (
    <div className="stagger space-y-5">
      <PageHeader
        leading={<AccountTile account={account} index={overview.accounts.indexOf(account)} />}
        title={account.displayName}
        description={`${account.providerName} · ${account.purposeLabel}`}
        action={<LinkButton href="/akun">Kembali</LinkButton>}
      />

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm text-muted">Uang pribadi tercatat</p>
            <p className="text-2xl font-semibold">
              <Money value={account.personal} />
            </p>
          </div>
          <StatusBadge status={account.status} />
        </div>
        <dl className="mt-3">
          <Row label="Saldo fisik tercatat">
            <Money value={account.physical} />
          </Row>
          <Row label="Dana titipan">
            <Money value={account.external} />
          </Row>
          <Row label="Uang pribadi terkonfirmasi">
            <Money value={account.confirmedPersonal} />
          </Row>
          <Row label="Terakhir dikonfirmasi">{formatDateTime(account.lastConfirmedAt)}</Row>
        </dl>
        {account.openWeekDisclosure ? <p className="mt-2 text-sm text-calculated-fg">Biaya hidup minggu berjalan belum direkonstruksi; saldo aktual DANA diketahui saat settlement.</p> : null}
        {account.shortfall !== "0" ? (
          <div className="mt-3">
            <Alert tone="danger" title="Kekurangan dana titipan">
              Saldo fisik lebih kecil dari dana titipan sebesar <Money value={account.shortfall} />.
            </Alert>
          </div>
        ) : null}
      </Card>

      {held.length > 0 ? (
        <Card>
          <SectionTitle>Dana titipan di akun ini</SectionTitle>
          <dl>
            {held.map((row) => (
              <Row key={row.subjectId} label={<Link href={`/akun/dana-titipan/${row.subjectId}`} className="text-primary">{row.name}</Link>}>
                <Money value={row.amount} />
              </Row>
            ))}
          </dl>
        </Card>
      ) : null}

      <section id="rekonsiliasi" className="scroll-mt-20">
        <Card>
          <SectionTitle>Rekonsiliasi</SectionTitle>
          {weekly ? (
            <div className="space-y-3">
              <p className="text-sm text-muted">Saldo akun mingguan dikonfirmasi melalui settlement mingguan.</p>
              <LinkButton href="/rutinitas/settlement" variant="primary">
                Buka settlement
              </LinkButton>
            </div>
          ) : (
            <div className="space-y-5">
              {account.prompt ? (
                <Alert tone="review" title="Waktunya memeriksa saldo">
                  {account.prompt.reason === "BCA_CYCLE_COMPLETE" ? "Siklus bulanan sudah selesai." : "Akhir bulan."} Konfirmasi saldo sesuai aplikasi.
                </Alert>
              ) : null}
              {reconciliation ? (
                <div>
                  <dl>
                    <Row label={`Saldo dikonfirmasi · ${formatDateTime(reconciliation.asOf)}`}>
                      <Money value={reconciliation.confirmedPhysical} />
                    </Row>
                    <Row label="Saldo tercatat pada waktu yang sama">
                      <Money value={reconciliation.calculatedPhysical} />
                    </Row>
                    <Row label="Selisih" emphasis>
                      <Money value={reconciliation.discrepancy} signed />
                    </Row>
                  </dl>
                  {reconciliation.status === "MATCHED" ? (
                    <Tag tone="success">Cocok</Tag>
                  ) : reconciliation.status === "NEEDS_REVIEW" ? (
                    <Alert tone="review" title="Perlu diperiksa">
                      Ada penyesuaian yang dibuat untuk konfirmasi saldo yang kemudian diganti. Periksa di Aktivitas.
                    </Alert>
                  ) : null}
                  {reconciliation.adjustments.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-sm">
                      {reconciliation.adjustments.map((adj) => (
                        <li key={adj.entryId}>
                          <Link href={`/aktivitas/${adj.entryId}`} className="text-primary">
                            Penyesuaian <Money value={adj.amount} signed />
                          </Link>
                          {adj.fromSupersededConfirmation ? " · konfirmasinya sudah diganti" : ""}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {reconciliation && reconciliation.status === "DISCREPANCY" ? (
                <div className="border border-border p-4">
                  <p className="mb-3 font-medium">Selesaikan selisih</p>
                  <DiscrepancyResolver view={reconciliation} accountId={id} weekly={weekly} cutoverDate={context.cutoverDate} />
                </div>
              ) : null}
              <details open={!reconciliation || Boolean(account.prompt)}>
                <summary className="flex min-h-11 cursor-pointer items-center font-medium">Konfirmasi saldo baru</summary>
                <BalanceConfirmationForm accountId={id} nowInput={nowInput} />
              </details>
            </div>
          )}
        </Card>
      </section>

      <Card>
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center font-medium">{weekly ? "Catat income lain" : "Catat income atau pengeluaran lain"}</summary>
          <p className="mb-3 text-sm text-muted">Untuk kejadian di luar income bulanan, kewajiban, pengeluaran khusus, dan transfer.</p>
          <OtherEventForm accountId={id} weekly={weekly} cutoverDate={context.cutoverDate} />
        </details>
      </Card>
    </div>
  );
}
