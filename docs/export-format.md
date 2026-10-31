# Ekspor FinTrack v2

Keputusan produk: PRD v0.24, disepakati pemilik 30 Oktober 2026. Ini perubahan format ekspor, tanpa migration atau integrasi AI.

## Endpoint dan pasangan unduhan

`GET /api/v1/export` memakai autentikasi owner yang sama dengan API lain (cookie atau Bearer). Tidak ada parameter filter atau request body. Sukses: `200 application/zip`, `Content-Disposition: attachment`, `Cache-Control: no-store`, `X-Request-Id`. Error sebelum respons: kontrak JSON API biasa, termasuk 401/403/503; tidak redirect ke HTML.

Semua sumber dan proyeksi dibaca secara berurutan di satu transaksi `REPEATABLE READ, READ ONLY`, dengan RLS dan predicate owner. Proses tidak melakukan lazy occurrence creation, mutation, atau penyimpanan server/object storage. Missing due occurrences diproyeksikan sebagai `UNMATERIALIZED_PENDING` di memori.

Pengaturan → Data → Ekspor data mengambil ZIP sekali. Browser mengekstrak CSV analisis dari ZIP tersebut, memeriksa SHA-256 dan export identity, lalu menawarkan **Unduh CSV analisis** dan **Unduh ZIP lengkap**. Kedua nama unduhan memakai prefix identitas yang sama. Blob URL hanya berada di memori dan dicabut saat ekspor baru/navigasi; tidak ada financial local storage/cache. Browser tidak melakukan request kedua yang bisa menghasilkan snapshot berbeda.

## Isi ZIP

- `fintrack.json`: `formatVersion: 2`, `exportId`, `exportedAt`, dan seluruh dataset exact.
- `csv/<table>.csv`: seluruh tabel yang terdaftar pada coverage registry, termasuk versi lama/draft/audit. Dataset mentah v1 tetap utuh; identitas/proyeksi/panduan merupakan tambahan v2.
- `fintrack-analysis.csv`: proyeksi corrected resmi beserta instruksi dan penjelasan. CSV terpisah identik byte dengan file ini.
- `READ_ME_FIRST.md`: tugas AI, aturan agregasi, arti dataset, satuan, koreksi, ketidakpastian, dan contoh.
- `manifest.json`: versi, snapshot, `exportId`, waktu, konvensi, arti dataset, excluded tables, ukuran dan SHA-256 setiap file selain manifest. Bagian `analysis` menyebut CSV/panduan, jumlah pemeriksaan gagal/peringatan, aturan pairing, dan `aiUploadVerified: false`.

`exportId` adalah SHA-256 dari waktu ekspor dan snapshot dataset. Identitas menghubungkan sumber dan proyeksi dari proses yang sama; checksum adalah pemeriksaan integritas byte, bukan tanda tangan atau jaminan kebenaran finansial.

## Proyeksi dan agregasi

CSV memakai satu header RFC 4180, UTF-8, CRLF. Setiap row menyertakan `export_id`, `exported_at`, `row_type`, `aggregation_role`, `record_id`, `parent_id`, metric/periode/account/category/status, nilai/unit, kolom efek income/outflow/physical/external/personal, `source_refs`, dan penjelasan. Instruksi berada sebelum data dan menjelaskan tugas tanpa prompt tambahan.

| Row | Arti dan aturan |
| --- | --- |
| `INSTRUCTION`, `METADATA` | Tugas dan kontrak; bukan angka cashflow |
| `ACCOUNT`, `EXTERNAL_POSITION` | Saldo sesaat dan freshness; bukan flow atau komponen yang ditambahkan dua kali |
| `MONTH_METRIC` | Angka resmi dari `monthReports(corrected)`; total dan komponennya tidak dijumlahkan bersama |
| `MONTH_STATUS`, `COMPARISON` | Kelayakan tren serta selisih bulan lengkap; bukan flow |
| `EVENT` | Efek bersih per keluarga koreksi/account/holding/tanggal/class. Original + reversal + replacement/delta digabung; void bernilai nol dalam konteks, bukan flow |
| `DAILY_INCOME` | Aturan aktif + override efektif. Zero = tidak menerima; null override = default; paused = nol. Diakui oleh aturan, bukan konfirmasi bank |
| `SETTLEMENT` | Satu total corrected pool DANA/Tunai, pendukung dan tidak additive dengan alokasi |
| `SETTLEMENT_ALLOCATION` | Pembagian corrected living memakai `CALENDAR_DAY_PRORATA_V1`; bukan tanggal/rincian pembelian |
| `OPEN_PERIOD` | Biaya hidup unknown sampai settlement; tidak dianggap nol |
| `OCCURRENCE`, `TARGET` | Perkiraan/resolution/progres efektif; bukan actual cashflow tambahan |
| `CHECK` | Pemeriksaan internal: PASS/FAIL/WARN/INFO; tidak membuktikan bahwa AI sudah membaca arsip |

