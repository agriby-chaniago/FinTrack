**Preview fitur FinTrack — 9 November 2026**

Branch `feat/jago-reports-routines`, berdasarkan rilis `eb1738d`. Perubahan belum di-commit, belum di-deploy, dan tidak mengakses database production. Preview memakai Supabase lokal tersendiri dengan data sintetis.

**Perubahan yang tersedia**

- **Jago Utama dan Tabungan:** halaman Akun menawarkan pemisahan saldo gabungan. Owner memasukkan saldo Utama dan porsi dana titipannya, memeriksa ringkasan, lalu mengonfirmasi. Tabungan memperoleh sisa saldo; total fisik, personal, dan ownership per subject tetap sama. Server memakai owner ledger lock, preview version, dan idempotency key untuk menolak stale data/duplikasi.
- **Riwayat tetap utuh:** ID reserve lama menjadi Tabungan. Utama baru mendapat opening nol dan satu transfer internal pada tanggal pemisahan; tidak ada duplikasi opening atau pengeditan ledger/snapshot lama. Nilai nol tidak membuat transaksi palsu. Riwayat sebelum pemisahan tetap gabungan, dengan penjelasan di detail rekening. Porsi pribadi yang dipisahkan mengurangi reserve net growth bulan tersebut, bukan income atau expense.
- **Alur lanjutan:** saran BCA/DANA ke reserve tetap menuju Tabungan; sumber awal pengeluaran khusus beralih ke Utama. Transfer Utama ↔ Tabungan menggunakan alur biasa, termasuk dana titipan.
- **Laporan:** perbandingan arus kas atau reserve, pilihan 3/6/12 bulan, total/per-hari pada 4/8/12 settlement, grafik kategori, ringkasan tertinggi/terendah, dan nominal persis pada tooltip serta data pendamping. Label bulan sementara/parsial dipertahankan; grafik historis dibatasi sampai bulan yang dipilih. Grafik tetap desktop sesuai PRD; di ponsel tersedia ringkasan dan daftar data tanpa memuat Chart.js.
- **Full width:** konten memakai ruang setelah sidebar dan padding, termasuk pada layar lebar.
- **Rutinitas:** bagian utama hanya bulan ini. Disclosure riwayat menyimpan akses ke siklus sebelumnya; task bulan lama membukanya otomatis. Unresolved occurrence dan target transfer tetap mengikuti aturan yang sama, tanpa penagihan atau penyelesaian palsu.

**Verifikasi lokal**

| Pemeriksaan | Hasil |
| --- | --- |
| Migration 0014, provisioning, migration ulang | Lulus |
| Lint dan typecheck | Lulus |
| Unit | 228 lulus |
| Database | 164 lulus; stress opt-in dilewati pada suite biasa |
| E2E dev | 63 lulus |
| E2E setelah perubahan terakhir | 9 tes fitur/Laporan lulus, termasuk warna grafik saat ganti tema |
| E2E production build | 5 lulus |
| Build | Next.js 16.3.7, Turbopack, Node 24, lulus |
| Query budget | Akun 23/24; setup 12/12; Laporan 21/22; export 52/64 |

Tes baru mencakup konservasi uang sampai sen dan ownership, original ledger/snapshot immutable, stale preview, over-allocation, setup paralel, zero balance, idempotent retry, transfer dua arah, konsistensi export, batas chart historis, disclosure siklus, dan kontrol chart. Regresi warna bersama Chart.js diperbaiki: ganti tema memperbarui warna batang/titik tanpa membuat ulang chart atau mengulang animasi. Tes E2E memeriksa piksel yang digambar, bukan hanya keberadaan canvas.

Pada pemeriksaan preview production build, tiga grafik desktop tampil dan mengikuti tema, viewport ponsel 412 px tidak overflow, dan tidak ada page error. Data contoh memuat 17 settlement dan tiga siklus bulanan selesai. Form pemisahan di preview belum dikonfirmasi.

310 file runtime/test/migration dibandingkan dengan salinan yang diuji dan identik. Bukti JSON, log, dan screenshot tersedia lokal di `/home/agribychaniago/.cache/fintrack-features-20261109-44oupnkl/evidence`.

**Sebelum rilis**

Migration `0014_primary_account_split` menambah nullable FK `owner_setting.primary_account_id` dan tidak mengubah saldo. Schema perlu diterapkan sebelum kode baru diaktifkan. Versi aplikasi lama tetap kompatibel; jangan menghapus kolom/rekening baru saat rollback aplikasi. Pemisahan dana hanya terjadi lewat konfirmasi owner, bukan deploy atau page load.

Warning hydration/style dan “destination stream closed early” yang pernah muncul pada QA sebelumnya masih merupakan observasi terbuka; seluruh assertion pada tes ini lulus. Bukti di atas berlaku untuk lingkungan lokal sintetis, dan preview dibiarkan berjalan untuk pemeriksaan owner.
