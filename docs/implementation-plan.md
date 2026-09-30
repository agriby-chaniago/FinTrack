# FinTrack Implementation Plan

_Rencana teknis turunan dari `PRD.md` v0.17 dan `docs/audit/2026-09-30-readiness.md`. PRD tetap menjadi source of truth untuk perilaku produk; dokumen ini mengatur urutan kerja, bentuk data, dan cara verifikasi._

| Metadata | Nilai |
| --- | --- |
| **Dibuat** | 30 September 2026 |
| **Basis** | PRD v0.17, audit readiness 30 September 2026 |
| **Slice aktif** | S0 dan S1 selesai (lokal + staging hosted); S2 menunggu review PROPOSED |

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
| Urutan ledger | `(effective_business_date, recorded_at, id)` | PRD Time rules (PROPOSED), audit MC-1 |
| Supersession | Setiap tabel dengan `supersedes_id` juga menyimpan `superseded_by_id` dan partial unique index `WHERE superseded_by_id IS NULL` pada kunci logisnya; keduanya ditulis dalam transaction yang sama | Audit MC-7 |
| Transfer target | `transfer_target(owner_id, context_type, context_key, source_account_id, destination_account_id)` unik; `context_key` = settlement id atau `YYYY-MM` | Audit MC-6 |
| Cycle | `cycle_key` `YYYY-MM` pada kedua jenis occurrence; monthly cycle adalah grouping turunan | PRD Time rules (PROPOSED), audit MC-10 |
| Non-overlap | `EXCLUDE USING gist (owner_id WITH =, daterange(start_date, end_date, '[]') WITH &&)` untuk settlement dan daily-income state period; contiguity dicek di application layer + property test | Audit IR-2 |
| Invariant agregat | Tabel posisi external termaterialisasi per `(holding_id, account_id)` dengan `CHECK (position >= 0)` dan `SELECT … FOR UPDATE`; total komponen transfer dan total allocation dicek dalam transaction yang sama | Audit IR-1 |
| Idempotency | Header `Idempotency-Key` wajib pada POST/PATCH; tabel `idempotency_record(owner_id, key, method, path, request_hash, response_status, response_body, created_at)`; replay 24 jam; key sama dengan body berbeda → `409 IDEMPOTENCY_KEY_REUSED` | Audit IR-3 |
| Konkurensi lazy evaluation | `UNIQUE (rule_id, effective_date)` pada transition dan advisory lock per rule saat evaluasi | Audit IR-9 |
| Rekonstruksi settlement | Satu fungsi murni `reconstructSettlement(input)` dipakai oleh as-settled dan corrected view | Audit IR-10 |

Rekomendasi arsitektur (belum dikunci PRD): satu inti append-only `ledger_entry` + `ledger_leg` dengan kolom `physical_effect`, `external_ownership_effect`, dan `personal_effect` turunan. Keputusan final diambil pada awal S3 setelah S2 selesai.

## 5. Peta migration

| Migration | Isi | Status |
| --- | --- | --- |
| `0000_platform_roles` | `btree_gist`, role `fintrack_app`/`fintrack_probe`/`fintrack_backup` (NOLOGIN) | Selesai |
| `0001_platform_schema` | Schema `fintrack`/`ops`, `app_owner`, fungsi owner, RLS, `ops.keepalive_probe` | Selesai |
| M2 | `account` (+ `is_cash_account`, `currency CHECK = 'IDR'`, `activation_cutover_at`), `special_expense_category`, `app_setting` | S2 |
| M3 | `onboarding_snapshot`, `opening_account_position`, konfigurasi rule awal | S2 |
| M4 | `ledger_entry`, `ledger_leg`, index urutan kanonik | S3 |
| M5 | `external_subject`, `external_holding`, `external_position` | S4 |
| M6 | `transfer`, `transfer_ownership_component`, `transfer_target`, `transfer_target_version`, `transfer_allocation` | S6 |
| M7 | `daily_income_rule`, `daily_income_state_transition`, `daily_income_state_period`, `daily_income_override` | S7 |
| M8 | `settlement`, `balance_confirmation` | S7 |
| M9 | `monthly_income_rule`, occurrence, `recurring_expense_rule`, revision, occurrence, `occurrence_resolution` | S9 |
| M10 | `balance_adjustment` | S10 |
| M11 | `idempotency_record`, view saldo/coverage, index berbasis query | S1–S11 |
| M12 | Registry cakupan export | S13 |