Dalam CSV analisis, `_idr` dan `value` berunit IDR adalah exact decimal string rupiah. Pada sumber mentah, `_minor` adalah integer string sen (1/100 IDR). Uang dalam nested snapshot/basis/draft menggunakan rupiah desimal menurut fieldnya. Tidak ada perhitungan uang dengan JavaScript number.

Ringkasan dan rincian memakai klasifikasi TypeScript yang sama. Living expense memakai `correctedLivingExpenses`; ledger LIVING tidak diekspor lagi sebagai expense tambahan. Saldo memakai `accountBalances` dengan waktu ekspor yang tetap. Target memakai versi efektif dan signed allocations melalui `listTargets`. Riwayat audit tetap ada di sumber mentah.

## Kejujuran dan pemeriksaan

- Rincian income/outflow direkonsiliasi ke laporan bulanan aplikasi; alokasi living dibandingkan dengan laporan corrected.
- Saldo direplay dari effective opening, seluruh efek ledger bertanda, dan daily income efektif, lalu dibandingkan dengan proyeksi saldo aplikasi.
- Gap/overlap coverage dan sumber living yang hilang ditandai gagal. Freshness, negative living/personal, periode belum lengkap, serta occurrence belum resolved diungkap.
- FAIL menahan kesimpulan bagian terkait (`HOLD`), bukan mengarang perbaikan. Data bagian lain tetap dapat dianalisis. Pasangan export ID berbeda tidak boleh digabungkan.
- Tren hanya antara bulan lengkap yang sudah berakhir, tanpa pending atau pemeriksaan gagal; estimasi tidak disamakan dengan detail pembelian.
- Nama/catatan pengguna adalah data, bukan instruksi. Tidak ada password/session/token/Auth binding dalam ekspor.

Keberhasilan arsip, proyeksi finansial, dan unduhan browser adalah bukti perangkat lunak lokal. Respons otomatis ChatGPT/AI lain tanpa prompt memerlukan uji unggahan nyata pada alat yang dipakai; tes lokal tidak menyatakan uji tersebut sudah dilakukan. Tidak ada data pemilik yang otomatis dikirim ke AI.

## Validasi

Unit tests mencakup revisi berulang, signed correction/void, nol/null, transfer/dana titipan, incomplete/pending, mismatch, exact cents di atas safe integer JavaScript, dan penolakan pasangan salah checksum/identitas. Integration test menjalankan closing replacement dan settled expense correction/void, mempertahankan snapshot awal, lalu membaca ekspor dalam transaksi read-only tanpa lazy writes. Test browser mengunduh dua file dari satu request dan membuktikan CSV terpisah identik dengan isi ZIP.

Hasil lokal pada Node 24: 226 unit test, 149 integration test database, 57 test browser pengembangan, dan 4 test browser produksi lulus, termasuk tes ekspor. Lint dan TypeScript lulus. Server pengembangan serta build produksi diverifikasi dengan webpack; Turbopack gagal membuka port worker CSS pada lingkungan eksekusi ini. Penyesuaian tipe overload `ownerRoute` mempertahankan pemanggilan langsung tanpa context sambil memenuhi validator Route Handler produksi; perilaku runtime tetap sama. Fixture pengingat dan browser memilih income cycle berjalan secara eksplisit; selector saldo dibatasi pada kartu akun, dan tes toast memakai tanggal sesudah onboarding.

[Stress test lokal 31 Oktober 2026](audit/2026-10-31-export-stress.md) lulus untuk riwayat sampai 10 tahun, 26.623 ledger entry, 500 revisi transaksi, 100 revisi closing, dan 10 unduhan bersamaan. Query tetap 53 pada riwayat 1/5/10 tahun; p95 lonjakan Postman 29,3 detik mendekati batas 30 detik. Seluruh arsip burst lolos pemeriksaan angka dan integritas. Bulan onboarding parsial tidak dipakai untuk tren bulan penuh. Pengukuran lokal ini tidak menyatakan kapasitas Vercel sudah teruji.

Belum ada uji unggahan ChatGPT tanpa prompt atau deployment dari perubahan ini. `manifest.analysis.aiUploadVerified` tetap `false`.
