"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AmountInput } from "@/components/amount-input";
import { FormErrors } from "@/components/form";
import { Alert, buttonClass, Money, Row } from "@/components/ui";
import { useMutation } from "@/lib/api-client";
import { parseIdrDecimal, toIdrDecimal } from "@/lib/money";
import type { AccountSplitView, SplitAccountInput } from "@/server/application/account-split";

export function AccountSplitForm({ view }: { view: AccountSplitView }) {
  const router = useRouter();
  const [primary, setPrimary] = useState<string | null>(null);
  const [external, setExternal] = useState<Record<string, string | null>>({});
  const [review, setReview] = useState(false);
  const save = useMutation<SplitAccountInput>("/api/v1/accounts/split");
  const amount = parseIdrDecimal(primary ?? "0");
  const total = parseIdrDecimal(view.total);
  const held = parseIdrDecimal(view.external);
  const movedExternal = Object.values(external).reduce((sum, value) => sum + parseIdrDecimal(value ?? "0"), 0n);
  const savings = total - amount;
  const inconsistent = total < 0n || held < 0n || held > total;

  function validate() {
    if (primary === null) return "Isi saldo yang saat ini berada di Jago Utama, termasuk dana titipan jika ada.";
    if (amount > total || amount < 0n) return "Saldo Utama harus antara Rp0 dan total saldo gabungan.";
    if (movedExternal > amount || held - movedExternal > savings) return "Periksa pembagian dana titipan: nilainya tidak boleh melebihi saldo Utama maupun Tabungan.";
    if (view.positions.some((p) => parseIdrDecimal(external[p.subjectId] ?? "0") > parseIdrDecimal(p.amount))) return "Porsi dana titipan di Utama melebihi posisi yang tercatat.";
    return null;
  }

  return (
    <form className="space-y-5" onSubmit={async (event) => {
      event.preventDefault();
      if (event.currentTarget.querySelector('[aria-invalid="true"]')) { save.setError(["Periksa format nominal sebelum melanjutkan."]); return; }
      const error = validate();
      if (error) { save.setError([error]); return; }
      if (!review) { save.setError(null); setReview(true); return; }
      const result = await save.submit({
        primaryBalance: primary!, version: view.version,
        externalComponents: view.positions.flatMap((position) => {
          const value = external[position.subjectId];
          return value && parseIdrDecimal(value) > 0n ? [{ subjectId: position.subjectId, amount: value }] : [];
        }),
      });
      if (result.ok) router.push("/akun");
    }}>
      <div>
        <p className="text-sm text-muted">Saldo gabungan yang sudah tercatat</p>
        <p className="mt-1 text-2xl font-semibold"><Money value={view.total} /></p>
        <p className="mt-1 text-sm text-muted">Termasuk dana titipan <Money value={view.external} />. Cocokkan total ini dengan saldo Utama + Tabungan di aplikasi bank.</p>
      </div>
      {inconsistent ? <Alert tone="review">Saldo gabungan belum konsisten dengan dana titipan. Periksa dan rekonsiliasi saldo melalui halaman Akun terlebih dahulu.</Alert> : null}
      {!review ? (
        <fieldset disabled={save.pending || inconsistent} className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <AmountInput label={`Saldo ${view.providerName} Utama sekarang`} value={primary} onChange={setPrimary} hint="Porsi saldo gabungan di rekening Utama. Sisanya otomatis menjadi Tabungan." />
            <div className="border border-border bg-surface-subtle p-4">
              <p className="text-sm text-muted">Sisa untuk Tabungan</p>
              <p className="mt-1 text-xl font-semibold" aria-live="polite"><Money value={toIdrDecimal(savings)} /></p>
            </div>
          </div>
          {view.positions.length > 0 ? (
            <div className="space-y-3">
              <p className="font-medium">Dana titipan yang berada di Utama</p>
              <p className="text-sm text-muted">Isi Rp0 jika seluruh dana pemilik tersebut berada di Tabungan.</p>
              <div className="grid gap-4 lg:grid-cols-2">
                {view.positions.map((position) => <AmountInput key={position.subjectId} label={`${position.name} di Utama`} value={external[position.subjectId] ?? "0"} onChange={(value) => setExternal((current) => ({ ...current, [position.subjectId]: value }))} />)}
              </div>
            </div>
          ) : null}
        </fieldset>
      ) : (
        <section aria-label="Pratinjau pemisahan" className="space-y-3">
          <h2 className="font-semibold">Periksa pembagian saldo</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {[{ name: "Utama", physical: amount, external: movedExternal }, { name: "Tabungan", physical: savings, external: held - movedExternal }].map((item) => (
              <div key={item.name} className="border border-border p-4">
                <h3 className="mb-2 font-medium">{view.providerName} — {item.name}</h3>
                <dl>
                  <Row label="Saldo fisik"><Money value={toIdrDecimal(item.physical)} /></Row>
                  <Row label="Dana titipan"><Money value={toIdrDecimal(item.external)} /></Row>
                  <Row label="Uang pribadi"><Money value={toIdrDecimal(item.physical - item.external)} /></Row>
                </dl>
              </div>
            ))}
          </div>
          <p className="text-sm font-medium">Total tetap <Money value={view.total} />.</p>
          <Alert tone="info">Porsi Utama dicatat sebagai transfer internal dari saldo gabungan. Ini bukan perintah transfer uang di bank. Riwayat lama tetap gabungan; pertumbuhan reserve bulan ini berkurang sebesar uang pribadi yang dipisahkan ke Utama.</Alert>
        </section>
      )}
      <p className="text-sm text-muted">Setelah dipisahkan, saran transfer BCA/DANA tetap menuju Tabungan. Sumber awal pengeluaran khusus beralih ke Utama dan bisa dipilih saat mencatat.</p>
      <FormErrors errors={save.error} />
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={buttonClass.primary} disabled={save.pending || inconsistent}>{save.pending ? "Memisahkan…" : review ? "Konfirmasi pemisahan" : "Periksa pembagian"}</button>
        {review ? <button type="button" className={buttonClass.secondary} disabled={save.pending} onClick={() => setReview(false)}>Ubah pembagian</button> : null}
        <button type="button" className={buttonClass.link} disabled={save.pending} onClick={() => router.refresh()}>Muat ulang saldo</button>
      </div>
    </form>
  );
}
