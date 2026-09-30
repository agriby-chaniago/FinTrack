// Shared reconstruction breakdown (PRD: settlement preview and history detail).
import { Money, Row } from "@/components/ui";
import { approx } from "@/lib/format";

type Values = Record<string, unknown>;
type Line = { key: string; label: string; sign?: "+" | "−"; emphasis?: boolean };

/** Formula lines in order; the wallet lines appear once Tunai is in the pool (PRD v0.19). */
function formulaRows(cashTracked: boolean): Line[] {
  const dana = cashTracked ? " DANA" : "";
  return [
    { key: "openingPersonal", label: `Uang pribadi${dana} awal periode` },
    ...(cashTracked ? [{ key: "cashOpeningPersonal", label: "Uang tunai awal periode", sign: "+" as const }] : []),
    { key: "recognizedIncome", label: "Income harian diakui", sign: "+" },
    { key: "otherInflows", label: "Income lain", sign: "+" },
    { key: "transfersIn", label: "Transfer masuk", sign: "+" },
    { key: "transfersOut", label: "Transfer keluar", sign: "−" },
    { key: "nonLivingDeductions", label: "Pengeluaran bukan biaya hidup", sign: "−" },
    { key: "closingPersonal", label: `Uang pribadi${dana} saat penutupan`, sign: "−" },
    ...(cashTracked ? [{ key: "cashClosingPersonal", label: "Uang tunai di dompet saat penutupan", sign: "−" as const }] : []),
    { key: "livingExpense", label: "Biaya hidup", emphasis: true },
  ];
}

const text = (value: unknown) => (typeof value === "string" ? value : typeof value === "number" ? String(value) : null);

/** One reconstruction as a definition list, with income days and closing composition. */
export function ReconstructionList({ values }: { values: Values }) {
  const cashTracked = values.cashTracked === true;
  return (
    <dl>
      {formulaRows(cashTracked).map((row) => (
        <Row key={row.key} label={row.sign ? `${row.sign} ${row.label}` : row.label} emphasis={row.emphasis}>
          <Money value={text(values[row.key])} />
        </Row>
      ))}
      <Row label="Rata-rata per hari">{approx(text(values.averagePerDay))}</Row>
      <Row label="Hari income diterima">
        {text(values.receivedDays)} dari {text(values.eligibleDays)} hari aktif
      </Row>
      <Row label="Saldo fisik DANA penutupan">
        <Money value={text(values.closingPhysical)} />
      </Row>
      {text(values.closingExternal) !== "0" ? (
        <Row label="Dana titipan di DANA">
          <Money value={text(values.closingExternal)} />
        </Row>
      ) : null}
      {cashTracked && text(values.cashClosingExternal) !== "0" ? (
        <Row label="Dana titipan di dompet">
          <Money value={text(values.cashClosingExternal)} />
        </Row>
      ) : null}
    </dl>
  );
}

/** As-settled and corrected values side by side; only rows that differ are highlighted. */
export function ComparisonTable({ asSettled, corrected }: { asSettled: Values; corrected: Values }) {
  const cashTracked = corrected.cashTracked === true;
  const compared: Line[] = [
    ...formulaRows(cashTracked),
    { key: "averagePerDay", label: "Rata-rata per hari" },
    { key: "closingPhysical", label: "Saldo fisik DANA penutupan" },
    ...(cashTracked ? [{ key: "cashClosingPhysical", label: "Uang tunai di dompet" }] : []),
  ];
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Perbandingan nilai saat settlement dan nilai setelah koreksi</caption>
      <thead className="text-left text-xs text-muted">
        <tr>
          <th scope="col" className="py-1 font-medium">Komponen</th>
          <th scope="col" className="py-1 text-right font-medium">Saat settlement</th>
          <th scope="col" className="py-1 text-right font-medium">Setelah koreksi</th>
        </tr>
      </thead>
      <tbody>
        {compared.map((row) => {
          const before = text(asSettled[row.key]);
          const after = text(corrected[row.key]);
          const changed = before !== after;
          return (
            <tr key={row.key} className={`border-t border-border ${changed ? "bg-review-bg text-review-fg" : ""}`}>
              <th scope="row" className="py-2 pr-2 text-left font-normal">
                {row.label}
                {changed ? <span className="sr-only"> (berubah)</span> : null}
              </th>
              <td className="py-2 text-right">
                <Money value={before} />
              </td>
              <td className="py-2 text-right font-medium">
                <Money value={after} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export const settlementWarning: Record<string, { title: string; body: string }> = {
  UNRECORDED_INCOME: {
    title: "Biaya hidup negatif",
    body: "Kemungkinan ada income atau transfer masuk yang belum dicatat. Periksa aktivitas minggu ini sebelum menyelesaikan settlement.",
  },
  EXTERNAL_FUND_SHORTFALL: {
    title: "Kekurangan dana titipan",
    body: "Saldo fisik lebih kecil dari dana titipan yang dipegang. Uang pribadi menjadi negatif.",
  },
};
