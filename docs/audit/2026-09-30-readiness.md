# Audit Second Opinion — FinTrack Implementation Readiness (PRD v0.15)

> **Asal dokumen:** Audit read-only oleh subagent pada 30 September 2026 pukul 11:04 WIB, disalin utuh dari transcript sesi tersebut. Auditor membaca `AGENTS.md` (saat ini sudah tidak ada di repository), `~/.codex/RTK.md`, `PRD.md` v0.15 lengkap, dan `.github/workflows/supabase-keepalive.yml`, lalu memeriksa langsung dokumentasi Supabase project-pausing dan GitHub scheduled workflows.
>
> **Status:** OD-1 sampai OD-6 telah diputuskan pemilik dan diterapkan pada PRD v0.16 (semuanya mengikuti rekomendasi audit). Hard blocker, mechanical clarification, dan implementation risk belum diterapkan. `PRD.md` tetap menjadi source of truth. Nomor baris `PRD:<n>` merujuk ke PRD v0.15.
>
> **Koreksi setelah audit (30 September 2026):**
>
> - §8 menyebut 44 jalur pengecualian. Hitungan ulang terhadap `PRD.md:2155–2216` menghasilkan 60 butir.
> - §11 menyebut repository "bersih, satu commit". Saat audit berjalan, `PRD.md` dan workflow keepalive sebenarnya belum di-commit.
> - Temuan tambahan di luar audit: cara backup harian via GitHub Actions memperoleh credential database (role, cakupan, penyimpanan secret) belum didefinisikan di PRD.

## 1. Verdict

**CONDITIONALLY READY — siap dimulai pada Slice 0–2, belum siap dieksekusi end-to-end.**

Kepercayaan: **tinggi (≈85%)** untuk klasifikasi temuan; **sedang (≈65%)** untuk perkiraan effort, karena belum ada satu baris kode dan kendala platform (role Postgres kustom di Supabase pooler) belum dibuktikan empiris.

Kesimpulan prior plan "ready, no hard blockers" **tidak akurat**. Ada 5 hard blocker dan 6 keputusan pemilik yang belum diambil. Namun blocker-nya sempit dan terlokalisasi — bukan cacat model domain. Model akuntansi PRD sendiri **kuat dan terverifikasi aritmetis** (lihat §2).

---

## 2. Yang Saya Verifikasi Benar (agar penilaian adil)

| Item | Bukti |
|---|---|
| Fixture Februari 2027 konsisten aritmetis | PRD:1989–1998. 1 Feb 2027 memang Senin, Feb 2027 = 28 hari, 4 minggu penuh Sen–Min. Recognized 350+300+350+250=1.250.000 ✓; living 240+230+270+190=930.000 ✓; remainder 110+70+80+60=320.000 = gross DANA→Jago ✓; rata-rata 930.000/28=33.214,28→≈33.214 ✓ |
| Rekonsiliasi lintas-akun fixture | PRD:2021–2024. Income 2.000.000 − outflow 1.495.000 = +505.000 = net reserve growth. DANA dan BCA kembali ke opening; seluruh delta ada di Jago ✓ |
| Minggu-4 memakai calendar days, bukan eligible days | 190.000/7=27.142,857→≈27.143 ✓ membuktikan PRD:429 |
| `CALENDAR_DAY_PRORATA_V1` largest-remainder | PRD:828. 24.000.000 sen ×5/7 = 17.142.857,14 (floor 17.142.857, sisa 0,14); ×2/7 = 6.857.142,86 (floor 6.857.142, sisa 0,86). Sisa 1 sen ke November → 68.571,43 dan 171.428,57, total tepat 240.000 ✓ |
| Fixture external-funds 7 langkah | PRD:2045–2071. Rekonsiliasi personal (400.000−350.000+60.000=110.000) dan external (431.999,93+200.000−150.000−80.000−60.000=341.999,93) cocok ✓ |
| Formula settlement self-correcting terhadap urutan transfer | living = opening + income − transfer_out − closing. Jika closing sudah pasca-transfer, term transfer saling hapus. Aman secara matematis |
| Koreksi di dalam minggu settled **tidak** cascade ke minggu berikutnya | Setiap settlement di-anchor oleh balance confirmation otoritatif (PRD:1038). Cascade living expense terbatas satu hop, hanya jika closing confirmation itu sendiri diganti |
| Model auth (`app_owner` stabil, bootstrap out-of-band, fail-closed) | PRD:1496–1535. Koheren, tidak ada first-user-wins, tidak ada cascade delete |
| Taksonomi koreksi lengkap | reversal/replacement, reversal-only void, `CORRECTION_POSTING`, `BALANCE_ADJUSTMENT` — masing-masing punya trigger dan batas yang jelas (PRD:986–1019) |

Model keuangan PRD lebih matang dari rata-rata dokumen pra-implementasi. Masalahnya ada di **jahitan antar-bagian**, bukan di inti.

---

## 3. Temuan Terklasifikasi

### 3.1 HARD BLOCKER (5)

---

**HB-1 — Runtime DB role tanpa `BYPASSRLS` belum terbukti bisa dijalankan di Supabase pooler.**

PRD:1554 mengunci: "Runtime database role bukan table owner dan tidak memiliki `BYPASSRLS`". PRD:2226 menjadikannya acceptance criteria. PRD:1448 mewajibkan seluruh query normal lewat RLS-aware Drizzle transaction.

Masalah: koneksi Drizzle default ke Supabase memakai role `postgres` bawaan proyek. Dokumentasi Supabase sendiri menganjurkan membuat role terpisah per service dan menunjukkan format username pooler `postgres.<project-ref>` — artinya role kustom akan berbentuk `fintrack_app.<project-ref>`. Yang **belum terbukti**: apakah Supavisor transaction pooler menerima role kustom, apakah `SET LOCAL role` + `set_config('request.jwt.claims', …, true)` bekerja di transaction mode, dan apakah `postgres-js` perlu `prepare: false`.

Jika kombinasi ini gagal, arsitektur LOCKED harus dinegosiasi ulang — setelah puluhan tabel dibuat. Ini harus dibuktikan **sebelum** M1.

*Ini rekomendasi saya, bukan fakta PRD.* PRD tidak menyebut Supavisor sama sekali.

---

**HB-2 — Probe relation dan probe credential untuk keepalive tidak ada di model domain manapun.**

PRD:1532 mewajibkan keepalive "tidak dapat membaca financial tables, dan hanya memiliki akses read-only ke probe nonfinansial". PRD:1625 menyebut "satu query read-only nyata ke relasi probe nonfinansial". PRD:2223 dan PRD:2344 menjadikannya acceptance.

Tapi: tidak ada entity probe di daftar entity (PRD:1681–1711), tidak ada role ketiga di §Authorization (PRD:1513–1560, yang hanya menyebut runtime dan admin), dan tidak ada kolom/tabel di §Model domain. Workflow `.github/workflows/supabase-keepalive.yml` sudah ada dan sudah memanggil endpoint yang belum punya backing store.

Konsekuensi: total ada **tiga** database role (migration/admin, `fintrack_app` RLS-bound, `fintrack_probe` read-only satu tabel) dan satu tabel `ops_probe`. Semuanya harus masuk M0. Prior plan tidak menyebut satupun.

---

**HB-3 — Urutan slice prior plan salah: koreksi settled-history ditempatkan sebelum settlement ada.**

Prior plan: slice 3 = "actual events/transfers/corrections/reconciliation"; slice 4 = "DANA routine".

