import Link from "next/link";
import { redirect } from "next/navigation";

import { AccountTile } from "@/components/account-tile";
import { Card, cardLinkClass, LinkButton, Money, PageHeader, SectionTitle, StatusBadge, Tag } from "@/components/ui";
import { TabPage } from "@/components/tab-page";
import { formatDateTime } from "@/lib/format";
import { accountsOverview } from "@/server/application/accounts-overview";
import { listExternalSubjects } from "@/server/application/external-funds";
import { runAsPageOwner } from "@/server/auth/page-owner";

export default async function AkunPage() {
  const now = new Date();
  const result = await runAsPageOwner(async (tx, { ownerId }) => {
    const overview = await accountsOverview(tx, ownerId, now);
    const subjects = await listExternalSubjects(tx, ownerId);
    return { overview, subjects };
  });
  if (result.status !== "OWNER") redirect("/login");
  const { overview, subjects } = result.value;
  const open = subjects.filter((s) => s.status === "OPEN");
  const cleared = subjects.filter((s) => s.status === "CLEARED");

  return (
    <TabPage className="stagger space-y-8">
      <PageHeader
        title="Akun"
        description="Saldo tercatat per akun. Uang pribadi = saldo fisik dikurangi dana titipan."
        action={<LinkButton href="/catat/saldo">Update saldo</LinkButton>}
      />

      <section aria-label="Daftar akun">
        <ul className="cascade space-y-3">
          {overview.accounts.map((account, index) => (
            <li key={account.id}>
              <Link href={`/akun/${account.id}`} className={cardLinkClass}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <AccountTile account={account} index={index} />
                    <div>
                      <p className="font-medium">{account.displayName}</p>
                      <p className="text-xs text-muted">
                        {account.providerName} · {account.purposeLabel}
                      </p>
                    </div>
                  </div>
                  <StatusBadge status={account.status} />
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted">Uang pribadi</dt>
                    <dd className="font-semibold">
                      <Money value={account.personal} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Saldo fisik</dt>
                    <dd>
                      <Money value={account.physical} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Dana titipan</dt>
                    <dd>
                      <Money value={account.external} />
                    </dd>
                  </div>
                </dl>
                <p className="mt-2 text-xs text-muted">Terakhir dikonfirmasi {formatDateTime(account.lastConfirmedAt)}</p>
                {account.shortfall !== "0" ? (
                  <p className="mt-2">
                    <Tag tone="danger" icon="alert">
                      Kekurangan titipan <Money value={account.shortfall} />
                    </Tag>
                  </p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted">
          Total uang pribadi tercatat <Money value={overview.personalCashRecorded} />.
        </p>
      </section>

      <section aria-labelledby="external-title">
        <SectionTitle action={<LinkButton href="/catat/dana-titipan">Catat dana titipan</LinkButton>}>
          <span id="external-title">Dana titipan</span>
        </SectionTitle>
        {open.length === 0 ? (
          <p className="text-sm text-muted">Tidak ada dana titipan yang sedang dipegang.</p>
        ) : (
          <ul className="cascade divide-y divide-border border border-border bg-surface">
            {open.map((subject) => (
              <li key={subject.id}>
                <Link href={`/akun/dana-titipan/${subject.id}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 hover:bg-surface-subtle">
                  <span>
                    <span className="block font-medium">{subject.displayName}</span>
                    <span className="block text-sm text-muted">{subject.positions.map((p) => p.accountName).join(", ")}</span>
                  </span>
                  <Money value={subject.total} className="font-medium" />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {cleared.length > 0 ? (
          <details className="mt-3">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-primary">Sudah lunas ({cleared.length})</summary>
            <ul className="cascade divide-y divide-border border border-border bg-surface">
              {cleared.map((subject) => (
                <li key={subject.id}>
                  <Link href={`/akun/dana-titipan/${subject.id}`} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-surface-subtle">
                    {subject.displayName}
                    {subject.isArchived ? <Tag tone="neutral">Diarsipkan</Tag> : <Tag tone="success">Lunas</Tag>}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <Card>
        <SectionTitle>Saldo awal</SectionTitle>
        <p className="text-sm text-muted">Salah memasukkan saldo awal saat mulai FinTrack? Koreksi tanpa menghapus catatan lama.</p>
        <div className="mt-3">
          <LinkButton href="/akun/saldo-awal">Lihat dan koreksi saldo awal</LinkButton>
        </div>
      </Card>
    </TabPage>
  );
}
