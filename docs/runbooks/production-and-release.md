# Runbook: production setup and release

Audience: the FinTrack owner. Covers the one-time production setup and every later release (PRD: release flow, keepalive, installable website). Commands run on a trusted machine; nothing here is an app endpoint.

## 1. One-time production setup

Do these in order. Production never shares a project, credential, or secret with staging, and the test suites never run against production.

Keep every production secret in the password manager and read it at the moment of use instead of writing it to a file. With the 1Password CLI, for example: `ADMIN_DATABASE_URL="postgresql://postgres.<ref>:$(op read --no-newline op://<vault>/<item>/<field> | node -e 'process.stdout.write(encodeURIComponent(require("fs").readFileSync(0,"utf8")))')@<pooler-host>:5432/postgres" node scripts/migrate.mts`. URL-encode database passwords that contain special characters.

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
6. **Owner bootstrap**: create (or invite) the owner in Supabase Auth, then bind it with the production `ADMIN_DATABASE_URL` (bootstrap runbook §3). Complete onboarding in the browser.
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

## 4. Telegram digest

The daily digest (PRD v0.20 P6) sends the owner the titles of `Perlu dilakukan` at 08:00 `Asia/Jakarta`, at most once per business date, with no amounts. GitHub Actions calls `POST /api/internal/reminders`; the route reads the tasks as the bound owner and records the date before sending.

One-time setup, after migration `0013` is applied to production:

1. **Vercel Production** (all Sensitive): `TELEGRAM_BOT_TOKEN` (from @BotFather), `TELEGRAM_CHAT_ID` (from `getUpdates` after the owner sends `/start` to the bot), and `REMINDER_TOKEN` (a random 32+ character secret). Redeploy so the route sees them.
2. **GitHub**: secret `FINTRACK_REMINDER_TOKEN` (same value as `REMINDER_TOKEN`), variable `FINTRACK_REMINDER_URL` = `https://<origin>/api/internal/reminders`, then variable `FINTRACK_REMINDER_ENABLED` = `true`.
3. Run the `Telegram reminder` workflow once by hand. It must end with HTTP 200 and status `SENT` (or `NOTHING_DUE` when nothing is pending). A second manual run the same day answers `ALREADY_SENT`.

To stop the digest, set `FINTRACK_REMINDER_ENABLED` to anything other than `true`. To change the bot or chat, update the Vercel values and redeploy. A failed run (HTTP 502) leaves no record, so the next scheduled run tries again.