PRD:1009 mendefinisikan `CORRECTION_POSTING` semata-mata sebagai "koreksi record yang sudah masuk settlement". PRD:994 menegaskan trigger-nya adalah "Financial event/transfer masuk settlement". PRD:699 mendefinisikan settled-history reclassification untuk special expense DANA.

Tanpa entity settlement, `CORRECTION_POSTING` **tidak punya definisi, tidak punya trigger, dan tidak punya acceptance test yang bisa ditulis**. Slice 3 akan menghasilkan kode spekulatif yang harus ditulis ulang di slice 4.

Perbaikan: pisahkan open-period correction (reversal/replacement/void) — yang memang bisa dibangun lebih awal — dari settled-history correction, dan tempatkan yang kedua setelah settlement.

---

**HB-4 — Algoritma dan batas recalculation chain transfer target tidak terdefinisi.**

PRD:911: "Jika correction mengubah target lama yang menjadi basis target setelahnya, FinTrack membuat superseding target versions secara kronologis untuk seluruh affected chain dalam correction flow yang atomik; jika chain gagal direkalkulasi, seluruh correction dibatalkan."

Chain ini nyata dan tidak terbatas. Contoh DANA: target minggu N = `max(0, closing personal − prior outstanding)` (PRD:362–365). Prior outstanding minggu N+1 bergantung pada sisa target N. Mengoreksi closing balance minggu 1 mengubah target 1 → prior outstanding 2 → target 2 → … sampai minggu terakhir. Sama untuk BCA via `prior_outstanding_at_readiness` (PRD:528–543).

Yang hilang: definisi *affected chain* (rute + context_key ≥ context_key yang dikoreksi?), urutan evaluasi, perlakuan allocation yang sudah terpasang saat target menyusut, dan batas atas iterasi. Tanpa ini, slice transfer-target tidak dapat diimplementasi secara deterministik atau diuji.

Catatan penting hasil self-review: cascade ini **hanya** mengenai transfer target. Living expense **tidak** ikut cascade karena setiap settlement di-anchor closing confirmation otoritatif. Saya sempat menilai ini lebih luas; setelah diperiksa ulang, lingkupnya lebih sempit tapi tetap blocker.

---

**HB-5 — Titik pembuatan rule dan setting awal tidak terdefinisi; flow onboarding bertentangan dengan acceptance.**

§Financial data onboarding flow (PRD:1159–1163) hanya punya 5 langkah: cutover → physical balances → external → review → konfirmasi.

Tapi acceptance scenario utama langkah 7 (PRD:2117) mewajibkan: "Memulai daily automation pada hari setelah cutover secara default dan BCA recurring cycle pada bulan berikutnya secara default, dengan explicit opt-in jika periode berjalan memang belum termasuk opening balance." PRD:276–282 merinci opt-in tersebut. Keduanya tidak muncul di flow.

Lebih dalam lagi: **tidak ada tempat manapun di PRD yang mendefinisikan kapan rule berikut dibuat** —
- daily income rule DANA Rp50.000 (PRD:288)
- monthly income rule BCA ~Rp750.000 + `first_expected_cycle` (PRD:436, 453)
- subscription aktif dengan expected day 5 (PRD:465)
- bank fee rule tanpa expected date/amount (PRD:484–488)
- `retained_balance_floor` (PRD:518)
- default special-expense source = Jago (PRD:1739)
- seed category `Vape` (PRD:681)

PRD:2358–2362 ("Pending onboarding data") hanya menyebut cutover, saldo, dan external subject — jadi nilai rule dianggap sudah diketahui, tapi mekanisme pembuatannya kosong. Slice accounts/onboarding tidak dapat dispesifikasi tanpa ini.

---

### 3.2 OWNER DECISION REQUIRED (6)

---

**OD-1 — Tidak ada jalan keluar untuk DANA transfer target yang permanen tidak dapat dipenuhi.**

`New DANA transfer target = max(0, closing personal DANA balance − prior DANA outstanding)` (PRD:362–365). Prior outstanding hanya mencakup target yang masih *actionable* (PRD:358).

Skenario: minggu 1 target Rp110.000 tidak ditransfer. Minggu 2 uangnya terpakai untuk special expense DANA. Prior outstanding tetap Rp110.000 selamanya. Target setiap minggu berikutnya = `max(0, closing − 110.000)` — untuk closing kecil, hasilnya **Rp0 permanen**. FinTrack berhenti menyarankan transfer DANA sama sekali.

PRD:367 menyadari kondisi ini ("FinTrack menampilkan liquidity warning dan tidak mengubah target historis secara diam-diam") tapi hanya menyediakan warning. Model data mendukung solusinya — target version punya "optional retirement reason" (PRD:881) dan non-actionable version dikecualikan dari outstanding (PRD:911) — namun satu-satunya trigger retirement yang didefinisikan adalah `INCOME_NOT_RECEIVED` untuk BCA (PRD:556). Tidak ada aksi pengguna untuk retire target DANA di action map (PRD:1198–1208) maupun scope MVP (PRD:1868–1931).

Keputusan yang dibutuhkan: (a) tambahkan aksi eksplisit "Tutup target ini" dengan reason `LIQUIDITY_WRITE_OFF`, atau (b) terima perilaku ini dan dokumentasikan konsekuensinya. Rekomendasi saya: (a) — biayanya satu endpoint + satu reason enum, dan (b) merusak nilai utama produk.

---

**OD-2 — Perilaku ketika BCA cycle mencapai ready branch sementara `retained_balance_floor` belum diisi.**

PRD:520: "Nilainya wajib dipilih secara eksplisit dan tidak boleh negatif ketika BCA remainder suggestion diaktifkan; Rp0 adalah pilihan valid." — jadi default Rp0 dilarang oleh kalimat "wajib dipilih secara eksplisit".

PRD:577: "Target harus dibuat atomik ketika cycle memasuki ready branch; target yang hilang pada branch ini adalah invariant error, bukan user-facing state baru."

Tabel precedence cycle state (PRD:566–575) dinyatakan mutually exclusive dan tidak punya baris untuk "floor belum diset". Hasilnya: cycle ready + floor kosong = invariant error yang dapat dipicu pengguna.

Keputusan: (a) floor menjadi field wajib di onboarding (menutup HB-5 sekaligus), (b) tambah baris precedence `WAITING_FOR_FLOOR_SETTING` di posisi 4, atau (c) longgarkan PRD:520 menjadi default Rp0.

---

**OD-3 — Batas bawah backfill occurrence untuk recurring rule baru.**

PRD:463 memberi setiap subscription "active period". PRD:514 mewajibkan gating kronologis: cycle baru menunggu seluruh cycle lama resolved. PRD:1807 hanya membatasi *revision* ke `effective_from_cycle` prospektif — bukan pembuatan rule baru.

Konsekuensi: menambah subscription kedua dengan start period di masa lalu akan membangkitkan occurrence untuk cycle-cycle yang sudah lewat, seluruhnya `PENDING`, dan langsung memaksa cycle berjalan ke `WAITING_FOR_PRIOR_CYCLE`. Target transfer BCA terkunci sampai pengguna menyelesaikan riwayat palsu.

Keputusan: tolak rule dengan start cycle lebih awal dari cycle terbuka tertua, atau definisikan semantik backfill eksplisit.

---

**OD-4 — Cadence keepalive 3 hari lebih jarang dari panduan Supabase.**

Dokumen Supabase project-pausing yang saya ambil menyatakan: proyek Free dipause berdasarkan aktivitas rendah **dalam jendela 7 hari**, dan "typically a few user requests to the database each day over the previous week is enough to keep the project from being paused".

