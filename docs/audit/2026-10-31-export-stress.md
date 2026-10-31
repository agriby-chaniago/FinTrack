# Stress test ekspor — 31 Oktober 2026

**Hasil: seluruh gate stress lokal lulus setelah perbaikan.** Ini bukti pada build produksi lokal, bukan pengukuran kapasitas Vercel atau bukti respons ChatGPT tanpa prompt.

Hasil terstruktur: [sesudah perbaikan](2026-10-31-export-stress.json). Bukti kegagalan awal tetap disimpan di [sebelum perbaikan](2026-10-30-export-stress-before-fix.json).

## Lingkungan dan batas pengujian

- Node v24.22.2, Next.js 16.3.7 dengan build webpack; server menjalankan `next start`.
- CPU lokal Intel i5-12450HX, 12 logical CPU. Heap server dibatasi 1.024 MiB; gate RSS 1.536 MiB.
- Database, Auth, server, dan load generator berjalan lokal. Fixture menolak URL database/Auth di luar loopback. Tidak ada pengujian atau transaksi keuangan pada production.
- Postman CLI memakai runner lokal (`recorded: false`). Token akun uji disimpan sementara dengan mode 0600, lalu dihapus. Akun dan fixture uji dibersihkan sesudah pengujian.
- Ekspor menggunakan satu transaksi owner-scoped `REPEATABLE READ, READ ONLY`. Tidak ada penambahan query paralel dalam transaksi.
- Fixture memakai empat akun, settlement mingguan, target dan versi historis, transaksi dengan catatan bervariasi, rantai koreksi transaksi, dan revisi saldo settlement melalui mutation aplikasi yang sebenarnya.

## Hasil

Angka ukuran memakai MB desimal. Latensi burst di bawah adalah respons paling lambat dari seluruh unduhan dalam satu burst; penguraian dan validasi arsip dilakukan sesudah pencatatan latensi HTTP.

| Riwayat | Ledger entry | Settlement | Revisi transaksi / closing | Query | ZIP / CSV analisis | Tunggal | 5 bersamaan | 10 bersamaan |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 tahun | 1.102 | 52 | 24 / 0 | 53 | 0,47 / 1,13 MB | 0,86 dtk | 1,32 dtk | — |
| 5 tahun | 10.782 | 260 | 250 / 20 | 53 | 4,18 / 8,71 MB | 1,19 dtk | 4,93 dtk | — |
| 10 tahun | 26.623 | 521 | 500 / 100 | 53 | 10,20 / 20,57 MB | 2,85 dtk | 13,52 dtk | 30,02 dtk |

| Profil Postman | Dataset | Durasi | Request | Error / assertion gagal | p95 | Gate |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Tetap 5 VU | 5 tahun | 60 dtk | 57 | 0 / 0 | 5.114 ms | Lulus, <30.000 ms |
| Lonjakan 1 → 10 → 1 VU | 10 tahun | 60 dtk | 19 | 0 / 0 | 29.308 ms | Lulus, <30.000 ms |

Seluruh gate yang ditetapkan sebelum pengulangan tetap dipakai: maksimal 64 query, burst tunggal maksimal 15 detik, burst paralel maksimal 60 detik, p95 Postman di bawah 30 detik, error rate nol, dan RSS server maksimal 1.536 MiB. Puncak RSS server **1.007,21 MiB**; puncak load generator **746,06 MiB**, dicatat terpisah.

Margin p95 lonjakan terhadap batas 30 detik hanya 692 ms, dengan 19 sampel. Hasil ini cukup untuk meluluskan gate lokal, tetapi tidak membuktikan headroom besar pada beban ekstrem atau hasil yang sama pada CPU dan koneksi database Vercel.

## Pemeriksaan kebenaran

Semua 28 respons pada burst diperiksa, termasuk yang diunduh bersamaan:

