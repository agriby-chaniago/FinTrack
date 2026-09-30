# Runbook: backup, restore, and export

Covers PRD sections "Backup dan restore" and "Export data milik pengguna". The daily backup is for disaster recovery. The owner export is a portability format and is not a restore mechanism.

## 1. What a backup contains

`scripts/backup/create-bundle.sh` connects as `fintrack_backup` (read-only, `BYPASSRLS`) and writes one bundle directory:

| File | Content |
| --- | --- |
| `schema.sql` | `pg_dump --schema-only` of schemas `fintrack` and `ops`, including RLS policies and grants |
| `data.dump` | `pg_dump --data-only --format=custom` of `fintrack` and `ops` |
| `app_owner.csv` | The owner row without `auth_user_id`; the Auth binding is recreated with `--rebind` |
| `migrations.csv` | `drizzle.__drizzle_migrations` hashes; a restore target must match them exactly |
| `roles.csv` | FinTrack role attributes. Passwords are never read |
| `counts.csv`, `server_version.txt` | Row count per table and PostgreSQL version at backup time |
| `manifest.json`, `SHA256SUMS` | Manifest and SHA-256 checksum of every file |

Excluded data: `fintrack.idempotency_record` (short-lived replay cache) and the Auth UUID in `app_owner`. Supabase Auth itself is not backed up; recovery recreates the owner in Auth and rebinds it (see [owner-bootstrap-and-recovery.md](owner-bootstrap-and-recovery.md)).

The dump is one snapshot. The script compares row counts before and after the dump and repeats the backup (up to three times) when the owner was writing during it.

## 2. Daily workflow

`.github/workflows/database-backup.yml` runs every day at 19:40 UTC (02:40 WIB) and on manual dispatch. It:

1. Creates the plaintext bundle on the runner.
2. Runs the restore drill (`scripts/backup/drill.sh`) on that bundle: a throwaway PostgreSQL 17 container is migrated to the bundle's migration level, the data is restored, and row counts, checksums, and ledger legs are verified. A bundle that cannot be restored is never uploaded.
3. Encrypts `tar.gz` with `age` to the public recipient key, uploads it to `daily/`, copies the first backup of each month to `monthly/YYYY-MM/`, and writes `status/last-success.json` (last success timestamp, object key, SHA-256).
4. Deletes the plaintext files.
5. On failure, opens (or comments on) a GitHub issue labelled `backup-failure`. The next successful run closes it. GitHub also emails the owner about failed scheduled runs.

CI runs the same bundle and drill scripts against local Supabase with the full-month fixture on every push.

## 3. One-time setup (owner)

1. **Encryption key.** On a trusted machine run `age-keygen -o fintrack-backup.key`. Store the private key file in the password manager and keep one offline copy. It never goes to GitHub, Vercel, or R2. The printed public key starts with `age1`.
2. **R2 bucket.** Create a private bucket (for example `fintrack-backup`) with public access disabled. Add lifecycle rules: prefix `daily/` deletes objects after 30 days; prefix `monthly/` deletes objects after 400 days (12 monthly snapshots plus margin). Objects under `status/` are overwritten.
3. **R2 API token.** Create an R2 API token with Object Read & Write scoped to that bucket only.
4. **Backup connection.** Use the session pooler (port 5432) with the backup role: `postgresql://fintrack_backup.<project-ref>:<FINTRACK_BACKUP_DB_PASSWORD>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`. The role gets `LOGIN` from `pnpm db:provision` (see the bootstrap runbook).
5. **GitHub configuration** (repository settings → Secrets and variables → Actions):

   | Kind | Name | Value |
   | --- | --- | --- |
   | Secret | `FINTRACK_BACKUP_DATABASE_URL` | Connection string from step 4 (production) |
   | Secret | `FINTRACK_R2_ACCESS_KEY_ID` | R2 token access key id |
   | Secret | `FINTRACK_R2_SECRET_ACCESS_KEY` | R2 token secret |
   | Variable | `FINTRACK_R2_ACCOUNT_ID` | Cloudflare account id |
   | Variable | `FINTRACK_R2_BUCKET` | Bucket name |
   | Variable | `FINTRACK_BACKUP_AGE_RECIPIENT` | The `age1…` public key |
   | Variable | `FINTRACK_BACKUP_ENABLED` | `true` once everything above exists |

6. Run the workflow once with **Run workflow** and confirm that `status/last-success.json` appears in the bucket.

## 4. Restore drill with the real key

Required before the first production release, every six months, and after material changes to the schema or the backup pipeline. Use a scratch machine with Docker, Node.js 24, and a checkout of this repository.

```bash
aws s3 --endpoint-url https://<account-id>.r2.cloudflarestorage.com cp s3://<bucket>/daily/<name>.tar.gz.age .
age --decrypt --identity fintrack-backup.key <name>.tar.gz.age | tar -xz
BUNDLE_DIR=./<name> scripts/backup/drill.sh
```

Record the date, the bundle name, and the result. The drill never touches a real environment.

To rehearse with local data instead: `FINTRACK_KEEP_FIXTURE=1 pnpm exec vitest run --project db tests/reports` leaves the full-month fixture in local Supabase; then run `create-bundle.sh` with the local backup role (`postgresql://fintrack_backup:<password>@127.0.0.1:54322/postgres`) and `drill.sh`.

## 5. Full restore (database or project loss)

Only for database/project loss or corruption. Everyday input mistakes use correction and reconciliation.

1. Stop mutations: set Vercel Production to maintenance or remove `DATABASE_URL` so the app fails closed.
2. If the old database is still reachable, take a forensic bundle first (manual workflow run or `create-bundle.sh`).
3. Create a new Supabase project in `ap-southeast-1` and configure Auth as in the bootstrap runbook.
4. Migrate the new project to the bundle's level. `manifest.json` → `migrations.count` gives N:

   ```bash
   node scripts/backup/prepare-migrations.mts <N> /tmp/fintrack-migrations
   ADMIN_DATABASE_URL=<new admin url> MIGRATIONS_FOLDER=/tmp/fintrack-migrations node scripts/migrate.mts
   ADMIN_DATABASE_URL=<new admin url> pnpm db:provision
   ```

5. Restore and verify:

   ```bash
   BUNDLE_DIR=./<name> TARGET_DATABASE_URL=<new admin url> scripts/backup/restore-bundle.sh
   ```

   The script refuses a target at another migration level or one that already has data, restores the owner row without an Auth user, restores the data in one transaction, and verifies row counts and ledger legs. If it fails midway, drop the project and start again from step 3.

6. Invite the owner in the new project's Auth, then `pnpm owner:bind --auth-user-id <uuid> --rebind`.
7. Apply any newer migrations with `pnpm db:migrate`, point Vercel Production at the new project, redeploy, and run the smoke check from the release runbook.

## 6. Owner export

`Pengaturan → Data → Ekspor data` calls `GET /api/v1/export`. The server reads every exported table in one `REPEATABLE READ, READ ONLY` transaction and streams a ZIP with:

- `fintrack.json`: `formatVersion`, `exportedAt`, and every dataset
- `csv/<table>.csv`: one RFC 4180 CSV per table
- `manifest.json`: conventions, excluded data, row counts, and SHA-256 per file

Amounts in `*_minor` columns are exact integer strings in sen. The export never contains passwords, sessions, tokens, the Auth UUID binding, or secrets, and it is never stored on the server. `src/server/application/export.ts` holds the coverage registry; a test fails when a new table is neither exported nor excluded with a reason.