Desain saat ini: satu query per 3 hari UTC (PRD:1622, workflow baris 29–35) ≈ 2–3 request per jendela 7 hari. Dokumen GitHub yang saya ambil menyatakan scheduled event "can be delayed during periods of high loads … some queued jobs may be dropped". Satu run yang di-drop → jeda 6 hari dengan satu query. Dua run di-drop → 9 hari, melewati jendela 7 hari.

PRD:1636 sudah mengakui ini "best effort", jadi **bukan kontradiksi PRD** — tapi prior plan memasukkan keepalive ke "production gates" seolah sudah memadai. Tidak ada alasan biaya untuk 3 hari: probe read-only harian ≈ 365 run/tahun, tidak material di GitHub Actions.

Keputusan: ubah ke harian, atau terima risiko pause secara tertulis.

---

**OD-5 — Apakah recurring expense boleh bersumber dari account selain BCA.**

PRD:457 menyebut "Source account normal adalah BCA" — *normal*, bukan wajib. PRD:463 menjadikan source account atribut per-subscription. PRD:1812 menyimpan "actual source `account_id`" di occurrence.

Jika subscription atau bank fee pernah dibayar dari DANA, expense itu masuk rentang settlement DANA dan **harus** dikurangkan sebagai non-living deduction. Formula PRD:415 secara kata memang mencakupnya ("recorded non-living/special expenses paid from DANA"), tapi PRD:693 dan PRD:1779 hanya menyebut *special expense* sebagai deduksi DANA.

Keputusan: (a) batasi recurring expense ke satu account non-DANA (sederhana, hilangkan satu kelas bug), atau (b) izinkan dan tulis ulang aturan deduksi berdasarkan klasifikasi (lihat MC-3).

---

**OD-6 — Perlakuan living expense negatif.**

Living expense = opening + income − … − closing (PRD:409–417). Jika DANA menerima uang yang tidak tercatat, closing > income → living expense negatif → average per day negatif.

Spesifikasi prorata sudah menangani tanda ("floor magnitude … lalu terapkan kembali tandanya", PRD:822), jadi lapisan reporting siap. Tapi UX settlement tidak mendefinisikan apa pun: PRD:846 hanya melarang menganggap coverage hilang sebagai Rp0.

Keputusan: izinkan dengan peringatan eksplisit ("ada pemasukan yang belum tercatat"), atau blokir konfirmasi sampai dijelaskan.

---

### 3.3 MECHANICAL CLARIFICATION (14)

| ID | Temuan | Bukti PRD | Perbaikan |
|---|---|---|---|
| MC-1 | Dua granularitas waktu dipakai untuk perhitungan saldo yang sama: `business date` date-only (PRD:1759, 1855) vs `as_of` timestamp (PRD:207, 262, 938, 1080). Urutan event dalam satu hari tidak terdefinisi | 207, 658, 938, 1080, 1759 | Tetapkan kunci urut kanonik `(business_date, recorded_at, id)`. Balance confirmation tanpa timestamp = akhir hari bisnis `Asia/Jakarta` |
| MC-2 | Snapshot settlement hanya membekukan "tanggal `ACTIVE`, overrides, dan recognized income" (PRD:341). Tanpa **opening personal balance**, closing physical, closing personal, daftar deduksi non-living, dan legs transfer, view as-settled tidak dapat direproduksi | 341, 409–417 | Bekukan seluruh input formula, bukan sebagian |
| MC-3 | Himpunan deduksi DANA dirumuskan dua kali dan tidak identik: "recorded non-living/special expenses" (415) vs hanya special expense (693, 1779) | 415, 693, 1779 | Definisikan berdasarkan klasifikasi: *seluruh confirmed personal outflow DANA dalam rentang yang bukan ordinary living*, bukan daftar kind |
| MC-4 | Daily income tidak dimaterialisasi sebagai row (PRD:299). Koreksi override pasca-settlement (PRD:1066) memerlukan `CORRECTION_POSTING` dengan "target type/id" (PRD:1010) — tapi tidak ada row event yang bisa dirujuk | 299, 1010, 1066 | Jadikan komponen recognized income pada snapshot settlement sebagai target koreksi resmi; atau materialisasi income saat settlement |
| MC-5 | "Cash account" mengatur kartu dashboard (1241) dan penjumlahan personal cash (719), tapi `account_type` (1722) tidak punya klasifikasi kas | 719, 1241, 1722 | Tambah `is_cash_equivalent boolean not null` |
| MC-6 | `transfer_target` butuh konteks polimorfik "settlement/cycle dan route" (881), tapi tidak ada entity "BCA cycle" di daftar entity (1681–1711) | 881, 564, 1681–1711 | `transfer_target(context_type, context_key, source_account_id, destination_account_id)` unik per owner; `context_key` = settlement_id atau `YYYY-MM` |
| MC-7 | "Hanya satu resolution yang boleh menjadi latest non-superseded" (505) tidak dapat ditegakkan dengan `supersedes_id` saja | 505, 881, 1068, 1071 | Tambah kolom `superseded_by_id` + partial unique index `WHERE superseded_by_id IS NULL`, dijaga dalam transaksi yang sama. Berlaku juga untuk target version dan balance confirmation |
| MC-8 | Arsip subject external mensyaratkan seluruh posisi Rp0 (1232); arsip **account** tidak punya syarat apa pun (1736). Mengarsipkan account yang masih memegang external holding menyembunyikan kewajiban | 1232, 1736 | Tolak arsip account jika external outstanding ≠ 0; peringatkan jika personal ≠ 0 |
| MC-9 | Prompt reconciliation Jago/BCA terikat pada selesainya BCA cycle (976). Setelah `last_expected_cycle` monthly income rule (454), cycle berhenti dibuat dan Jago tidak pernah lagi mendapat prompt | 454, 976 | Fallback: prompt bulanan berbasis kalender jika tidak ada cycle aktif |
| MC-10 | `cycle_key` didefinisikan hanya untuk recurring expense occurrence (1811); monthly income occurrence memakai konsep cycle tanpa nama field | 453, 1811, 564 | Satukan `cycle_key` (`YYYY-MM`) pada kedua occurrence; definisikan "monthly cycle" sebagai grouping turunan `(owner_id, account_id, cycle_key)` |
| MC-11 | Flow onboarding 5 langkah tidak memuat boundary opt-in yang diwajibkan acceptance | 1159–1163 vs 276–282, 2117 | Tambah langkah 6 (daily income start + opt-in hari cutover) dan 7 (BCA first cycle + opt-in cycle berjalan) |
| MC-12 | "Stable error code" diwajibkan (1669, 2520) tapi katalognya tidak ada. Penolakan identity ambigu (1535) tidak punya status code | 1533–1535, 1669 | Katalog error code + `AMBIGUOUS_IDENTITY` → 401 |
| MC-13 | Acceptance "setiap account tetap memenuhi `physical = personal + external`" (2132) tidak dapat diuji: personal adalah turunan (physical − external), jadi identitas itu tautologi | 2132, 795 | Ganti menjadi invariant per-leg: `personal_effect = physical_effect − external_ownership_effect` pada setiap leg, plus rekonsiliasi dua jalur perhitungan |
| MC-14 | Seed `Vape` (681, 1777) dan default source = Jago (1739) keduanya ber-`owner_id` dan merujuk account yang baru ada saat onboarding — tidak bisa jadi seed migration | 681, 1739, 1777 | Pindahkan ke langkah bootstrap owner (kategori) dan konfirmasi onboarding (default source) |

---

### 3.4 IMPLEMENTATION RISK (10)

