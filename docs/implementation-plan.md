# FinTrack Implementation Plan

_Rencana teknis turunan dari `PRD.md` v0.18 dan `docs/audit/2026-09-30-readiness.md`. PRD tetap menjadi source of truth untuk perilaku produk; dokumen ini mengatur urutan kerja, bentuk data, dan cara verifikasi._

| Metadata | Nilai |
| --- | --- |
| **Dibuat** | 30 September 2026 |
| **Basis** | PRD v0.18, audit readiness 30 September 2026 |
| **Slice aktif** | S0–S14 selesai; production aktif sejak 30 September 2026 (tanpa backup R2 dan custom SMTP atas keputusan pemilik) |

## 1. Status ringkas

| Area | Status |
| --- | --- |
| Scaffold Next.js 16 + TypeScript strict + Tailwind 4 | Selesai |
| Drizzle + migration runner + provisioning role | Selesai |
| Role `fintrack_app`, `fintrack_probe`, `fintrack_backup` + schema `fintrack`/`ops` | Selesai (lokal) |
| `app_owner` singleton + RLS + `withOwnerDb()` / `requireOwner()` | Selesai (lokal) |
| Internal keepalive route + probe relation | Selesai (belum di-deploy) |
| CI: lint, typecheck, unit test, build, database test | Hijau di GitHub Actions |
| Spike pada Supabase hosted (pooler `fintrack_app.<project-ref>`) | Lulus pada staging `ap-southeast-1` (39/39 integration test) |
| S1: bootstrap owner idempoten + recovery `--rebind` | Selesai (lokal) |
| S1: adapter cookie dan Bearer → principal yang sama; penolakan identity ambigu | Selesai (lokal) |
| S1: `/api/v1/session`, logout lokal/global, kontrak error JSON | Selesai (lokal) |
| S1: `/login`, `/forgot-password`, `/auth/callback`, `/reset-password`, `proxy.ts` | Selesai (lokal); login form belum diuji otomatis di browser |
| S1: runbook bootstrap dan recovery | `docs/runbooks/owner-bootstrap-and-recovery.md` |
| S2: utilitas uang IDR persis dan kalender Asia/Jakarta | Selesai |
| S2: schema account, kategori, setting, dana titipan, onboarding, posisi awal, definisi rule | Selesai (migration `0002`, RLS di file yang sama) |
| S2: `/api/v1/onboarding` (GET, PUT draft dengan `If-Match`, POST confirm atomik) | Selesai; fixture onboarding direproduksi, konfirmasi paralel dan rollback diuji |
| S2: UI onboarding 5 layar (mobile-first) + test end-to-end Playwright | Selesai |
| Koreksi saldo awal melalui superseding opening snapshot | Selesai (API di S3, UI `/akun/saldo-awal` di S12) |
| S3: ledger append-only `ledger_entry` + `ledger_leg` (physical/external effect terpisah) | Selesai (migration `0003`, `0004`) |
| S3: `postLedgerEntry()` dengan invariant per jenis, batas cutover, pertanyaan hari cutover, dana titipan tidak negatif sepanjang riwayat | Selesai; fixture dana titipan 7 langkah direproduksi |
| S3: `GET /api/v1/accounts` (saldo calculated, status freshness, `Personal cash tercatat`) | Selesai |
| S4: dana titipan (terima, kembalikan, bayar kebutuhan pemilik, pindah, konversi dua arah, arsip) | Selesai; fixture 7 langkah direproduksi |
| S5: pengeluaran khusus + kategori, income/expense lain, `Koreksi` (reversal + replacement, reversal-only void) | Selesai |
| S6: transfer dengan komponen dana titipan, target + versi immutable, alokasi oldest-first, surplus, `Tutup target`, recalculation chain | Selesai (migration `0007`) |
| S7: income harian (pause/resume, override, lazy evaluation) + settlement mingguan (draft, catch-up, snapshot, living expense negatif + warning) | Selesai (migration `0008`); fixture empat minggu Rp930.000 direproduksi |
| S8: koreksi riwayat yang sudah disettle (`CORRECTION_POSTING`, resync per batas closing, as-settled vs corrected) | Selesai |
| S9: siklus BCA bulanan (occurrence lazy, resolution append-only, revision prospektif, gating kronologis, target dibekukan saat siap) | Selesai (migration `0009`, `0010`); fixture BCA Rp335.000 direproduksi |
| S10: konfirmasi saldo physical-first, `BALANCE_ADJUSTMENT`, replacement, prompt bulanan, badge precedence | Selesai |
| S11: laporan bulanan kalender, `CALENDAR_DAY_PRORATA_V1`, completeness, dashboard, riwayat settlement | Selesai; fixture satu bulan penuh (Februari 2021) direproduksi |
| S12: UI Beranda, Rutinitas, Aktivitas, Akun, Catat, Pengaturan; tema terang/gelap/sistem; mutation menunggu server | Selesai; test end-to-end mencatat, mengoreksi, dan merender setiap halaman |
| S13: export ZIP (JSON + CSV + manifest, snapshot `REPEATABLE READ`), registry cakupan export | Selesai; test registry gagal bila tabel baru belum diklasifikasikan |
| S13: manifest PWA + ikon (termasuk maskable), tanpa service worker | Selesai |
| S13: backup harian terenkripsi (`age`) ke R2 + restore drill otomatis setiap run dan di CI | Selesai di kode (migration `0011`); aktif setelah pemilik mengisi secret |
| S14: uang tunai (`Tunai`, account `CASH`) di-settle bersama DANA dalam satu settlement pool; aktivasi dari settlement, hitung dompet tiap settlement, koreksi dan freshness pool | Selesai (migration `0012`); test integrasi pool + e2e UI settlement |
| Staging hosted | Migration `0000`–`0011` diterapkan; suite database 120/120 lulus terhadap staging; bundle backup lewat session pooler + restore drill lulus |

