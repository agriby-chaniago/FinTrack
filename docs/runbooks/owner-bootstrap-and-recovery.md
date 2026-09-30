# Runbook: owner bootstrap and recovery

Audience: the FinTrack owner operating a Supabase environment (staging or production).
Every step uses the Supabase Dashboard or a trusted machine. Nothing here is exposed as an app endpoint.

## 1. Supabase Auth configuration (once per environment)

Set these in **Authentication → Sign In / Providers** and related pages before sharing the URL:

| Setting | Value |
| --- | --- |
| Allow new users to sign up | Off |
| Email provider | On (email + password login needs it) |
| Confirm email | On |
| Anonymous sign-ins | Off |
| All social and phone providers | Off |
| Minimum password length | 12 |
| Site URL | The production origin, for example `https://fintrack.example` |
| Redirect URLs | Exactly `<origin>/auth/callback`; on staging also `https://*-agriby-chaniagos-projects.vercel.app/auth/callback` for Vercel Preview |
| Custom SMTP | Configured and tested (required before invite and recovery count as production-ready) |

Do not turn off the Email provider to block signups. Turning it off also blocks email and password login; blocking signups is the job of "Allow new users to sign up".

Email templates (**Authentication → Emails**) must link to the server callback with a token hash:

- Invite user: `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/reset-password`
- Reset password: `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`

The local copies of these templates are in `supabase/templates/`.

## 2. Database roles (once per environment, after each migration run)

On a trusted machine with the environment's admin connection string:

```bash
export ADMIN_DATABASE_URL='postgresql://postgres.<project-ref>:<password>@<pooler-host>:5432/postgres'
export FINTRACK_APP_DB_PASSWORD='<random, 32+ characters>'
export FINTRACK_PROBE_DB_PASSWORD='<random, 32+ characters>'   # production only
export FINTRACK_BACKUP_DB_PASSWORD='<random, 32+ characters>'
node scripts/migrate.mts
node scripts/provision-roles.mts
```

Store each password in the password manager, then set:

- Vercel `DATABASE_URL` = `postgresql://fintrack_app.<project-ref>:<app password>@<pooler-host>:6543/postgres`
- Vercel Production `KEEPALIVE_DATABASE_URL` = the same form with `fintrack_probe`
- The backup workflow secret with `fintrack_backup`

Before trusting the configuration, put the staging values in `.env.staging.local` (gitignored; see `.env.example` for the variable names, plus `TEST_DIRECT_*_URL` pointing at the session pooler on port 5432) and run:

```bash
FINTRACK_ENV=staging pnpm vitest run --project db
```

The suite creates and deletes temporary Auth users and resets `app_owner`, so never run it against production.

After rotating a role password, the Supabase pooler can keep accepting only the previous password for a short time. Wait a minute before concluding that a connection failure is a real misconfiguration.

Keep test-only variables (`TEST_DIRECT_*_URL`), the backup credential, and `SUPABASE_SECRET_KEY` out of Vercel. The app runtime needs only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL`, and, in production, `APP_ORIGIN`, `KEEPALIVE_DATABASE_URL`, and `KEEPALIVE_TOKEN`.

## 3. First owner bootstrap

1. Confirm step 1 is complete, especially that signups are off.
2. Create the owner in Auth, either way:
   - **Without custom SMTP** (used for production on 30 September 2026): **Authentication → Users → Add user → Create new user**, enter the owner's email and a generated password (store it in the password manager), and tick **Auto Confirm User**. No email is sent. Supabase only allows editing email templates after custom SMTP is configured, so the invite link format of step 1 is not available without it.
   - **With custom SMTP and the templates of step 1:** **Invite user** and let the owner set a password from the email.
3. Copy the new user's UUID from the Users table.
4. On the trusted machine, from the repository root, with `ADMIN_DATABASE_URL` set for that environment:

   ```bash
   ADMIN_DATABASE_URL='<admin url>' node scripts/bootstrap-owner.mts --auth-user-id <uuid>
   ```

   (`pnpm owner:bind` does the same but reads `.env.local`, which points at local Supabase.) Expected output: `Owner binding: CREATED`. Running it again prints `ALREADY_BOUND`.
5. The owner signs in on `/login` (after setting a password from the invitation, when invited).

Without custom SMTP, password recovery email only reaches members of the Supabase organization and works only when the link opens in the browser that requested it. The admin can always recover access by deleting the Auth user, creating it again, and rebinding (section 4).

Bootstrap does not create accounts, balances, or any financial record. Financial onboarding happens inside the app afterwards.

## 4. Recovery

### Forgotten password

Use `/forgot-password`. The response is always the same, whether or not the email exists.

### Lost access to the email address or the Auth user was deleted

Deleting the Auth user clears the binding automatically. Financial history stays intact and every protected request returns `APP_NOT_INITIALIZED` until an explicit rebind.

1. Verify that the person requesting access is the owner. Do this outside FinTrack, because the app has no backdoor.
2. Invite the owner's current email address as a new user (step 3.2) and copy its UUID.
3. Rebind:

   ```bash
   pnpm owner:bind --auth-user-id <new uuid> --rebind
   ```

   Expected output: `Owner binding: REBOUND`. The stable `app_owner.id` and all financial records are unchanged.

`--rebind` refuses to run while the owner is still bound to another Auth user. To replace a working binding, delete the old Auth user first, then rebind.

## 5. Signing out every device

Use **Keluar dari semua perangkat** in the app, or revoke sessions for the user in the Supabase Dashboard. Existing access tokens stay valid until they expire (default one hour). Refresh tokens stop working immediately.