- CSV terpisah identik byte dengan CSV dalam ZIP; export identity dan SHA-256 seluruh file pada manifest cocok.
- Parser RFC 4180 independen membaca seluruh row, memastikan jumlah kolom, identitas snapshot, dan keunikan `record_id` yang terisi. Dataset terbesar berisi 34.565 row analisis.
- Referensi `ledger_leg.entry_id` tersedia pada dataset ledger sumber.
- Masing-masing settlement menghasilkan satu nilai corrected Rp350.000; keluarga koreksi transaksi tetap bernilai efektif Rp100.000 setelah ratusan revisi.
- Pemeriksaan internal proyeksi tidak menemukan mismatch saldo, cashflow bulanan, atau alokasi settlement pada fixture ini.
- Sesudah setiap profil, request tanpa autentikasi tetap 401 dan akun non-owner tetap 403 dengan error JSON.

Sebanyak 76 request Postman tambahan menguji status HTTP, tipe ZIP, `no-store`, dan request ID. Pemeriksaan rinci isi setiap arsip dilakukan pada burst di atas; tidak diklaim telah dilakukan pada seluruh respons Postman.

## Kegagalan awal dan perbaikan

Pengujian awal gagal: query bertambah dari 53 menjadi 73 dan 153 ketika rantai closing bertambah; p95 lonjakan mencapai 33.040 ms. Angka finansial dan checksum pada pengujian awal tetap cocok.

Perbaikan yang diuji:

1. Penelusuran confirmation yang menggantikan versi lama memakai satu recursive query dengan predicate owner dan perlindungan siklus. Jumlah query kini tetap 53 pada ketiga profil; integration test juga menambahkan revisi closing nyata dan membuktikan query tidak bertambah.
2. Snapshot JSON hanya mengubah kolom uang menjadi string exact, tanpa membangun ulang setiap key setiap row. CSV/JSON mentah tetap mempertahankan seluruh riwayat dan presisi uang.
3. Laporan banyak bulan membuat indeks coverage settlement sekali, lalu memakainya untuk seluruh bulan. Aturan kelengkapan bulan memakai implementasi yang sama untuk pemanggilan tunggal dan batch.
4. Bulan onboarding yang dimulai di tengah bulan, termasuk pada hari terakhir bulan, ditandai parsial dalam analisis dan tidak dipakai untuk tren bulan penuh. Unit dan integration test mereproduksi kasus tersebut.

Level kompresi produk tetap 6. Benchmark lokal level 1 juga dicatat dalam JSON, tetapi tidak diterapkan. Tidak ada perubahan schema, dependency, atau batas lulus untuk membuat pengujian lolos.

Run awal memakai Node v25.2.1; run akhir memakai Node v24.22.2, sesuai major runtime deployment. Fixture mengikuti tanggal pengujian. Karena runtime dan waktu berbeda, selisih latensi kedua run tidak dianggap eksperimen yang mengisolasi satu perubahan kode.

## Regresi dan hal yang belum dibuktikan

Pada Node 24: 226 unit test, 149 database integration test, 57 test browser pengembangan, dan 4 test browser produksi lulus. Putaran penuh browser pengembangan terakhir meluluskan seluruh 57 test setelah perbaikan fixture. Stress test opt-in dijalankan tersendiri dan lulus; saat suite database biasa berjalan, satu stress test itu dilewati. Lint, typecheck, dan `git diff --check` lulus.

Regresi browser pengembangan juga menemukan prasyarat fixture yang tidak sesuai skenario: siklus bulan berjalan belum diaktifkan, pengingat rekonsiliasi akhir bulan mengalahkan badge yang sedang diuji, selector saldo ikut memilih link tugas, dan tanggal saran kewajiban mendahului onboarding. Perbaikan dibatasi pada fixture/aksi/selector tes; assertion tetap dipertahankan. Fixture memilih bulan berjalan dengan mempertimbangkan apakah cutover berada pada bulan sebelumnya. Fixture pengingat database juga memilih income cycle berjalan secara eksplisit. Server pengembangan memakai webpack untuk menghindari pembatasan worker Turbopack pada lingkungan ini.

Build produksi webpack lulus. Build Turbopack default pada lingkungan eksekusi ini gagal saat worker CSS mencoba membuka port (`Operation not permitted`); keberhasilan webpack tidak disebut sebagai keberhasilan build Turbopack.

Belum dibuktikan: latensi/kapasitas pada Vercel, unduhan owner melalui deployment production, dan respons ChatGPT terhadap unggahan CSV + ZIP tanpa prompt. `manifest.analysis.aiUploadVerified` tetap `false`. Data pemilik tidak dikirim otomatis ke AI.
