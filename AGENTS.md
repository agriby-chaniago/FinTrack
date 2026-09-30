# FinTrack agent instructions

FinTrack is a single-owner, low-input personal cashflow tracker. Read this file before changing code.

## Sources of truth

- `PRD.md` is the product source of truth. Items labelled **LOCKED** are decided; do not reopen them without citing a concrete contradiction.
- Items labelled **PROPOSED** are awaiting owner approval. Do not implement behaviour that depends only on a PROPOSED item.
- `docs/implementation-plan.md` holds the slice order, migration map, API conventions, and test plan.
- `docs/audit/2026-09-30-readiness.md` records the readiness audit behind the plan.
- Nothing from the old FinTrack/FinTech, Laravel, Keycloak, FinLyzer, or FinGoals projects applies here.

## Commands

```bash
supabase start -x studio,imgproxy,edge-runtime,logflare,vector,realtime,storage-api,postgres-meta
pnpm env:local               # .env.local with local Supabase keys
pnpm db:migrate              # apply committed migrations (admin connection)
pnpm db:provision            # enable LOGIN and set local role passwords
pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm build
pnpm test:e2e && pnpm test:e2e:prod   # Playwright (dev server) and production build (prefetch, cache purge)
```

`pnpm test:db` resets the local `app_owner` row and creates temporary Auth users.

Scripts in `scripts/` run directly on Node's TypeScript type stripping, so they (and anything they import) must use erasable syntax only and relative `.ts` imports.

## Database rules

- Migrations live in `drizzle/`. Generate them with `pnpm db:generate` (or `--custom` for SQL-only changes) and apply them only through `pnpm db:migrate`. Never use `drizzle-kit push` or Dashboard schema edits.
- A migration that creates a table must also enable RLS, add its policies, and add its grants in the same file.
- Financial tables live in the `fintrack` schema, which is not exposed through the Supabase Data API. Never grant anything on it to `anon` or `authenticated`.
- Runtime code connects as `fintrack_app` (no `BYPASSRLS`, not a table owner) with `prepare: false`. Every protected query runs inside `withOwnerDb()` and still uses an explicit `owner_id` predicate.
- `ops.keepalive_probe` is the only relation the keepalive route may read, as `fintrack_probe`.
- Money is an integer number of minor units (`bigint`) in the database and a decimal string in the API. Never use JavaScript `number` for money.
- Business dates use `Asia/Jakarta` and inclusive `[start, end]` ranges in the domain layer.

## Performance and data-access rules

Every query is a round trip from Vercel to the Supabase transaction pooler, which runs a transaction's queries one at a time. The number of round trips, not SQL cost, decides how fast a page is.

- The runtime driver is node-postgres (`src/server/db/client.ts`): one round trip per query. Run raw SQL only through `sqlRows()` (`src/server/db/rows.ts`); raw timestamps come back as strings, so cast or format them in SQL.
- Every non-local connection uses verified TLS with the pinned Supabase root CA: pass `ssl: databaseSsl(url)` (`src/server/db/supabase-ca.ts`) to any new client, script included.
- Never overlap queries on one transaction (no `Promise.all` over queries inside `withOwnerDb`): pg 9 rejects it, the pooler serializes it anyway, and a DB-test guard fails on it.
- Load data in sets, not per row or per account: one query for all accounts, cycles, or targets, then combine in TypeScript. Keep business rules in TypeScript and give batch and single-item callers one implementation (the single-item function wraps the batch one).
- Page loads only read. The one exception is creating the occurrences of a newly started month; targets and other derived records are written by the mutation that makes them due.
- Add every new page loader to `tests/perf/query-budget.integration.test.ts` with a budget that must not grow with history length.
- Client mutations go through `useMutation` (`src/lib/api-client.ts`), which purges the client cache and prefetched tabs via `revalidateAppData()` after each success. A change made any other way must call `revalidateAppData()` itself, or a prefetched tab can show pre-change balances. `pnpm test:e2e:prod` (after `pnpm build`) checks this on a production build.
- The main tabs are fully prefetched only after the first page has loaded and the browser is idle (`useWarmedUp` in the app shell), so prefetching never slows the first open.
- Each app route has a `loading.tsx` skeleton (`src/components/skeletons.tsx`) so navigation responds before data arrives.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