| ID | Risiko | Bukti | Mitigasi konkret |
|---|---|---|---|
| IR-1 | Tiga invariant agregat tidak dapat ditegakkan dengan `CHECK` biasa: posisi external ≥ 0 (234, 1771), total komponen external ≤ jumlah transfer (872), total allocation ≤ personal component (888) | 234, 872, 888, 1771 | Tabel posisi termaterialisasi per `(holding_id, account_id)` dengan `CHECK (position >= 0)`, di-update `FOR UPDATE` dalam transaksi yang sama. Hindari mengandalkan isolation level |
| IR-2 | Non-overlap settlement (374) dan state period daily income (313) tidak punya mekanisme penegakan | 313, 374, 1800 | `EXCLUDE USING gist (owner_id WITH =, daterange(start_date, end_date, '[]') WITH &&)` (butuh `btree_gist`). Contiguity (tanpa gap) tidak bisa jadi constraint — cek aplikasi + property test |
| IR-3 | Idempotency key disebut satu kali (1667) tanpa transport, scope, TTL, atau perilaku replay | 1667 | Header `Idempotency-Key`; tabel `idempotency_record(owner_id, key, method, path, request_hash, response_status, response_body, created_at)`; replay 24 jam; body berbeda → 409 |
| IR-4 | Export ZIP "dari satu consistent database snapshot, di-stream ke browser" (1658) — satu transaksi panjang di serverless function | 1658, 2102 | Verifikasi batas durasi function Vercel pada tier yang dipakai sebelum mengunci desain. Alternatif: `REPEATABLE READ` + streaming per-dataset dengan satu snapshot LSN |
| IR-5 | Workflow keepalive menempatkan validasi URL/token **setelah** gate 3-hari (workflow:29–45). Pada hari non-gate, salah konfigurasi keluar dengan exit 0. Job juga di-skip diam-diam jika `FINTRACK_KEEPALIVE_ENABLED` tidak `'true'` | workflow:15, 29–45 | Pindahkan validasi env ke atas gate; tambah assertion bulanan yang gagal keras jika variable hilang |
| IR-6 | Fail-closed saat `auth_user_id` NULL (1509) mudah dilanggar oleh policy yang ditulis `auth_user_id IS NOT DISTINCT FROM auth.uid()` — NULL=NULL akan lolos | 1509 | Policy wajib `auth_user_id = auth.uid()` (NULL → NULL → bukan TRUE → deny). Uji eksplisit |
| IR-7 | Kebocoran transaction-local claims pada pooled connection (1555–1556) | 1555–1556, 2226 | `SET LOCAL role` + `set_config(..., true)` saja. Test: setelah commit dan setelah rollback, transaksi baru pada koneksi pool yang sama melihat role default dan tanpa claims |
| IR-8 | Prorata exact-sum (822–828) dan rounding half-up average (1842) rawan off-by-one | 822–828, 1842 | Property test: untuk setiap (living expense, rentang), `sum(allocations) == living expense` persis, semua dalam sen |
| IR-9 | Evaluasi lazy transisi due (312) dan daily income (299) tanpa penjagaan konkurensi dapat membuat state period ganda | 299, 312, 1760 | `UNIQUE (rule_id, effective_date)` pada transition + exclusion pada period + advisory lock per rule saat evaluasi |
| IR-10 | Corrected view DANA menghitung ulang formula penuh dari corrected ledger chain setiap kali dirender (1038–1056) | 1038–1056 | Fungsi murni tunggal `reconstructSettlement(input)` dipakai bersama oleh jalur as-settled dan corrected. Satu implementasi, dua sumber input |

---

## 4. Slice Terkoreksi

13 slice menggantikan 8. Setiap slice punya exit criteria yang dapat diverifikasi otomatis.

| # | Slice | Bergantung | Exit criteria |
|---|---|---|---|
| **S0** | Platform + spike RLS | — | Repo Next.js + TS strict + Drizzle + lint/typecheck/test di CI. **Spike HB-1 lulus**: role `fintrack_app` (bukan pemilik tabel, tanpa BYPASSRLS) terkoneksi lewat pooler, `SET LOCAL role` + claims bekerja, `prepare:false` terverifikasi, tabel dummy dengan RLS menolak akses lintas-owner. `ops_probe` + role `fintrack_probe` ada (HB-2). Database dapat dibangun dari nol dengan satu perintah |
| **S1** | Identity + authorization | S0 | `app_owner` singleton; bootstrap idempoten (UUID sama sukses, UUID beda hard-fail); `requireOwner()`; `withOwnerDb()`; 401/403/503 `APP_NOT_INITIALIZED`; login/logout lokal & global; password recovery generik; penolakan cookie+Bearer ambigu; seluruh 13 acceptance auth (PRD:2077–2091) dan 9 exception auth (PRD:2157–2165) hijau |
| **S2** | Accounts, onboarding, opening, rule bootstrap | S1 | **HB-5 dan MC-11 diselesaikan**. Onboarding draft→confirmed atomik; opening physical + external; superseding opening snapshot; pembuatan daily/monthly/subscription/bank-fee rule, retained floor, default special source, seed kategori `Vape`; boundary opt-in. Fixture PRD:2037 direproduksi persis |
| **S3** | Ledger core | S2 | Tabel `ledger_entry` + `ledger_leg` append-only; konvensi tanda PRD:795; fungsi `calculatedPhysicalBalance(account, as_of, view)` dan `externalOutstanding(...)`; kunci urut MC-1 |
| **S4** | External funds | S3 | Subject/holding/movement; 5 quick action (PRD:650–656); guard posisi ≥ 0 (IR-1); lifecycle OPEN/CLEARED; arsip subject butuh Rp0; MC-8. Fixture 7 langkah PRD:2045–2073 direproduksi persis |
| **S5** | Financial events + open-period correction | S3 | Income/expense/special expense dengan source account aktual; kategori reusable (create/rename/archive/normalisasi); reversal+replacement atomik; reversal-only void. Contoh PRD:1024–1029 direproduksi |
| **S6** | Transfers + targets + allocations | S4, S5 | Ownership composition; logical target + immutable version + allocation many-to-many; auto-allocation oldest-first; surplus ke target actionable terbaru; **algoritma chain HB-4 terdefinisi dan diuji**; MC-6, MC-7 |
| **S7** | Daily income + weekly settlement | S6 | Rule ACTIVE/PAUSED, state period tanpa overlap, satu upcoming transition, sparse override, evaluasi lazy idempoten; settlement DRAFT→SETTLED; snapshot lengkap (MC-2); catch-up contiguous; target DANA dengan pengurangan prior outstanding. **Fixture 4 minggu Feb 2027 direproduksi persis** |
| **S8** | Settled-history correction | S7 | `CORRECTION_POSTING` dengan target type/id, record kind, legs, classification (MC-4); corrected view DANA (satu aggregate contribution, cocok dengan closing otoritatif); reclassification special expense DANA terlambat (PRD:699) |
| **S9** | BCA monthly cycle | S6, S7 | Monthly income occurrence + resolution append-only; recurring expense rule/revision/occurrence + `cycle_key` + last-day fallback; gating kronologis (OD-3); readiness + frozen target basis; tabel precedence 8 baris (PRD:566–575) exhaustive dan mutually exclusive. **Fixture BCA PRD:2006–2016 direproduksi** |
| **S10** | Balance confirmation + reconciliation | S7, S9 | Confirmation physical-only; discrepancy physical-first; `BALANCE_ADJUSTMENT` dengan reason wajib; replacement confirmation; prompt bulanan + fallback MC-9 |
| **S11** | Reporting + metrics | S8, S9, S10 | Seluruh metric PRD:717–740; `CALENDAR_DAY_PRORATA_V1` exact-sum; completeness Sementara/Lengkap/Parsial + deteksi gap/overlap; as-settled vs corrected |
| **S12** | UI | S11 | App shell 4 destination + Pengaturan; dashboard order LOCKED; badge precedence; theme tanpa flash; a11y WCAG 2.2 AA; server-acknowledged mutation |
| **S13** | Portability + operations | S11 | Export ZIP dengan coverage test; manifest PWA; request ID + katalog error code; keepalive aktif setelah probe ada; backup harian terenkripsi ke R2; restore drill lulus |