## 2. Hasil spike S0 (lokal, Supabase CLI 2.118.0, PostgreSQL 17.6, Supavisor 2.9.13)

Terbukti oleh `tests/db/platform.integration.test.ts`:

- Role custom `fintrack_app` dapat login melalui Supavisor transaction pooler dengan username `fintrack_app.<tenant>`
- `set_config('request.jwt.claims', …, true)` bekerja di dalam transaction melalui pooler dengan `prepare: false`
- Claims tidak bocor ke transaction berikutnya setelah commit maupun rollback, baik lewat pooler maupun koneksi langsung
- Setelah transaction-local setting berakhir, `current_setting` mengembalikan string kosong, bukan NULL; fungsi `fintrack.request_auth_user_id()` menanganinya secara eksplisit
- Supabase user valid yang bukan owner mendapat `NOT_OWNER` (403) dan tidak melihat row apa pun
- Binding kosong menghasilkan `APP_NOT_INITIALIZED` (503); policy memakai `=` sehingga NULL tidak pernah cocok (audit IR-6)
- Menghapus Auth user mengosongkan binding melalui `ON DELETE SET NULL` tanpa menghapus `app_owner`
- `anon` dan `authenticated` tidak memiliki akses ke schema `fintrack` maupun `ops`
- `fintrack_probe` hanya dapat membaca `ops.keepalive_probe`
- Role `postgres` bawaan Supabase memiliki `BYPASSRLS`, sehingga runtime memang wajib memakai role terpisah
- `postgres` dapat membuat role `fintrack_backup` dengan `BYPASSRLS`; backup role dapat membaca seluruh row tetapi tidak dapat menulis
- Database dapat dibangun dari nol (`supabase db reset` → `pnpm db:migrate`) dan migration idempotent

Temuan tambahan S1 (lokal):

