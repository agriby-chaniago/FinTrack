**Audit perbaikan FinTrack — 9 November 2026**

Lima bug awal sudah ditangani di workspace lokal, ditambah satu bottleneck query lama yang terbukti saat stress test. Baseline: `adac4a6c9f0169f16e9380e7a5856b0d4251ca90`. Perubahan belum di-commit atau di-deploy. Seluruh pengujian memakai data sintetis dan Supabase khusus pengujian; database pribadi lokal dan data production tidak digunakan.

**Perbaikan dan bukti**

1. **F1 · P1 — Dua koreksi bersamaan bisa menggandakan pembalikan.** Sebelumnya, dua request dapat sama-sama membaca record aktif sebelum menunggu ledger lock. Contoh income Rp100.000 yang dikoreksi bersamaan menjadi Rp90.000 dan Rp80.000 dapat menghasilkan Rp70.000. `correctEntry` sekarang mengambil owner ledger lock sebelum membaca atau memvalidasi status record. Tes database menahan lock dengan transaksi ketiga, memastikan kedua request benar-benar menunggu di PostgreSQL, lalu membuktikan hanya satu koreksi diterima; yang lain mendapat `ALREADY_CORRECTED`.

2. **F2 · P1 — Koreksi transaksi pada hari penutupan tidak masuk perhitungan settlement.** Posting koreksi yang dicatat setelah closing sekarang mengikuti batas inklusi record asalnya. Kejadian baru setelah closing tetap mengikuti batas waktunya sendiri. Pada tes expense Minggu Rp10.000 → Rp15.000, corrected living expense menjadi Rp225.000 dan non-living Rp15.000; snapshot as-settled tetap Rp230.000/Rp10.000, serta saldo fisik kini tidak bergeser.

3. **F3 · P2 — Pergantian kategori settled expense salah menghitung laporan.** Kategori sekarang menjadi bagian dari net effect sebuah correction family. Sistem membalik efek penuh kategori lama dan membukukan efek penuh kategori baru secara atomik. Tes membuktikan koreksi kategori saja diterima, Rp150.000 kategori A → Rp120.000 kategori B menghasilkan A=0/B=Rp120.000, koreksi berikutnya mempertahankan kategori terkini, dan void meniadakan seluruh efek. Export analysis juga mengelompokkan efek per kategori dan memberi ID unik; tes mencakup urutan UUID yang berlawanan pada timestamp sama.

4. **F4 · P2 — Form koreksi hilang setelah koreksi settled pertama.** Detail record asal sekarang tetap menyediakan koreksi dengan nominal dan kategori efektif terkini. Sukses koreksi kembali ke record asal. Thread detail memuat semua posting terkait, termasuk setelah lebih dari 20 koreksi; batas pagination timeline tetap berlaku. Tes production mengoreksi record yang sudah pernah dikoreksi dari Rp15.000 menjadi Rp12.000, memeriksa form setelah reload, serta memverifikasi kategori dan laporan. Tes transfer juga memastikan komposisi dana eksternal terkini dipertahankan pada koreksi nominal berikutnya.

5. **F5 · P2 — Default bulan “Akhiri” tidak valid untuk rule yang mulai bulan depan.** Default/minimum sekarang memakai bulan yang lebih akhir antara bulan ini dan bulan pertama rule, serta mempertahankan bulan terakhir yang sudah disimpan. Berlaku untuk recurring expense dan monthly income. Tes browser membuat langganan mulai bulan depan, memeriksa nilai/minimum form, menyimpan, lalu membuka form lagi dan memeriksa nilai tersimpan.

6. **F6 · P2 — Export lambat pada riwayat besar.** Putaran stress pertama gagal: export tunggal 10 tahun sekitar 46 detik dan burst berikutnya timeout. Diagnostik pada source baseline yang tidak diubah mereproduksi proyeksi 45.02 detik, dengan 44.02 detik di query laporan `original_reserve_inflow`. Query tersebut menghitung ulang inflow record asal untuk setiap leg. `reports.ts` sekarang membentuk map inflow reserve sekali dari data yang sudah dimuat, lalu mencari record asal di TypeScript. Posting settled dan record asal berbagi business date sehingga keduanya sudah tercakup dalam batch yang sama. Metadata entry dan legs dibaca dalam dua batch berurutan; tambahan satu round trip tetap konstan terhadap panjang riwayat dan masih di bawah query budget. View as-settled tetap memakai filter historis semula. Tes juga memverifikasi gross saved dan net growth setelah transfer campuran dikoreksi berulang dan di-void. Setelah perbaikan, proyeksi 10 tahun 1.16 detik dan export tunggal 3.07 detik. Seluruh profil stress kemudian dijalankan ulang dengan threshold semula. Satu putaran antara sempat gagal khusus pada spike p95 34,5 detik meskipun error rate 0; hasil akhir di tabel berikut berasal dari implementasi dua batch dan putaran lengkap sesudah perbaikan tersebut.