Perubahan ordering paling penting: **S6 (targets) mendahului S7 dan S9** — keduanya mengonsumsi target, prior plan menduplikasinya. **S8 mengikuti S7**, memperbaiki HB-3.

---

## 5. Peta Schema / Migration Terkoreksi

Rekomendasi arsitektural saya (bukan ketentuan PRD): **satu core append-only `ledger_entry` + `ledger_leg`** menggantikan tabel per-fitur. PRD:773 sudah mengenumerasi seluruh sumber physical effect dan PRD:795 sudah mengunci satu konvensi tanda — jadi satu tabel leg membuat setiap invariant menjadi satu query, dan membuat as-settled/corrected view menjadi satu filter.

| M | Isi | Catatan |
|---|---|---|
| **M0** | `btree_gist`; schema `fintrack`; role `fintrack_app` (NOINHERIT, tanpa BYPASSRLS, bukan pemilik tabel), `fintrack_probe`; grants + default privileges; `ops_probe` (1 row) + policy deny-all kecuali probe role | Menutup HB-1, HB-2 |
| **M1** | `app_owner(id, singleton_key bool CHECK(singleton_key) UNIQUE, auth_user_id uuid UNIQUE NULL, …)`; fungsi `fintrack.current_owner_id()`; template RLS `owner_id = fintrack.current_owner_id()` | Policy memakai `=`, bukan `IS NOT DISTINCT FROM` (IR-6) |
| **M2** | `account` (+ `is_cash_equivalent`, `currency CHECK (currency='IDR')`, `activation_cutover_at`); `special_expense_category` (unique on normalized name); `app_setting` (retained floor, default special source) | MC-5, MC-14, PRD:1834 |
| **M3** | `ledger_entry(id, owner_id, kind, effective_business_date, recorded_at, lifecycle, reverses_id, replaces_id, correction_target_type, correction_target_id, reporting_classification, category_id, …)`; `ledger_leg(entry_id, account_id, physical_effect bigint, external_ownership_effect bigint, holding_id NULL)`; index `(owner_id, account_id, effective_business_date, recorded_at, id)` | `kind` ∈ INCOME, EXPENSE, TRANSFER_LEG, EXTERNAL_MOVEMENT, CORRECTION_POSTING, BALANCE_ADJUSTMENT, SETTLEMENT_LIVING_CONTRIBUTION. Amount = sen (bigint) |
| **M4** | `onboarding_snapshot` (DRAFT/CONFIRMED, `cutover_at`, `supersedes_id`, `superseded_by_id`); `opening_account_position(physical, external per holding)` | Opening bukan financial event (PRD:1761) — tabel terpisah, tetap masuk fungsi saldo |
| **M5** | `external_subject`, `external_holding`, `external_position(holding_id, account_id, position bigint CHECK(position>=0))` termaterialisasi | IR-1; movement disimpan sebagai `ledger_entry` kind EXTERNAL_MOVEMENT |
| **M6** | `transfer`; `transfer_ownership_component`; `transfer_target(owner_id, context_type, context_key, source_account_id, destination_account_id UNIQUE)`; `transfer_target_version(… is_actionable, retirement_reason, supersedes_id, superseded_by_id)` + partial unique `WHERE superseded_by_id IS NULL`; `transfer_allocation(transfer_id, target_id, magnitude bigint CHECK(magnitude>0), sign)` | MC-6, MC-7, HB-4, OD-1 |
| **M7** | `daily_income_rule`; `daily_income_state_transition` UNIQUE `(rule_id, effective_date)`; `daily_income_state_period` + `EXCLUDE … daterange &&` + partial unique `WHERE end_date IS NULL`; `daily_income_override` UNIQUE `(rule_id, business_date)` | IR-2, IR-9, PRD:1801 |
| **M8** | `settlement` (DRAFT/SETTLED, + seluruh field snapshot MC-2) + `EXCLUDE … daterange(start,end,'[]') &&`; `balance_confirmation` (+ `supersedes_id`, `superseded_by_id`) | MC-2, IR-2 |
| **M9** | `monthly_income_rule`; `monthly_income_occurrence` UNIQUE `(rule_id, cycle_key)`; `recurring_expense_rule`; `recurring_expense_rule_revision` UNIQUE `(rule_id, effective_from_cycle)`; `recurring_expense_occurrence` UNIQUE `(rule_id, cycle_key)`; `occurrence_resolution` (polimorfik, `supersedes_id`, `superseded_by_id`, partial unique current) | MC-7, MC-10, PRD:1811 |
| **M10** | `balance_adjustment(balance_confirmation_id NOT NULL, reason NOT NULL)` | PRD:1094, 1088 |
| **M11** | `idempotency_record`; view saldo/coverage; index query-shape | IR-3 |
| **M12** | Registry cakupan export (tabel metadata atau registry kode + test) | Mencegah export tertinggal saat tabel baru ditambah |

Aturan ordering wajib: **M0 sebelum semua** (role harus ada sebelum `GRANT`/`ALTER DEFAULT PRIVILEGES` berguna). Setiap migration menyertakan `ENABLE ROW LEVEL SECURITY` + policy di file yang sama dengan `CREATE TABLE` — tabel tanpa RLS tidak boleh pernah ada di staging walau sesaat.

---

## 6. Peta REST API Versioned

**Konvensi (menutup MC-12, IR-3):**

- Base `/api/v1`. Amount dikirim sebagai string minor-unit desimal (`"831999.93"`), PRD:1832. Date-only `YYYY-MM-DD`, timestamp RFC3339 dengan offset.
- Seluruh `POST`/`PATCH` wajib header `Idempotency-Key` (UUIDv4). Replay ≤24 jam mengembalikan respons tersimpan + `Idempotency-Replayed: true`. Key sama dengan body berbeda → `409 IDEMPOTENCY_KEY_REUSED`.
- Aggregate mutable (onboarding draft, settlement draft, occurrence) memakai `If-Match: <etag>`; mismatch → `409 STALE_VERSION`.
- Endpoint laporan menerima `?view=as_settled|corrected` (default `corrected`), PRD:1033–1036.
- Error selalu JSON: `{ "error": { "code", "message", "details?", "requestId" } }`. Tidak pernah redirect ke HTML (PRD:1534).
- Status: `401` identity hilang/invalid/ambigu, `403` authenticated non-owner, `409` konflik invariant, `422` validasi, `503 APP_NOT_INITIALIZED`.