- Menonaktifkan provider Email untuk memblokir signup juga memblokir login email/password. Signup publik diblokir melalui setting global "Allow new users to sign up", sedangkan provider Email tetap aktif
- Link undangan dan recovery memakai `token_hash` yang diverifikasi server di `/auth/callback`; alur email → callback → cookie session → owner berhasil diuji melalui Mailpit dan dev server
- Script yang dijalankan langsung oleh Node (type stripping) tidak boleh memakai syntax TypeScript non-erasable; `erasableSyntaxOnly` diaktifkan agar typecheck menangkapnya

Hasil pada Supabase hosted staging (30 September 2026, PostgreSQL 17.6, region `ap-southeast-1`):

- Seluruh 39 integration test lulus melalui `aws-0-ap-southeast-1.pooler.supabase.com`: transaction mode (port 6543) untuk runtime dan session mode (port 5432) untuk admin serta test koneksi langsung
- Username pooler hosted berformat `<role>.<project-ref>`, dan role custom diterima pooler
- `postgres` dapat membuat role `fintrack_backup` dengan `BYPASSRLS`
- Data API menolak schema `fintrack` dan `ops` (`PGRST106`)
- Konfigurasi Auth staging sesuai runbook: signup publik mati, provider email aktif, anonymous mati, konfirmasi email aktif
- Host database langsung `db.<project-ref>.supabase.co` hanya memiliki alamat IPv6; seluruh akses dari mesin tanpa IPv6 memakai pooler

Menjalankan suite terhadap staging: isi `.env.staging.local` (gitignored), lalu `FINTRACK_ENV=staging pnpm vitest run --project db`.

## 3. Struktur kode

```text
src/app/                  Route Handlers dan halaman (tipis; tanpa business logic)
src/server/db/            Koneksi runtime, schema Drizzle, withOwnerDb()
src/server/auth/          (S1) adapter cookie/Bearer → VerifiedClaims
src/server/domain/        (S3+) logika domain TypeScript murni tanpa Next.js/DB
src/server/application/   (S2+) use case yang menggabungkan domain dan repository
src/server/ops/           Keepalive dan utilitas operasional
drizzle/                  Migration yang di-commit (generated + custom SQL)
scripts/                  Migration runner dan provisioning role
tests/                    Integration test yang membutuhkan Supabase lokal
```

Aturan: domain function menerima dan mengembalikan nilai murni; repository hanya menerima `OwnerTx`; Route Handler hanya melakukan parsing, memanggil use case, dan memetakan error ke kontrak API.

## 4. Konvensi data

| Topik | Keputusan teknis | Asal |
| --- | --- | --- |
| Uang | `bigint` minor unit (sen) di database; string desimal di API; tidak ada `number` untuk uang | PRD Representasi uang |
| Ledger | Satu inti append-only `ledger_entry` + `ledger_leg`; `personal_effect = physical_effect − external_effect`; runtime hanya `SELECT`/`INSERT`; penulisan diserialkan dengan advisory lock per owner | Keputusan teknis S3 |
| Waktu pencatatan | `recorded_at` berpresisi milidetik agar round-trip DB↔JavaScript persis; saldo terkini tidak membandingkan jam aplikasi dengan jam database | Temuan S3 di staging |
| Urutan ledger | `(effective_business_date, recorded_at, id)` | PRD Time rules, audit MC-1 |
| Supersession | Setiap tabel dengan `supersedes_id` juga menyimpan `superseded_by_id` dan partial unique index `WHERE superseded_by_id IS NULL` pada kunci logisnya; keduanya ditulis dalam transaction yang sama | Audit MC-7 |
| Transfer target | `transfer_target(owner_id, context_type, context_key, source_account_id, destination_account_id)` unik; `context_key` = settlement id atau `YYYY-MM` | Audit MC-6 |
| Cycle | `cycle_key` `YYYY-MM` pada kedua jenis occurrence; monthly cycle adalah grouping turunan | PRD Time rules, audit MC-10 |
| Non-overlap | `EXCLUDE USING gist (owner_id WITH =, daterange(start_date, end_date, '[]') WITH &&)` untuk settlement dan daily-income state period; contiguity dicek di application layer + property test | Audit IR-2 |
| Invariant agregat | Tabel posisi external termaterialisasi per `(holding_id, account_id)` dengan `CHECK (position >= 0)` dan `SELECT … FOR UPDATE`; total komponen transfer dan total allocation dicek dalam transaction yang sama | Audit IR-1 |
| Idempotency | Header `Idempotency-Key` wajib pada POST/PATCH; tabel `idempotency_record(owner_id, key, method, path, request_hash, response_status, response_body, created_at)`; replay 24 jam; key sama dengan body berbeda → `409 IDEMPOTENCY_KEY_REUSED` | Audit IR-3 |
| Konkurensi lazy evaluation | `UNIQUE (rule_id, effective_date)` pada transition dan advisory lock per rule saat evaluasi | Audit IR-9 |
| Rekonstruksi settlement | Satu fungsi murni `reconstructSettlement(input)` dipakai oleh as-settled dan corrected view | Audit IR-10 |

