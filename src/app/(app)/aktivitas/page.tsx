import Link from "next/link";
import { redirect } from "next/navigation";

import { EmptyState, Icon, LinkButton, Money, PageHeader, Tag } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { listActivity } from "@/server/application/activity";
import { runAsPageOwner } from "@/server/auth/page-owner";

import { entryAmount, entryTitle, statusTag } from "./describe";
import { AktivitasTabs } from "./tabs";

export default async function AktivitasPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const { before: cursor } = await searchParams;
  let before: { recordedAt: string; id: string } | undefined;
  if (cursor) {
    const [recordedAt, id] = cursor.split("|");
    if (recordedAt && id && !Number.isNaN(Date.parse(recordedAt)) && /^[0-9a-f-]{36}$/i.test(id)) before = { recordedAt, id };
  }
  const result = await runAsPageOwner((tx, { ownerId }) => listActivity(tx, ownerId, { limit: 50, before }));
  if (result.status !== "OWNER") redirect("/login");
  const { items, nextCursor } = result.value;

  return (
    <div>
      <PageHeader title="Aktivitas" description="Semua catatan, urut dari yang terakhir dicatat. Catatan tidak pernah dihapus; koreksi tampil sebagai catatan baru." />
      <AktivitasTabs active="riwayat" />
      {items.length === 0 ? (
        <EmptyState title="Belum ada aktivitas" />
      ) : (
        <ul className="divide-y divide-border border border-border bg-surface">
          {items.map((item) =>
            item.type === "OPENING_SNAPSHOT" ? (
              <li key={item.id} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
                <span>
                  <span className="block font-medium">{item.supersedesId ? "Koreksi saldo awal" : "Saldo awal FinTrack"}</span>
                  <span className="block text-sm text-muted">Mulai {formatDateTime(item.cutoverAt)}</span>
                </span>
                {item.superseded ? <Tag tone="neutral">Digantikan</Tag> : <Tag tone="success">Berlaku</Tag>}
              </li>
            ) : (
              <li key={item.id}>
                <Link href={`/aktivitas/${item.id}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 hover:bg-surface-subtle">
                  <span className="min-w-0">
                    <span className={`block truncate font-medium ${item.status !== "ACTIVE" ? "text-muted line-through" : ""}`}>{entryTitle(item)}</span>
                    <span className="block text-sm text-muted">
                      {formatDate(item.businessDate)}
                      {item.legs.length === 1 ? ` · ${item.legs[0].accountName}` : ""}
                      {item.note ? ` · ${item.note}` : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {statusTag[item.status] ? <Tag tone="neutral">{statusTag[item.status]}</Tag> : null}
                    <Money value={entryAmount(item).value} signed={entryAmount(item).signed} className="font-medium" />
                    <Icon name="chevron" className="size-4 text-muted" />
                  </span>
                </Link>
              </li>
            ),
          )}
        </ul>
      )}
      {nextCursor ? (
        <div className="mt-4">
          <LinkButton href={`/aktivitas?before=${encodeURIComponent(nextCursor)}`}>Muat lebih lama</LinkButton>
        </div>
      ) : null}
    </div>
  );
}
