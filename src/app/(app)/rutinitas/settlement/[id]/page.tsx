import { notFound, redirect } from "next/navigation";

import { Alert, Card, LinkButton, Money, PageHeader, Row, SectionTitle } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { progressLabel } from "@/lib/labels";
import { ApiError } from "@/server/api/errors";
import { isUuid } from "@/server/api/responses";
import { settlementView } from "@/server/application/settlement";
import { listTargets } from "@/server/application/transfers";
import { runAsPageOwner } from "@/server/auth/page-owner";

import { ComparisonTable, ReconstructionList, settlementWarning } from "../reconstruction";
import { ClosingCorrectionForm } from "./closing-correction";

type Day = { date: string; state: string; amount: string; overridden: boolean };

export default async function SettlementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const result = await runAsPageOwner(async (tx, { ownerId }) => {
    try {
      const view = await settlementView(tx, ownerId, id);
      const target = (await listTargets(tx, ownerId)).find((t) => t.contextType === "DANA_SETTLEMENT" && t.contextKey === id) ?? null;
      return { view, target };
    } catch (error) {
      if (error instanceof ApiError && error.code === "NOT_FOUND") return null;
      throw error;
    }
  });
  if (result.status !== "OWNER") redirect("/login");
  if (!result.value) notFound();
  const { view, target } = result.value;
  if (view.status === "DRAFT") redirect("/rutinitas/settlement");
  const asSettled = view.asSettled ?? {};
  const days = (asSettled.days as Day[] | undefined) ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Settlement ${formatDate(view.startDate)} – ${formatDate(view.endDate)}`}
        description={`Saldo penutupan ${formatDateTime(typeof asSettled.closingAt === "string" ? asSettled.closingAt : view.closingAt)}${view.nonstandard ? " · periode catch-up" : ""}`}
        action={<LinkButton href="/rutinitas">Kembali</LinkButton>}
      />

      {typeof asSettled.cashActivated === "string" ? (
        <Alert tone="info" title="Tunai mulai dilacak">
          Settlement ini memulai pelacakan uang tunai dengan <Money value={asSettled.cashActivated} /> di dompet. Tunai dihitung bersama DANA mulai periode berikutnya.
        </Alert>
      ) : null}

      {view.warnings.map((code) => (
        <Alert key={code} tone="review" title={settlementWarning[code]?.title ?? code}>
          {settlementWarning[code]?.body}
        </Alert>
      ))}

      {view.hasCorrections && view.corrected ? (
        <Card>
          <SectionTitle>Nilai saat settlement dan setelah koreksi</SectionTitle>
          <p className="mb-3 text-sm text-muted">Snapshot saat settlement tidak berubah. Laporan memakai nilai setelah koreksi.</p>
          <ComparisonTable asSettled={asSettled} corrected={view.corrected} />
        </Card>
      ) : (
        <Card>
          <SectionTitle>Hasil settlement</SectionTitle>
          <ReconstructionList values={view.corrected ?? asSettled} />
        </Card>
      )}

      {target?.version ? (
        <Card>
          <SectionTitle>Transfer ke reserve</SectionTitle>
          <dl>
            <Row label="Uang pribadi saat penutupan">
              <Money value={typeof asSettled.closingPersonal === "string" ? asSettled.closingPersonal : null} />
            </Row>
            {asSettled.priorOutstanding && asSettled.priorOutstanding !== "0" ? (
              <Row label="Dikurangi sisa target sebelumnya">
                <Money value={asSettled.priorOutstanding as string} />
              </Row>
            ) : null}
            <Row label="Saran transfer" emphasis>
              <Money value={target.version.amount} />
            </Row>
            <Row label="Sudah ditransfer">
              <Money value={target.linked} />
            </Row>
            <Row label="Status">{progressLabel[target.progress]}</Row>
          </dl>
        </Card>
      ) : null}

      {days.length > 0 ? (
        <Card>
          <details>
            <summary className="flex min-h-11 cursor-pointer items-center font-medium">Income harian per tanggal</summary>
            <dl>
              {days.map((day) => (
                <Row key={day.date} label={formatDate(day.date)}>
                  {day.state === "ACTIVE" ? <Money value={day.amount} /> : "Dijeda"}
                  {day.overridden ? " · pengecualian" : ""}
                </Row>
              ))}
            </dl>
          </details>
        </Card>
      ) : null}

      <Card>
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center font-medium">Saldo penutupan salah?</summary>
          <p className="mb-3 text-sm text-muted">
            Saldo DANA tercatat <Money value={view.closingPhysicalBalance} />
            {view.cash.tracked ? (
              <>
                , tunai di dompet <Money value={view.cash.closingPhysicalBalance} />
              </>
            ) : null}
            . Koreksi menambah catatan pengganti; nilai saat settlement tetap tersimpan.
          </p>
          <ClosingCorrectionForm settlementId={view.id} cashTracked={view.cash.tracked} />
        </details>
      </Card>
    </div>
  );
}
