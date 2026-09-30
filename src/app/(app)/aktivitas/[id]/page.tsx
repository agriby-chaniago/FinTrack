import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Alert, Card, LinkButton, Money, PageHeader, Row, SectionTitle, Tag } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { isUuid } from "@/server/api/responses";
import { listActivity } from "@/server/application/activity";
import { listCategories } from "@/server/application/events";
import { runAsPageOwner } from "@/server/auth/page-owner";

import { correctableClasses, entryAmount, entryTitle, statusTag } from "../describe";
import { CorrectionForm } from "./correction-form";

export default async function ActivityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const result = await runAsPageOwner(async (tx, { ownerId }) => {
    const [activity, categories] = await Promise.all([listActivity(tx, ownerId, { limit: 20, thread: id }), listCategories(tx, ownerId, { includeArchived: false })]);
    return { thread: activity.items, categories };
  });
  if (result.status !== "OWNER") redirect("/login");
  const entries = result.value.thread.filter((item) => item.type === "LEDGER_ENTRY");
  const entry = entries.find((item) => item.id === id);
  if (!entry) notFound();
  const corrections = entries.filter((item) => item.correctsEntryId === id);
  const amount = entryAmount(entry);
  const correctable =
    entry.status === "ACTIVE" && entry.kind !== "CORRECTION_POSTING" && entry.correctionRole !== "REVERSAL" && correctableClasses.has(entry.eventClass);
  const occurrence = entry.eventClass === "MONTHLY_INCOME" || entry.eventClass === "RECURRING_EXPENSE";

  return (
    <div className="space-y-5">
      <PageHeader title={entryTitle(entry)} action={<LinkButton href="/aktivitas">Kembali</LinkButton>} />

      <Card>
        <p className="text-2xl font-semibold">
          <Money value={amount.value} signed={amount.signed} />
        </p>
        <dl className="mt-3">
          <Row label="Tanggal kejadian">{formatDate(entry.businessDate)}</Row>
          <Row label="Dicatat">{formatDateTime(entry.recordedAt)}</Row>
          {entry.category ? <Row label="Kategori">{entry.category.displayName}</Row> : null}
          {entry.subjectName ? <Row label="Pemilik dana titipan">{entry.subjectName}</Row> : null}
          {entry.note ? <Row label="Catatan">{entry.note}</Row> : null}
          <Row label="Status">{statusTag[entry.status] ? <Tag tone="neutral">{statusTag[entry.status]}</Tag> : "Berlaku"}</Row>
        </dl>
        {entry.correctsEntryId ? (
          <p className="mt-2 text-sm">
            <Link href={`/aktivitas/${entry.correctsEntryId}`} className="text-primary">
              Lihat catatan asli
            </Link>
          </p>
        ) : null}
      </Card>

      <Card>
        <SectionTitle>Dampak per akun</SectionTitle>
        <table className="w-full text-sm">
          <caption className="sr-only">Perubahan saldo fisik, dana titipan, dan uang pribadi per akun</caption>
          <thead className="text-left text-xs text-muted">
            <tr>
              <th scope="col" className="py-1 font-medium">Akun</th>
              <th scope="col" className="py-1 text-right font-medium">Fisik</th>
              <th scope="col" className="py-1 text-right font-medium">Titipan</th>
              <th scope="col" className="py-1 text-right font-medium">Pribadi</th>
            </tr>
          </thead>
          <tbody>
            {entry.legs.map((leg, index) => (
              <tr key={index} className="border-t border-border">
                <th scope="row" className="py-2 text-left font-normal">{leg.accountName}</th>
                <td className="py-2 text-right"><Money value={leg.physical} signed /></td>
                <td className="py-2 text-right"><Money value={leg.external} signed /></td>
                <td className="py-2 text-right"><Money value={leg.personal} signed /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {corrections.length > 0 ? (
        <Card>
          <SectionTitle>Riwayat koreksi</SectionTitle>
          <ul className="divide-y divide-border">
            {corrections.map((item) => (
              <li key={item.id}>
                <Link href={`/aktivitas/${item.id}`} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm hover:text-primary">
                  <span>
                    {entryTitle(item)} · {formatDateTime(item.recordedAt)}
                  </span>
                  <Money value={entryAmount(item).value} signed={entryAmount(item).signed} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {correctable ? (
        <Card>
          <SectionTitle>Koreksi</SectionTitle>
          <p className="mb-3 text-sm text-muted">
            Catatan asli tetap tersimpan. FinTrack menambah catatan pembalik dan pengganti, atau koreksi riwayat settlement jika tanggalnya sudah disettle.
          </p>
          <CorrectionForm
            entryId={entry.id}
            eventClass={entry.eventClass}
            amount={amount.value.replace(/^-/, "")}
            businessDate={entry.businessDate}
            note={entry.note}
            categoryId={entry.category?.id ?? null}
            categories={result.value.categories.map((c) => ({ id: c.id, name: c.displayName }))}
            allowVoid={!occurrence}
          />
          {occurrence ? (
            <div className="mt-3">
              <Alert tone="info">
                Jika kejadian ini sebenarnya tidak terjadi, tandai melalui{" "}
                <Link href="/rutinitas" className="underline">
                  Rutinitas
                </Link>
                .
              </Alert>
            </div>
          ) : null}
        </Card>
      ) : entry.eventClass === "LIVING" || entry.eventClass === "ADJUSTMENT" ? (
        <Alert tone="info">Catatan ini dibuat otomatis oleh settlement atau penyesuaian saldo dan dikoreksi melalui alurnya sendiri.</Alert>
      ) : null}
    </div>
  );
}
