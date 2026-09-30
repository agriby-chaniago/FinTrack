# Runbook: production setup and release

Audience: the FinTrack owner. Covers the one-time production setup and every later release (PRD: release flow, keepalive, installable website). Commands run on a trusted machine; nothing here is an app endpoint.

## 1. One-time production setup

Do these in order. Production never shares a project, credential, or secret with staging, and the test suites never run against production.

1. **MFA** on Supabase, Vercel, GitHub, Cloudflare, and the recovery email account.
2. **Supabase project** `fintrack-production` in `ap-southeast-1`. Configure Auth exactly as in [owner-bootstrap-and-recovery.md §1](owner-bootstrap-and-recovery.md), with Site URL set to the production origin and custom SMTP tested.
3. **Database**: run migrations and provision the three roles with new random passwords (bootstrap runbook §2). Store the passwords in the password manager.
4. **Vercel Production environment** (Preview keeps pointing at staging):

   | Variable | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Production project URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Production publishable key |
   | `DATABASE_URL` | `fintrack_app.<ref>` on the transaction pooler (port 6543), marked Sensitive |
   | `APP_ORIGIN` | Production origin, for example `https://fintrack.example` |
   | `KEEPALIVE_DATABASE_URL` | `fintrack_probe.<ref>` on the transaction pooler, Sensitive |
   | `KEEPALIVE_TOKEN` | Random 32+ character secret, Sensitive |

   Do not add `SUPABASE_SECRET_KEY`, `ADMIN_DATABASE_URL`, the backup credential, or any `TEST_DIRECT_*` variable.
5. **Deploy** `main` to Production and run the smoke check (§3).
6. **Owner bootstrap**: invite the owner from the Supabase Dashboard, then `pnpm owner:bind --auth-user-id <uuid>` with the production `ADMIN_DATABASE_URL` (bootstrap runbook §3). Complete onboarding in the browser.
7. **Keepalive**: in GitHub set secret `FINTRACK_KEEPALIVE_TOKEN` (same value as Vercel `KEEPALIVE_TOKEN`), variable `FINTRACK_KEEPALIVE_URL` = `https://<origin>/api/internal/keepalive`, then variable `FINTRACK_KEEPALIVE_ENABLED` = `true`. Run the workflow once manually; it must pass with HTTP 204.
8. **Backup**: follow [backup-and-restore.md §3](backup-and-restore.md), run the workflow once, then do the restore drill with the real key (§4 there). The first production release is not complete until that drill passed.
9. **Install**: open the production site on the phone and add it to the home screen (Pengaturan shows the steps). The app stays online-only; there is no service worker.

## 2. Release checklist

For every change that reaches production:

1. CI is green on `main`: lint, typecheck, unit tests, build, database rebuilt from zero with migrations applied twice, database tests, backup bundle + restore drill, and the end-to-end test.
2. **Staging migration**: `node --env-file=.env.staging.local scripts/migrate.mts`, then `FINTRACK_ENV=staging pnpm vitest run --project db`.
3. **Staging smoke check**: open the Vercel Preview deployment, sign in with the staging owner, and load Beranda, Rutinitas, Aktivitas, Akun, and Pengaturan.
4. **Production confirmation**: read the migration SQL once more. A destructive migration needs an extra snapshot (step 5) and an expand/backfill plan so the previous app version keeps working.
5. **Pre-release backup**: run the Database backup workflow manually and wait for success.
6. **Production migration**: `ADMIN_DATABASE_URL=<production admin url> node scripts/migrate.mts`, then `node scripts/provision-roles.mts` if roles changed.
7. **Deploy** the same commit to Production (promote the checked Preview or push to the production branch).
8. **Production smoke check** (§3).

## 3. Smoke check

- `/login` loads over HTTPS; signing in lands on Beranda with the recorded personal cash.
- Beranda, Rutinitas, Aktivitas, Akun, and Pengaturan load without an error page.
- `GET /manifest.webmanifest` returns `display: standalone`.
- `POST /api/internal/keepalive` without the token returns 401; the keepalive workflow run returns 204.
- Vercel logs show no 5xx for the requests above. Each error response carries an `X-Request-Id`.

Do not record test transactions in production. If a smoke step fails, roll back the deployment in Vercel; migrations are additive, so the previous version keeps working.
