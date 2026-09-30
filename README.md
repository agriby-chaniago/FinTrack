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

Slice 0 (platform and security spike) and Slice 1 (private authentication) run locally. Financial features start with Slice 2 after the PROPOSED items in PRD v0.17 are reviewed.

Owner bootstrap and recovery: [docs/runbooks/owner-bootstrap-and-recovery.md](docs/runbooks/owner-bootstrap-and-recovery.md).
