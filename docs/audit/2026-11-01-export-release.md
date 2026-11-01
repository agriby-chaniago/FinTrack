# Verifikasi rilis ekspor v2 — 1 November 2026

## Bukti sebelum aktivasi

- Perubahan aplikasi: CSV analisis corrected + ZIP sumber/audit dari satu snapshot. Tidak ada migration atau dependency baru.
- Runtime Vercel dipin ke Node 24.x; build cloud Turbopack dan fungsi Node 24 sudah diperiksa pada kandidat produksi.
- Regresi hosted staging: 149 test unik lulus dari rerun terarah pada 16 suite. Satu stress test khusus lokal dilewati sesuai guard. Hasil ini bukan satu run tanpa interupsi: ekspektasi badge ledger disesuaikan dengan pergantian bulan; hook Auth pengingat sempat gagal transport lalu tujuh test pengingat lulus saat dijalankan ulang.
- Smoke hosted staging commit `eb961d3`: settlement Rp300.000 → Rp250.000 → Rp275.000 diekspor sekali pada Rp275.000; snapshot awal Rp300.000 tetap utuh. Koreksi/void expense menghasilkan nol. Seluruh checksum dan identitas baris cocok, failed checks nol.
- Postman live staging: tiga request owner/tanpa autentikasi/non-owner menghasilkan 200/401/403; sembilan assertion lulus, exit code 0. Hasil tidak dipublikasikan ke Postman Cloud.
- Browser live staging: Beranda, Rutinitas, Aktivitas, Akun, Pengaturan, serta unduhan CSV + ZIP lulus. Hanya satu request ekspor; CSV terpisah identik byte dengan file di ZIP. Semua pengguna/data staging sintetis dibersihkan setelah tes.
- CI sebelumnya menemukan satu asumsi fixture yang gagal pada hari Minggu: settlement mingguan sah masih tersisa setelah tiga tugas bulanan selesai. Skenario tersebut kini memulai daily income besok sehingga hanya tiga tugas bulanan yang due; assertion animasi dan daftar hilang dipertahankan. Ketujuh test pada berkas itu lulus lokal, juga lint/TypeScript.

## Batas bukti

[Stress lokal](2026-10-31-export-stress.md) mencakup riwayat 10 tahun, 26.623 ledger entry, 500 revisi transaksi, 100 revisi closing, dan 10 unduhan bersamaan. Query tetap 53; p95 spike 29.308 ms terhadap gate 30.000 ms. Ini tidak mengukur kapasitas Vercel. Run awal yang gagal tetap dicatat.

Uji owner pada hosted deployment memakai staging sintetis. Production smoke tidak memakai kredensial owner atau mengubah data finansial production. Keepalive hanya membaca `ops.keepalive_probe`.

Unggahan CSV + ZIP ke ChatGPT tanpa prompt belum diuji. `manifest.analysis.aiUploadVerified` tetap `false`; data tidak otomatis dikirim ke AI.

## Aktivasi dan pemeriksaan production

Rilis aplikasi commit `eb961d3c19e9f360280313cf9cc455359dd417b8` telah aktif di [production](https://fintrack-new-woad.vercel.app). [PR #2](https://github.com/agriby-chaniago/FinTrack/pull/2) masuk ke `main` secara fast-forward pada 1 November 2026 pukul 13:34:42 UTC.

- [CI rilis](https://github.com/agriby-chaniago/FinTrack/actions/runs/41311241328) lulus pada Node 24: lint, TypeScript, 226 unit, 149 DB (satu stress test lokal dilewati), 57 browser pengembangan, empat browser produksi, build Turbopack, migration rebuild/idempotency, dan backup/restore drill lokal.
- Kandidat produksi yang diuji dipromosikan; integrasi Git juga membangun commit yang sama untuk domain utama. Primary alias diperiksa pada `dpl_G8TpGsLmtaxZRMB4dHaR7Gnxb2yL`; extra alias pada `dpl_DUtEhrkYuaM6VtSpAELun9PPrwSa`. Keduanya READY, target Production, commit aplikasi sama, dan Node 24. Runtime fungsi primary diperiksa sebagai `nodejs24.x`.
- Smoke publik production lulus: login 200, PWA manifest 200 dengan display standalone, ekspor tanpa autentikasi 401 JSON dengan request ID, internal keepalive tanpa token 401. Tidak ada login atau ekspor data owner production dalam tes ini.
- [Workflow probe production](https://github.com/agriby-chaniago/FinTrack/actions/runs/41312050064) lulus; script mewajibkan respons HTTP 204 dari satu query baca saja ke `ops.keepalive_probe`. CLI sempat kehilangan koneksi setelah dispatch, tetapi run sudah tercipta; run yang sama dipantau tanpa mengirim dispatch duplikat.
- Pemindaian error-level request logs pada kedua deployment selama 15 menit terakhir, diperiksa 13:36:50 UTC: nol record error. Ini pemeriksaan sesaat setelah rilis, bukan jaminan tidak akan ada error berikutnya.

[Rekaman hasil terstruktur](2026-11-01-export-release.json) mempertahankan identitas deployment, hasil staging/production, dan batas bukti. Dokumentasi sesudah rilis dapat memiliki commit tersendiri; commit di atas mengidentifikasi kode aplikasi yang diverifikasi. Tidak ada perubahan schema atau data finansial production dalam rilis ini.