## 6. Slice

| # | Slice | Bergantung | Exit criteria | Diblokir oleh |
| --- | --- | --- | --- | --- |
| S0 | Platform + security spike | — | Lint/typecheck/test/build hijau di CI; DB dibangun dari nol; spike lokal lulus; spike hosted lulus | Project Supabase staging |
| S1 | Identity + authorization | S0 | Bootstrap idempoten; adapter cookie dan Bearer → `VerifiedClaims`; login/logout lokal dan global; recovery generik; 13 skenario auth + jalur pengecualian auth hijau; runbook rebind | — |
| S2 | Accounts, onboarding, konfigurasi awal | S1 | Draft → confirmed atomik; opening + external; rule dan setting awal; seed `Vape`; fixture onboarding PRD direproduksi | PROPOSED konfigurasi awal onboarding |
| S3 | Ledger core | S2 | Konvensi tanda PRD; saldo calculated as-of; urutan kanonik; aturan inklusi date-only terhadap timestamp | PROPOSED Time rules |
| S4 | External funds | S3 | Lima quick action; posisi ≥ 0; syarat arsip; fixture 7 langkah direproduksi | PROPOSED syarat arsip account |
| S5 | Financial events + koreksi periode terbuka | S3 | Special expense + kategori; reversal/replacement; reversal-only void; `Catat income/expense lain` | PROPOSED entry point income/expense lain |
| S6 | Transfer + target + allocation | S4, S5 | Ownership composition; allocation oldest-first; surplus; `Tutup target`; recalculation chain | PROPOSED recalculation chain, `Tutup target` BCA |
| S7 | Daily income + weekly settlement | S6 | Pause/resume, override, lazy evaluation; snapshot lengkap; catch-up; living expense negatif + warning; fixture Februari 2027 | PROPOSED snapshot dan klasifikasi komponen |
| S8 | Koreksi settled history | S7 | `CORRECTION_POSTING`; corrected view DANA; koreksi override setelah settlement | PROPOSED target koreksi override |
| S9 | BCA monthly cycle | S6, S7 | Occurrence + resolution; revision; gating kronologis; obligation-only cycle; tolak first cycle masa lalu; tolak source DANA; fixture BCA | PROPOSED obligation-only cycle |
| S10 | Balance confirmation + reconciliation | S7, S9 | Physical-first; `BALANCE_ADJUSTMENT`; replacement; prompt bulanan + fallback akhir bulan | PROPOSED fallback prompt |
| S11 | Reporting + metrics | S8–S10 | Seluruh metric; `CALENDAR_DAY_PRORATA_V1`; completeness; as-settled vs corrected | — |
| S12 | UI | S11 | App shell; dashboard; theme; aksesibilitas; mutation menunggu server | — |
| S13 | Portability + operations | S11 | Export ZIP; manifest PWA; backup R2 + restore drill; keepalive aktif | Akun Cloudflare R2, SMTP, project production |

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

1. Review seluruh item **PROPOSED** pada PRD v0.17
2. Membuat project Supabase staging dan production (region `ap-southeast-1`), project Vercel (region `sin1`), serta mengaktifkan MFA pada seluruh akun
3. Menyediakan custom SMTP untuk invite dan password recovery
4. Menyediakan bucket Cloudflare R2 privat dan kunci enkripsi backup
5. Pending onboarding data pada PRD