Rekomendasi arsitektur (belum dikunci PRD): satu inti append-only `ledger_entry` + `ledger_leg` dengan kolom `physical_effect`, `external_ownership_effect`, dan `personal_effect` turunan. Keputusan final diambil pada awal S3 setelah S2 selesai.

## 5. Peta migration

| Migration | Isi | Slice |
| --- | --- | --- |
| `0000_platform_roles` | `btree_gist`, role `fintrack_app`/`fintrack_probe`/`fintrack_backup` (NOLOGIN) | S0 |
| `0001_platform_schema` | Schema `fintrack`/`ops`, `app_owner`, fungsi owner, RLS, `ops.keepalive_probe` | S0 |
| `0002_onboarding_schema` | Account, kategori, setting, dana titipan, onboarding snapshot, posisi awal, definisi rule | S2 |
| `0003_ledger_core` | `ledger_entry`, `ledger_leg`, index urutan kanonik, FK supersede deferrable | S3 |
| `0004_ledger_recorded_at_precision` | `recorded_at` presisi milidetik | S3 |
| `0005_ledger_classification` | Klasifikasi ledger (event class, correction role, source) | S3–S5 |
| `0006_idempotency` | `idempotency_record` | S5 |
| `0007_transfers` | `transfer_target`, `transfer_target_version`, `transfer_allocation`, reserve account | S6 |
| `0008_daily_income_and_settlement` | Transition, override, `balance_confirmation`, `settlement` (EXCLUDE gist, trigger immutable) | S7 |
| `0009_monthly_cycles` | Occurrence income/kewajiban, `occurrence_resolution` | S9 |
| `0010_revision_supersession_deferrable` | FK supersede revision deferrable | S9 |
| `0011_backup_journal_grant` | `fintrack_backup` dapat membaca journal migration untuk bundle backup | S13 |
| `0012_tunai_settlement_pool` | `account_type` `CASH`, `account.settlement_account_id`, `account_activation_position`, kolom tunai pada `settlement` | S14 |

Registry cakupan export (M12) berada di `src/server/application/export.ts`, bukan migration.

## 6. Slice

