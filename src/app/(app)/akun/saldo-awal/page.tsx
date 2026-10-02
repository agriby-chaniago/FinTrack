import { redirect } from "next/navigation";

import { Card, LinkButton, Money, PageHeader, Row, SectionTitle } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { openingSnapshotView } from "@/server/application/recording-context";
import { runAsPageOwner } from "@/server/auth/page-owner";

import { OpeningCorrectionForm } from "./opening-correction-form";

export default async function SaldoAwalPage() {
  const result = await runAsPageOwner((tx, { ownerId }) => openingSnapshotView(tx, ownerId));
  if (result.status !== "OWNER") redirect("/login");
  const snapshot = result.value;
  const names = new Map(snapshot.accounts.map((a) => [a.accountId, a.name]));

  return (
    <div className="stagger space-y-5">
      <PageHeader
        title="Saldo awal"
        description={`Posisi saat mulai FinTrack, ${formatDateTime(snapshot.cutoverAt)}. Koreksi membuat snapshot pengganti; snapshot lama tetap tersimpan.`}
        action={<LinkButton href="/akun">Kembali</LinkButton>}
      />
      <Card>
        <SectionTitle>Saldo awal yang berlaku</SectionTitle>
        <dl>
          {snapshot.accounts.map((a) => (
            <Row key={a.accountId} label={a.name}>
              <Money value={a.physicalBalance} />
            </Row>
          ))}
          {snapshot.externals.map((x, index) => (
            <Row key={index} label={`Titipan ${x.subjectName} di ${names.get(x.accountId) ?? "akun"}`}>
              <Money value={x.amount} />
            </Row>
          ))}
        </dl>
        <p className="mt-2 text-xs text-muted">
          Dikonfirmasi {formatDateTime(snapshot.confirmedAt)}
          {snapshot.supersedesId ? " · hasil koreksi" : ""}
        </p>
      </Card>
      <Card>
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center font-medium">Koreksi saldo awal</summary>
          <OpeningCorrectionForm snapshot={snapshot} />
        </details>
      </Card>
    </div>
  );
}
