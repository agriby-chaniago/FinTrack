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
cp .env.example .env.local
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

Slice 0 (platform and security spike) is in progress. Application features have not been implemented yet.