| Resource | Endpoint | Catatan |
|---|---|---|
| Session | `GET /v1/session` · `POST /v1/session/logout` · `POST /v1/session/logout-all` | PRD:1475 |
| Owner | `GET /v1/owner` | `503` bila belum bootstrap |
| Accounts | `GET/POST /v1/accounts` · `GET/PATCH /v1/accounts/{id}` · `POST /v1/accounts/{id}:archive` | Archive menolak external outstanding ≠ 0 (MC-8) |
| Onboarding | `GET /v1/onboarding` · `PATCH /v1/onboarding` · `POST /v1/onboarding:confirm` · `POST /v1/onboarding:supersede` | Konfirmasi atomik (PRD:266) |
| External subjects | `GET/POST /v1/external-subjects` · `POST /v1/external-subjects/{id}:archive` | |
| External movements | `POST /v1/external-movements` (`type` = RECEIPT · RETURN · OWNER_USE · INTERNAL_TRANSFER · CONVERT_TO_PERSONAL · CONVERT_TO_EXTERNAL) · `POST /v1/external-movements/{id}:correct` | PRD:650–656 |
| Financial events | `GET /v1/events` (paginasi cursor, filter kind/account/date/category) · `POST /v1/events` · `POST /v1/events/{id}:confirm` · `POST /v1/events/{id}:correct` · `DELETE /v1/events/{id}` (DRAFT saja) | PRD:1001 |
| Special expense | `POST /v1/special-expenses` · `GET/POST /v1/categories` · `PATCH /v1/categories/{id}` · `POST /v1/categories/{id}:archive` | `Lainnya…` tidak pernah dipersist (PRD:682) |
| Transfers | `POST /v1/transfers` · `POST /v1/transfers/{id}:confirm` · `POST /v1/transfers/{id}:correct` | Auto-allocation oldest-first di server |
| Transfer targets | `GET /v1/transfer-targets?route=&status=` · `POST /v1/transfer-targets/{id}:recalculate` · `POST /v1/transfer-targets/{id}:retire` | `:retire` = **OD-1**, hanya jika diputuskan |
| Daily income | `GET/PATCH /v1/daily-income-rules/{id}` · `POST /v1/daily-income-rules/{id}/transitions` · `DELETE /v1/daily-income-rules/{id}/transitions/{tid}` · `PUT/DELETE /v1/daily-income-rules/{id}/overrides/{date}` | Transisi due tidak dapat dibatalkan (PRD:310) |
| Settlements | `GET /v1/settlements` · `GET /v1/settlements/next` (router: normal/draft/catch-up/informational, PRD:1213–1218) · `POST /v1/settlements` · `PATCH /v1/settlements/{id}` · `POST /v1/settlements/{id}:settle` | |
| Monthly cycles | `GET /v1/monthly-cycles?account=&cycle=` (state turunan) · `POST /v1/monthly-income-occurrences/{id}/resolutions` · `POST /v1/recurring-expense-occurrences/{id}/resolutions` | Resolution append-only + `supersedes_id` |
| Recurring rules | `GET/POST /v1/recurring-expense-rules` · `POST /v1/recurring-expense-rules/{id}/revisions` | Revisi prospektif saja (PRD:476) |
| Balance | `POST /v1/balance-confirmations` · `POST /v1/balance-confirmations/{id}:supersede` · `POST /v1/balance-adjustments` | DANA ditolak → arahkan ke settlement router (PRD:1220) |
| Reports | `GET /v1/reports/dashboard` · `GET /v1/reports/months/{YYYY-MM}?view=` · `GET /v1/reports/settlements/{id}?view=` | Menyertakan status completeness + gap/overlap error |
| Settings | `GET/PATCH /v1/settings` (retained floor, default special source, theme) | |
| Export | `POST /v1/export` → `200 application/zip`, `Cache-Control: no-store` | Error sebelum stream = JSON; gagal di tengah stream = abort koneksi, tanpa trailer sukses |
| Internal | `POST /api/internal/keepalive` → `204` | Di luar `/v1`, secret terpisah, production-only (PRD:1626) |

Endpoint yang **sengaja tidak ada**: signup, claim-owner, bootstrap publik, ad-hoc DANA balance confirmation (PRD:1220, 1488).

---

## 7. Rencana Implementasi Auth / Authz

**Lapisan (PRD:1515–1560):**

1. Konfigurasi Supabase: matikan public signup, anonymous sign-in, dan seluruh provider tak terpakai. Custom SMTP wajib sebelum invite/recovery disebut production-ready (PRD:1573).
2. Bootstrap out-of-band: undangan lewat Dashboard, lalu satu perintah admin terpercaya mengikat Auth UUID ke `app_owner`. Idempoten via `INSERT … ON CONFLICT (singleton_key) DO NOTHING` lalu bandingkan `auth_user_id`; UUID berbeda → hard fail. Dua proses paralel tidak dapat menghasilkan owner kedua (PRD:2160).
3. `requireOwner()` tunggal di setiap Route Handler, Server Action, page data load, dan use case. `proxy.ts` **hanya** refresh cookie + optimistic redirect (PRD:1531).
4. `withOwnerDb()`: buka transaksi → `SET LOCAL ROLE fintrack_app` → `set_config('request.jwt.claims', <verified>, true)` → `requireOwner(tx)` → use case dengan handle transaksi yang sama. Tidak ada plain privileged client yang diekspor ke feature module (PRD:1553).
5. RLS sebagai defense in depth; query aplikasi **tetap** memakai predikat `owner_id` eksplisit (PRD:1559).
6. Tiga credential terpisah: migration/admin (hanya release runner), `fintrack_app` (runtime), `fintrack_probe` (keepalive, read-only `ops_probe`).
7. Recovery: rebind privileged ke Auth user pengganti tanpa mengubah `app_owner.id` atau data finansial (PRD:1510). Perlu **runbook tertulis** — artefak yang tidak ada di prior plan.

**Jebakan yang wajib diuji:**

- Policy ditulis `auth_user_id = auth.uid()`. Bentuk `IS NOT DISTINCT FROM` akan meloloskan NULL=NULL saat binding hilang (IR-6).
- Setelah commit **dan** setelah rollback, transaksi baru pada koneksi pool yang sama harus melihat role default tanpa claims (IR-7).
- Cookie + Bearer dengan identity berbeda → `401 AMBIGUOUS_IDENTITY` (PRD:1535; status code adalah rekomendasi saya).
- `fintrack_app` diuji langsung lewat psql: `SELECT` lintas-owner harus mengembalikan 0 row, bukan error — membuktikan RLS, bukan grant.

---

## 8. Matriks Acceptance Test

PRD:2107–2216 sudah memuat 43 skenario utama + 44 jalur pengecualian. Kualitasnya tinggi. Yang berikut **hilang** dan wajib ditambahkan.

