"use client";

import { useEffect, useRef, useState } from "react";

import { analysisFromArchive } from "@/lib/export-download";
import { errorMessage } from "@/lib/labels";

type Ready = { csvUrl: string; zipUrl: string; name: string; failedChecks: number };
const downloadClass = "inline-flex min-h-11 items-center border border-control px-4 font-medium hover:bg-surface-subtle";

export function ExportDownloads() {
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState<Ready | null>(null);
  const [error, setError] = useState<string | null>(null);
  const urls = useRef<string[]>([]);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => {
    controller.current?.abort();
    urls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  async function prepare() {
    setPending(true);
    setError(null);
    setReady(null);
    urls.current.forEach((url) => URL.revokeObjectURL(url));
    urls.current = [];
    const attempt = new AbortController();
    controller.current = attempt;
    try {
      const response = await fetch("/api/v1/export", { cache: "no-store", credentials: "same-origin", signal: attempt.signal });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error?.code ?? "INTERNAL_ERROR");
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const analysis = await analysisFromArchive(bytes);
      if (attempt.signal.aborted) return;
      const zipUrl = URL.createObjectURL(new Blob([bytes.buffer], { type: "application/zip" }));
      const csvUrl = URL.createObjectURL(new Blob([analysis.csv.buffer], { type: "text/csv;charset=utf-8" }));
      urls.current = [zipUrl, csvUrl];
      setReady({ zipUrl, csvUrl, name: `fintrack-${analysis.exportId.slice(0, 12)}`, failedChecks: analysis.failedChecks });
    } catch (cause) {
      if (attempt.signal.aborted) return;
      const code = cause instanceof Error ? cause.message : "INTERNAL_ERROR";
      setError(code === "EXPORT_PAIR_INVALID" ? "Pasangan CSV dan ZIP tidak cocok. Siapkan ekspor kembali." : errorMessage[code] ?? "Ekspor belum berhasil. Coba lagi.");
    } finally {
      if (!attempt.signal.aborted) setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Unduh CSV analisis dan ZIP lengkap, lalu kirim keduanya bersama ke AI. Keduanya memuat data dari waktu ekspor yang sama.</p>
      <button type="button" onClick={prepare} disabled={pending} className={`${downloadClass} disabled:opacity-50`}>
        {pending ? "Menyiapkan ekspor…" : ready ? "Siapkan ekspor baru" : "Ekspor data"}
      </button>
      {pending ? <p role="status" className="text-sm text-muted">Menyiapkan CSV analisis dan arsip lengkap…</p> : null}
      {error ? <p role="alert" className="text-sm text-danger-fg">{error}</p> : null}
      {ready ? (
        <div className="space-y-3">
          <p role="status" className="text-sm">{ready.failedChecks > 0 ? `Ekspor siap. Ada ${ready.failedChecks} pemeriksaan yang tidak cocok; rincian dan batas kesimpulan tercantum di CSV.` : "Ekspor siap. Unduh kedua file berikut."}</p>
          <div className="flex flex-wrap gap-3">
            <a className={downloadClass} href={ready.csvUrl} download={`${ready.name}-analysis.csv`}>Unduh CSV analisis</a>
            <a className={downloadClass} href={ready.zipUrl} download={`${ready.name}.zip`}>Unduh ZIP lengkap</a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