Tes regresi utama berada di `tests/corrections/corrections.integration.test.ts`, `tests/e2e-prod/corrections.spec.ts`, `tests/e2e/pengaturan.spec.ts`, dan `src/server/application/export-analysis.test.ts`. Ledger dan snapshot historis tetap append-only; tidak ada migration atau perbaikan data historis otomatis.

**Makna “Akhiri” yang berlaku**

Bulan terakhir bersifat inklusif. Akhiri menghentikan perkiraan setelah bulan tersebut; occurrence yang sudah terbentuk tetap ada sampai dikonfirmasi atau ditandai “Tidak ditagih”/“Tidak diterima”. Ini mengikuti active period dan resolution history dalam [PRD.md](../../PRD.md). Menghilangkan siklus bulan sebelumnya merupakan perubahan perilaku terpisah yang masih ditunda, bersama pemisahan rekening Jago, chart baru, dan content full width.

**Hasil verifikasi**

| Pemeriksaan | Hasil |
| --- | --- |
| ESLint | Lulus |
| Typecheck + Next route type generation | Lulus |
| Unit | 228 lulus |
| Database | 155 lulus; 1 stress opt-in dilewati pada suite biasa, lalu dijalankan terpisah |
| Build production default | Turbopack, Node v24.22.2, lulus |
| Browser dev | 58 lulus, tanpa retry/flaky |
| Browser production | 5 lulus, tanpa retry/flaky |
| Stress export | Seluruh gate lulus |

Putaran browser awal menghasilkan 55 lulus/3 gagal pada tes animasi lama. Ketiga kegagalan yang sama direproduksi dengan source baseline: fixture tiga hari lalu dapat menyisakan periode minggu sebelumnya saat tes berjalan hari Senin, dan klik kartu dapat mengenai navigasi bawah. Fixture sekarang memulai periode pada Senin minggu ini, dan tes men-scroll kartu sebelum menekan. Assertion animasi dipertahankan; seluruh 58 tes kemudian dijalankan ulang dan lulus. Perubahan ini hanya menyentuh setup/interaksi tes.

**Stress export lokal**

| Riwayat (tahun) | Ledger entries | Settlement | Request paralel | p95 | Error |
| --- | --- | --- | --- | --- | --- |
| 1 | 1,103 | 53 | 1 | 0.33 s | 0 |
| 1 | 1,103 | 53 | 5 | 0.69 s | 0 |
| 5 | 10,783 | 261 | 1 | 1.12 s | 0 |
| 5 | 10,783 | 261 | 5 | 4.51 s | 0 |
| 10 | 26,624 | 522 | 1 | 3.07 s | 0 |
| 10 | 26,624 | 522 | 5 | 12.72 s | 0 |
| 10 | 26,624 | 522 | 10 | 25.63 s | 0 |

| Profil 60 detik | Peak VU | Request | p95 | Error rate | Request gagal assertion |
| --- | --- | --- | --- | --- | --- |
| fixed | 5 | 65 | 5.33 s | 0% | 0 |
| spike | 10 | 21 | 25.16 s | 0% | 0 |

Query budget: 1 tahun: 54/64 query, 5 tahun: 54/64 query, 10 tahun: 54/64 query. Peak RSS server 1043.6 MiB dengan heap limit 1.024 MiB. Gate tetap: query ≤64, single export ≤15 s, burst p95 ≤60 s, load p95 <30 s, error rate 0, peak RSS ≤1.536 MiB. Archive dan checksum divalidasi. Postman berjalan lokal dengan recording dimatikan. Angka ini menguji export pada data sintetis lokal; kapasitas dan latensi deployment Vercel belum ditetapkan.

**Temuan terbuka dan batas hasil**

- Warning hydration pada style komponen animasi pernah teramati selama QA; pada putaran dev terakhir tercatat 1 warning tersebut. Log “The destination stream closed early” muncul 1 kali pada suite dev dan 1 kali pada suite production. Seluruh assertion browser lulus; penyebab serta dampak production warning tersebut belum dipastikan dan tidak dinyatakan selesai oleh perbaikan ini.
- Rekalkulasi koreksi terhadap riwayat settlement panjang masih perlu diperhatikan terpisah dari benchmark export. Tidak ada klaim bahwa seluruh mutation sudah diuji beban.
- Data production tidak diaudit atau direparasi. Bila bug sebelumnya telah menghasilkan record yang salah, perbaikan kode tidak otomatis membersihkan record tersebut.
- Hasil ini membuktikan skenario dan gate yang dijalankan; bukan jaminan seluruh project bebas bug.

Ringkasan mesin, profil stress lengkap, dan SHA-256 source yang berubah tersedia di [2026-11-09-correction-fixes.json](2026-11-09-correction-fixes.json). Sebanyak 271 file runtime/test dibandingkan dengan salinan yang diuji; satu-satunya selisih adalah lokasi output laporan stress pada salinan terisolasi. Log dan bukti lokal: `/home/agribychaniago/.cache/fintrack-fix-20261108-z_ekm_48/evidence`. Stack khusus pengujian `fintrack_fix_20261108` sudah dihentikan; stack lokal semula `fintrack_new` tetap berjalan. Bukti cleanup tercatat dalam JSON pendamping.