| # | Slice | Bergantung | Exit criteria | Diblokir oleh |
| --- | --- | --- | --- | --- |
| S0 | Platform + security spike | — | Lint/typecheck/test/build hijau di CI; DB dibangun dari nol; spike lokal lulus; spike hosted lulus | — (spike hosted lulus) |
| S1 | Identity + authorization | S0 | Bootstrap idempoten; adapter cookie dan Bearer → `VerifiedClaims`; login/logout lokal dan global; recovery generik; 13 skenario auth + jalur pengecualian auth hijau; runbook rebind | — |
| S2 | Accounts, onboarding, konfigurasi awal | S1 | Draft → confirmed atomik; opening + external; rule dan setting awal; seed `Vape`; fixture onboarding PRD direproduksi | — |
| S3 | Ledger core | S2 | Konvensi tanda PRD; saldo calculated as-of; urutan kanonik; aturan inklusi date-only terhadap timestamp; superseding opening snapshot | — |
| S4 | External funds | S3 | Lima quick action; posisi ≥ 0; syarat arsip; fixture 7 langkah direproduksi | — |
| S5 | Financial events + koreksi periode terbuka | S3 | Special expense + kategori; reversal/replacement; reversal-only void; `Catat income/expense lain` | — |
| S6 | Transfer + target + allocation | S4, S5 | Ownership composition; allocation oldest-first; surplus; `Tutup target`; recalculation chain | — |
| S7 | Daily income + weekly settlement | S6 | Pause/resume, override, lazy evaluation; snapshot lengkap; catch-up; living expense negatif + warning; fixture Februari 2027 | — |
| S8 | Koreksi settled history | S7 | `CORRECTION_POSTING`; corrected view DANA; koreksi override setelah settlement | — |
| S9 | BCA monthly cycle | S6, S7 | Occurrence + resolution; revision; gating kronologis; obligation-only cycle; tolak first cycle masa lalu; tolak source DANA; fixture BCA | — |
| S10 | Balance confirmation + reconciliation | S7, S9 | Physical-first; `BALANCE_ADJUSTMENT`; replacement; prompt bulanan + fallback akhir bulan | — |
| S11 | Reporting + metrics | S8–S10 | Seluruh metric; `CALENDAR_DAY_PRORATA_V1`; completeness; as-settled vs corrected | — |
| S12 | UI | S11 | App shell; dashboard; theme; aksesibilitas; mutation menunggu server | — |
| S13 | Portability + operations | S11 | Export ZIP; manifest PWA; backup R2 + restore drill; keepalive aktif | Akun Cloudflare R2, SMTP, project production |
| S14 | Uang tunai dalam settlement pool | S7, S8 | Aktivasi dari settlement; dompet dihitung tiap settlement; transfer internal pool netral; target reserve dari DANA saja; koreksi settled dan replacement dompet; e2e UI | — |
| S15 | Palette `Petrol & Paper`, geometri siku, ikon provider, kepadatan Beranda | S12 | Selesai; token baru lolos kontras; radius 0 kecuali radio; ikon BCA (myBCA), DANA, dan Jago; progress bar, strip tujuh hari, kartu kelayakan chart; query budget Beranda tidak naik | — |
| S16 | Motion + perapian form | S15 | Selesai; `LazyMotion` pada surface P3; reduced-motion; form memakai satu pola submit | — |
| S17 | Halaman Laporan + Chart.js | S15 | Selesai; `/aktivitas/laporan`; chart lazy hanya ≥ `md` dan setelah threshold; text summary; query budget | — |
| S18 | Pengingat Telegram | S12 | Selesai; aktif di production sejak 2 Oktober 2026 (migration 0013, token terpasang, run pertama SENT); digest harian tanpa nominal; satu per tanggal bisnis; workflow terjadwal; secret tidak di repo | Chat id pemilik (pemilik mengirim `/start` ke bot) |

Rencana S15–S18: `docs/superpowers/plans/2026-10-01-visual-refresh-roadmap.md`.

Slice boleh dimulai hanya ketika seluruh item pada kolom "Diblokir oleh" sudah berupa keputusan LOCKED di PRD.

## 7. Kontrak API

- Base path `/api/v1`; internal keepalive berada di `/api/internal/keepalive` di luar versioning
- Amount berupa string desimal (`"831999.93"`); date-only `YYYY-MM-DD`; timestamp RFC 3339 dengan offset
- Error selalu JSON: `{ "error": { "code", "message", "details?", "requestId" } }`; API tidak pernah redirect ke HTML
- Aggregate yang dapat diedit memakai `If-Match`; mismatch → `409 STALE_VERSION`
- Endpoint laporan menerima `?view=as_settled|corrected` (default `corrected`)