| # | Test baru | Slice | Alasan |
|---|---|---|---|
| T-01 | Setelah SETTLED, badge DANA = `Dikonfirmasi`, bukan `Ada selisih` | S7 | Kontribusi living expense harus di-post atomik agar calculated == confirmed pada timestamp yang sama (PRD:950 vs 773) |
| T-02 | Transfer dieksekusi dan dicatat **sebelum** settlement, dalam rentang yang sama → living expense benar | S7 | Formula self-correcting secara matematis, tapi tidak pernah diuji |
| T-03 | Transfer dalam rentang settled yang baru dicatat kemudian → corrected living turun tepat sebesar transfer, as-settled tidak berubah | S8 | |
| T-04 | Koreksi closing confirmation minggu N → living minggu N+1 berubah berlawanan arah; minggu N+2 tidak berubah | S8 | Cascade satu hop; belum pernah dinyatakan |
| T-05 | Chain recalculation target: koreksi target minggu 1 dari rangkaian 8 minggu menghasilkan superseding version kronologis, atomik, tanpa mengubah allocation | S6 | HB-4 |
| T-06 | Target DANA yang tak terpenuhi + saldo habis → target berikutnya Rp0 dan liquidity warning; setelah `:retire`, target normal kembali | S6 | OD-1 |
| T-07 | Cycle BCA mencapai ready dengan floor belum diset | S9 | OD-2 |
| T-08 | Subscription bersumber DANA di dalam rentang settlement → terdeduksi sebagai non-living | S7 | OD-5, MC-3 |
| T-09 | Living expense negatif | S7 | OD-6 |
| T-10 | Dua konfirmasi settlement bersamaan untuk periode yang sama → tepat satu berhasil | S7 | Konkurensi |
| T-11 | Dua resolution bersamaan untuk occurrence yang sama → tepat satu current | S9 | MC-7 |
| T-12 | Dua konfirmasi transfer bersamaan → total allocation tidak melampaui personal component | S6 | IR-1 |
| T-13 | Return external bersamaan → posisi holding tidak pernah negatif | S4 | IR-1 |
| T-14 | POST duplikat dengan `Idempotency-Key` sama → satu record, respons identik, header replay | S1+ | IR-3 |
| T-15 | Settlement catch-up melintasi 3 bulan kalender → prorata exact-sum untuk ketiganya | S11 | PRD:826 punya aturannya, tidak punya test |
| T-16 | Expected day 29 pada Februari **kabisat** (2028) → 29 Feb, bukan 28 | S9 | PRD:2150 hanya menguji 31/Feb non-kabisat |
| T-17 | Server berjalan UTC → seluruh business date tidak bergeser | S3 | PRD:1855 mengatur, tidak menguji |
| T-18 | Arsip account yang masih memegang external outstanding → ditolak | S4 | MC-8 |
| T-19 | Recurring rule baru dengan start cycle di masa lalu | S9 | OD-3 |
| T-20 | `last_expected_cycle` terlampaui → prompt reconciliation Jago tetap muncul | S10 | MC-9 |
| T-21 | Export coverage: setiap tabel domain muncul di manifest; tabel baru tanpa registrasi membuat test gagal | S13 | Mencegah export membusuk diam-diam |
| T-22 | Restore drill: DB hasil restore menolak `fintrack_app` membaca lintas-owner | S13 | PRD:2101 menyebut "RLS bekerja" tanpa assertion |
| T-23 | Onboarding: cutover di tengah minggu **dan** tengah bulan → settlement pertama partial + bulan pertama `Periode parsial` | S7 | Kasus majemuk |
| T-24 | Amount 3 digit desimal, non-numerik, dan melewati batas bigint → ditolak | S3 | PRD:2305 hanya mencakup kasus pertama |
| T-25 | Koreksi override daily income setelah settlement → target koreksi resmi, calculated DANA tetap cocok closing | S8 | MC-4 |

**Fixture wajib dijadikan golden test, bukan sekadar contoh:** PRD:1989–1998 (4 minggu), PRD:2006–2016 (BCA), PRD:2021–2024 (rekonsiliasi), PRD:2037–2073 (external 7 langkah), PRD:828 (prorata). Kelima-limanya sudah saya verifikasi aritmetis dan langsung dapat dieksekusi.

---

## 9. Environment Verification Gates

**Local (L) — sebelum commit apa pun bisa di-push:**
L1 `pnpm lint && typecheck && test` hijau · L2 DB dibangun dari nol lewat committed migration, termasuk role dan RLS · L3 seed sintetis terpasang · L4 `fintrack_app` tidak bisa membaca lintas-owner lewat psql langsung · L5 tidak ada `drizzle-kit push` di skrip manapun (PRD:1613).

**Staging (S) — sebelum promote:**
S1 project Supabase terpisah, tanpa credential production (PRD:1604) · S2 migration jalan lewat trusted release runner, bukan saat build/startup/request (PRD:1614) · S3 smoke check: login, onboarding draft, satu settlement, satu transfer, satu koreksi · S4 Preview dilindungi Vercel Authentication · S5 seluruh golden fixture lulus terhadap DB staging · S6 assertion kebocoran claims (IR-7).

**Production (P) — sebelum production pertama dibuka:**
P1 public signup, anonymous sign-in, provider tak terpakai — dimatikan dan diverifikasi · P2 custom SMTP terpasang; invite dan password reset benar-benar terkirim (PRD:1573) · P3 owner ter-bootstrap; bootstrap ulang UUID sama idempoten, UUID beda hard-fail · P4 backup terenkripsi ke R2 sukses, manifest+checksum benar, failure notification terbukti menyala · P5 **restore drill lulus di environment terisolasi** — RTO/RPO baru tervalidasi setelah ini (PRD:1645–1646) · P6 kunci dekripsi tersimpan di password manager + satu salinan offline · P7 pre-release backup otomatis sebelum migration production · P8 `ops_probe` + `fintrack_probe` ada; `workflow_dispatch` manual membuktikan 204 sebelum jadwal diandalkan (PRD:1633) · P9 `FINTRACK_KEEPALIVE_URL` dan `FINTRACK_KEEPALIVE_TOKEN` terpasang; validasi env dipindah ke atas gate 3-hari (IR-5) · P10 log tidak memuat cookie, token, connection string, nominal, atau deskripsi transaksi (PRD:1670) · P11 export penuh diunduh dan diinspeksi manual: tanpa password/token/Auth UUID (PRD:1659) · P12 region Supabase `ap-southeast-1` dan Vercel `sin1` terkonfirmasi · P13 MFA aktif pada Vercel, Supabase, GitHub, email recovery, dan penyimpanan backup (PRD:1607).

**Gate yang belum dapat diverifikasi sekarang dan harus dibuktikan saat setup:** batas durasi Vercel function untuk export satu-snapshot (IR-4), dan dukungan Supavisor untuk role kustom (HB-1).

---

## 10. Urutan Commit yang Aman dan Dapat Direview

Satu PR per slice. Di dalam PR, commit dipecah agar tiap commit dapat direview terpisah dan build tetap hijau.

```
S0  chore: scaffold Next.js App Router with TypeScript strict
    chore: add lint, typecheck, and test pipeline
    feat(db): add Drizzle setup and migration runner script
    feat(db): M0 roles, grants, schema, and ops_probe relation
    test(db): prove fintrack_app has no BYPASSRLS and is not table owner
    test(db): prove SET LOCAL role and JWT claims work through the pooler

S1  feat(db): M1 app_owner singleton with RLS scaffolding
    feat(auth): add requireOwner and AuthPrincipal normalisation
    feat(auth): add withOwnerDb RLS-aware transaction wrapper
    feat(auth): add bootstrap command with idempotent owner binding
    feat(api): add session routes and auth error contract
    test(auth): cover the 13 private-authentication acceptance scenarios
    test(auth): cover the 9 authentication exception paths
    docs(ops): add privileged owner-rebind recovery runbook

S2  feat(db): M2 accounts, categories, and settings
    feat(db): M4 onboarding snapshot and opening positions
    feat(onboarding): add draft lifecycle and atomic confirmation
    feat(onboarding): add rule and setting bootstrap step
    test(onboarding): reproduce the locked onboarding fixture
```

Pola sama untuk S3–S13. Aturan tetap:

- Migration dan RLS policy untuk tabel yang sama berada dalam satu commit. Tabel tanpa RLS tidak boleh pernah ter-commit.
- Golden fixture masuk pada slice yang memperkenalkannya, tidak ditumpuk di akhir.
- Registrasi export ditambahkan pada slice yang membuat tabelnya (T-21), tidak di S13.
- Tidak ada force-push. Perubahan destruktif mengikuti expand → backfill → contract dalam rilis terpisah (PRD:1616).

---

## 11. Definisi Tepat "Siap Mulai Implementasi"

