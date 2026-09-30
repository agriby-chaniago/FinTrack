import { notFound, redirect } from "next/navigation";

import { ExternalMovementForm } from "@/components/external-movement-form";
import { Card, LinkButton, Money, PageHeader, Row, SectionTitle, Tag } from "@/components/ui";
import { isUuid } from "@/server/api/responses";
import { recordingContext } from "@/server/application/recording-context";
import { runAsPageOwner } from "@/server/auth/page-owner";

import { ArchiveSubjectButton } from "./archive-button";

export default async function SubjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const result = await runAsPageOwner((tx, { ownerId }) => recordingContext(tx, ownerId));
  if (result.status !== "OWNER") redirect("/login");
  const context = result.value;
  const subject = context.subjects.find((s) => s.id === id);
  if (!subject) notFound();
  const open = subject.positions.length > 0;

  return (
    <div className="space-y-5">
      <PageHeader title={subject.name} description="Dana titipan" action={<LinkButton href="/akun">Kembali</LinkButton>} />
      <Card>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm text-muted">Total dipegang</p>
            <p className="text-2xl font-semibold">
              <Money value={subject.total} />
            </p>
          </div>
          {subject.isArchived ? <Tag tone="neutral">Diarsipkan</Tag> : open ? <Tag tone="info">Masih dipegang</Tag> : <Tag tone="success">Lunas</Tag>}
        </div>
        {open ? (
          <dl className="mt-3">
            {subject.positions.map((p) => (
              <Row key={p.accountId} label={p.accountName}>
                <Money value={p.amount} />
              </Row>
            ))}
          </dl>
        ) : null}
      </Card>

      <Card>
        <SectionTitle>Catat perubahan</SectionTitle>
        <ExternalMovementForm
          context={context}
          subjectId={subject.id}
          types={open ? ["RETURN", "OWNER_USE", "CONVERT_TO_PERSONAL", "INTERNAL_TRANSFER", "RECEIPT"] : ["RECEIPT", "CONVERT_TO_EXTERNAL"]}
        />
      </Card>

      {!open && !subject.isArchived ? (
        <Card>
          <SectionTitle>Arsipkan</SectionTitle>
          <p className="mb-3 text-sm text-muted">Dana sudah lunas. Arsipkan agar tidak muncul di pilihan; riwayat tetap tersimpan.</p>
          <ArchiveSubjectButton subjectId={subject.id} />
        </Card>
      ) : null}
    </div>
  );
}