Katalog error awal (audit MC-12):

| Status | Code | Makna |
| --- | --- | --- |
| 401 | `INVALID_IDENTITY` | Credential tidak ada, tidak valid, atau kedaluwarsa |
| 401 | `AMBIGUOUS_IDENTITY` | Cookie dan Bearer token membawa identity berbeda |
| 403 | `NOT_OWNER` | Supabase user valid tetapi bukan owner |
| 503 | `APP_NOT_INITIALIZED` | Owner belum di-bootstrap atau binding hilang |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Key sama dengan request body berbeda |
| 409 | `STALE_VERSION` | `If-Match` tidak cocok |
| 409 | `INVARIANT_VIOLATION` | Mutation melanggar invariant domain |
| 422 | `VALIDATION_FAILED` | Input tidak valid, termasuk amount dengan lebih dari dua desimal |

Peta endpoint per resource mengikuti audit §6 dan disesuaikan saat slice terkait dimulai.

## 8. Rencana test

- **Golden fixture** (wajib, bukan contoh): empat minggu Februari 2027, fixture BCA, rekonsiliasi lintas-akun, fixture external tujuh langkah, dan contoh prorata 27 Oktober–2 November. Masing-masing masuk pada slice yang memperkenalkannya
- **Invariant per leg** menggantikan acceptance tautologis `physical = personal + external` (audit MC-13): setiap leg memenuhi `personal_effect = physical_effect − external_ownership_effect`, dan saldo yang dihitung dari leg harus sama dengan saldo yang dihitung dari posisi termaterialisasi
- **Test tambahan audit T-01…T-25** dipetakan ke slice sesuai audit §8; T-06 kini menguji `Tutup target`, T-07 menguji penolakan onboarding tanpa floor, T-08 menguji penolakan source DANA, T-09 menguji warning living expense negatif, dan T-19 menguji penolakan first cycle masa lalu
- **Property test** untuk prorata exact-sum, rounding half-up average, dan contiguity settlement
- **Security test** S0 berjalan pada setiap CI run

## 9. Environment gates

Mengikuti audit §9 dengan perubahan berikut:

- IR-5 tidak lagi relevan karena gate tiga hari dihapus dari workflow keepalive (keputusan OD-4)
- P8 sekarang mencakup provisioning `fintrack_probe` dan `KEEPALIVE_DATABASE_URL` pada Vercel Production
- Gate baru S-SPIKE: `pnpm test:db` harus lulus terhadap project staging hosted melalui pooler hosted sebelum S1 dianggap selesai

## 10. Hal yang membutuhkan pemilik

Seluruh langkah ada di `docs/runbooks/production-and-release.md` dan `docs/runbooks/backup-and-restore.md`:

1. ~~Project Supabase production, environment Vercel Production, MFA~~: selesai 30 September 2026 (`fintrack_prod`, `fintrack-new-woad.vercel.app`)
2. Custom SMTP untuk invite dan password recovery: ditunda; owner dibuat langsung di Dashboard (runbook bootstrap §3)
3. ~~Backup R2~~: **tidak diaktifkan atas keputusan pemilik (30 September 2026)**. Jika data production hilang, pemilik memilih setup ulang. Workflow `database-backup.yml` tetap nonaktif (`FINTRACK_BACKUP_ENABLED` tidak diisi) dan secret koneksinya dihapus dari GitHub; pipeline tetap diuji di CI sehingga dapat diaktifkan kapan saja
4. ~~Keepalive~~: aktif sejak 30 September 2026
5. ~~Bootstrap owner production dan onboarding~~: selesai 30 September 2026

Catatan: password database dan secret key staging yang pernah dibagikan lewat chat tidak dirotasi atas keputusan pemilik (30 September 2026); staging tidak pernah dipakai untuk data production.