Prior plan memakai definisi implisit "tidak ada blocker". Definisi berikut lebih ketat dan dapat dicentang.

**Siap mulai implementasi Slice 0** — terpenuhi **sekarang**:
- PRD v0.15 adalah source of truth tunggal; tidak ada asumsi dari repository lama.
- Baseline teknis LOCKED dan tidak ambigu (PRD:1392–1407).
- Repository ada, bersih, satu commit.

**Siap keluar dari Slice 0 dan masuk Slice 1** — membutuhkan:
- [ ] HB-1 terbukti empiris (role, pooler, `SET LOCAL`, `prepare:false`).
- [ ] HB-2 terselesaikan (`ops_probe` + role probe ada di M0).
- [ ] Pipeline lint/typecheck/test hijau; DB terbangun dari nol lewat committed migration.

**Siap masuk Slice 2** — membutuhkan:
- [ ] HB-5 dijawab: di mana setiap rule dan setting awal dibuat.
- [ ] MC-11 dijawab: flow onboarding memuat boundary opt-in.
- [ ] OD-2 dijawab: perilaku floor kosong.
- [ ] MC-14 dijawab: titik seed kategori dan default source.

**Siap masuk Slice 6** — membutuhkan:
- [ ] HB-4 dijawab: algoritma chain, lingkup, urutan, batas.
- [ ] OD-1 dijawab: ada atau tidak aksi retire target.
- [ ] MC-6, MC-7 dijawab: context key dan penegakan uniqueness.

**Siap masuk Slice 7** — membutuhkan:
- [ ] MC-1, MC-2, MC-3, MC-4 dijawab.
- [ ] OD-5, OD-6 dijawab.

**Siap masuk Slice 13 / production** — seluruh gate P1–P13 lulus, termasuk restore drill.

Inti definisinya: **setiap slice boleh dimulai hanya ketika seluruh temuan yang tercantum pada baris dependensinya sudah berupa keputusan tertulis di PRD, bukan asumsi implementer.** Enam belas dari dua puluh lima item tersebut membutuhkan kalimat, bukan kode — kemungkinan besar satu sesi.

---

## 12. Delta terhadap Prior Plan

**RETAIN**
- Baseline teknis dan seluruh keputusan LOCKED. Tidak ada kontradiksi yang membenarkan pembukaan ulang.
- REST `/api/v1`, Supabase Auth, `requireOwner()` terpusat, RLS-aware Drizzle transaction, idempotency.
- Pemisahan gate local/staging/production; export, backup, restore, observability sebagai kewajiban rilis.
- Arah umum slice: foundation → identity → accounts → ledger → routines → UI → operations.
- Slice 0, 1, dan 2 dari prior plan pada dasarnya benar.

**CHANGE**
- **Urutan**: transfer targets (S6) dipindah **sebelum** DANA dan BCA — prior plan menduplikasinya di slice 4 dan 5.
- **Urutan**: settled-history correction (S8) dipindah **setelah** settlement — prior plan menempatkannya di slice 3, di mana `CORRECTION_POSTING` belum punya definisi (HB-3).
- **Granularitas**: 8 slice → 13 slice; slice 3 prior plan ("events/transfers/corrections/reconciliation") terlalu besar untuk direview sebagai satu unit.
- **Migration map**: M1–M5 prior plan → M0–M12, dengan M0 platform/role/probe sebagai prasyarat baru yang mutlak.
- **Arsitektur data**: tabel per-fitur → core `ledger_entry` + `ledger_leg` tunggal. *Ini rekomendasi saya, bukan ketentuan PRD.*
- **Klaim "no new product decisions required"**: salah. Enam keputusan pemilik terbuka (OD-1…OD-6).
- **Keepalive**: dari "sekadar production gate" menjadi keputusan cadence eksplisit dengan bukti dokumentasi Supabase.

**ADD**
- Spike HB-1 sebagai exit criteria Slice 0 yang memblokir.
- `ops_probe` + role ketiga (HB-2).
- Algoritma chain recalculation target (HB-4).
- Titik pembuatan rule dan setting awal (HB-5).
- 25 acceptance test baru (§8), terutama konkurensi, cascade, timezone, kabisat, dan coverage export.
- Kebijakan locking/isolation untuk tiga invariant agregat (IR-1).
- Constraint `EXCLUDE USING gist` untuk non-overlap settlement dan state period (IR-2).
- Kontrak idempotency dan katalog error code (IR-3, MC-12).
- Runbook recovery rebind owner sebagai artefak yang dapat direview.
- Coverage test export yang gagal ketika tabel baru belum terdaftar.

**REMOVE**
- "Migrations M1 identity/security; M2 account; M3 ledger; M4 DANA; M5 BCA; then views/indexes/ops as needed" — frasa "as needed" tidak actionable; index harus diturunkan dari bentuk query konkret (saldo-as-of, coverage, outstanding target).
- Asumsi bahwa nilai onboarding dan secret dapat sepenuhnya ditunda ke production gate: `retained_balance_floor` dan titik pembuatan rule adalah keputusan model, bukan data (OD-2, HB-5).
- Penggabungan corrections dengan events di satu slice.

---

## 13. Pemisahan Fakta PRD / Rekomendasi Saya / Ketidakpastian

**Fakta PRD** (dikutip dengan nomor baris): seluruh isi §3 kolom bukti, konvensi tanda, taksonomi koreksi, tabel precedence, daftar entity, kebijakan uang, aturan waktu, seluruh acceptance yang ada.

**Rekomendasi saya, bukan PRD**: core `ledger_entry`/`ledger_leg`; pemecahan 13 slice; peta endpoint REST lengkap; skema idempotency; `EXCLUDE USING gist`; kolom `superseded_by_id`; `is_cash_equivalent`; `AMBIGUOUS_IDENTITY` → 401; kunci urut `(business_date, recorded_at, id)`; cadence keepalive harian; 25 test tambahan.

**Ketidakpastian yang saya tandai dan tidak saya klaim sudah terjawab**:
- Apakah Supavisor transaction pooler menerima role kustom `fintrack_app.<project-ref>` — belum saya uji, hanya inferensi dari format connection string di dokumentasi Supabase.
- Apakah role `postgres` bawaan Supabase punya `BYPASSRLS` — **tidak saya verifikasi**; saya sengaja tidak mengklaimnya, dan memformulasikan HB-1 sebagai spike, bukan sebagai kegagalan yang pasti.
- Batas durasi Vercel function pada tier yang dipakai untuk export satu-snapshot — belum saya periksa; masuk gate, bukan temuan.
- Estimasi effort per slice — tidak saya berikan; tidak ada kode sebagai basis.

**Koreksi terhadap penilaian awal saya sendiri, setelah review kedua:**
- Saya awalnya menilai cascade koreksi settlement sebagai unbounded dan hard blocker. Setelah menelusuri PRD:1038 dan sifat anchor closing confirmation, cascade living expense terbatas satu hop dan terdefinisi baik. Blocker yang tersisa hanya pada transfer target (HB-4), yang memang unbounded.
- Saya awalnya menilai badge `Ada selisih` pada DANA sebagai kontradiksi PRD. Setelah memeriksa PRD:773 ("tepat satu aggregate living-expense contribution per settlement"), calculated == confirmed secara konstruksi. Diturunkan menjadi implementation risk + test T-01.
- Saya awalnya menilai flow onboarding sebagai hard blocker penuh. Bagian opt-in hanyalah kelalaian mekanis (MC-11); yang benar-benar blocker adalah titik pembuatan rule (HB-5). Dipisahkan.
