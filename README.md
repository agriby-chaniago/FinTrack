# FinTrack

Low-input personal cashflow tracking with periodic balance settlement. Single owner, responsive website first, mobile later.

- Product requirements: [PRD.md](PRD.md)
- Implementation plan: [docs/implementation-plan.md](docs/implementation-plan.md)
- Contributor and agent rules: [AGENTS.md](AGENTS.md)

## Stack

TypeScript (strict), Next.js App Router, Supabase PostgreSQL and Auth, Drizzle ORM, Tailwind CSS, Vitest. Hosted on Vercel (`sin1`) and Supabase (`ap-southeast-1`).

## Local development

Requirements: Node.js 24+, pnpm 10, Docker, Supabase CLI.

```bash
pnpm install
supabase start -x studio,imgproxy,edge-runtime,logflare,vector,realtime,storage-api,postgres-meta
pnpm env:local        # writes .env.local with local Supabase keys
pnpm db:migrate
pnpm db:provision
pnpm dev
```

Checks:

```bash
pnpm lint
pnpm typecheck
pnpm test      # unit tests
pnpm test:db   # database security tests against local Supabase
pnpm build
```

## Status

All slices S0–S13 are implemented: private authentication, onboarding, the append-only ledger, external funds, transfers and targets, daily income with weekly DANA settlement, BCA monthly cycles, reconciliation, reports, the full UI, owner export, the installable manifest, and the encrypted backup pipeline. Production activation is an owner task.

Checks also include `pnpm test:e2e` (Playwright against `next dev` and local Supabase; set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to reuse a system Chromium).

Runbooks:

- Owner bootstrap and recovery: [docs/runbooks/owner-bootstrap-and-recovery.md](docs/runbooks/owner-bootstrap-and-recovery.md)
- Production setup and release: [docs/runbooks/production-and-release.md](docs/runbooks/production-and-release.md)
- Backup, restore, and export: [docs/runbooks/backup-and-restore.md](docs/runbooks/backup-and-restore.md)
