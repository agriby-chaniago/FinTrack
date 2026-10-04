# FinTrack

**Know where your money stands—without logging every purchase.**

FinTrack is a low-input personal cashflow tracker built around periodic balance settlement. Instead of asking you to record every coffee, meal, or small purchase, it combines recurring income, confirmed balances, transfers, and explicitly recorded expenses to give you a clearer view of your finances.

Built as a personal, open-source project, FinTrack is a responsive web app for **one owner per deployment**. It is not a multi-user finance platform or a SaaS product.

![Dashboard Preview](/docs/assets/dashboard-placeholder.png)

*Screenshot placeholder: a dashboard preview will be added here.*

## Why FinTrack?

Most expense trackers depend on exhaustive manual entry. FinTrack takes a different approach: record the events that matter, confirm your actual balances periodically, and let settlement reveal everyday spending.

The goal is to answer practical questions with less effort:

- How much personal cash do I have, and which accounts hold it?
- Which balances are confirmed, and which are calculated?
- What does everyday living cost on average?
- How much went toward non-routine expenses and monthly obligations?
- How much actually reached my reserves, and how much did those reserves grow?

FinTrack does not connect to your bank or pretend that calculated balances are live bank balances. Balance confirmation is an explicit part of the workflow.

## Features

- **Cashflow overview:** View personal balances, balance freshness, spending, and reserve growth.
- **Periodic settlement:** Reconcile actual balances to estimate everyday spending without itemizing every purchase.
- **Income and routines:** Track daily income, weekly settlement, and monthly obligations, including subscriptions and bank fees.
- **Accounts and transfers:** Record movements between accounts without counting transfers as income or expenses.
- **External funds:** Keep money held for others separate from your own available cash.
- **Targets and reserves:** Track planned transfers and actual contributions to reserves.
- **Traceable history:** Preserve financial events in an append-only ledger, with correction workflows rather than silent rewrites.
- **Reports and portability:** Review cashflow reports, export owner data, and operate an encrypted backup pipeline.
- **Private, mobile-friendly access:** Use owner-only authentication and a responsive interface with an installable web app manifest.

## How it works

### The financial workflow

1. **Set up your accounts and opening balances.** Onboarding establishes the starting point for your financial history.
2. **Record meaningful events.** Add income, transfers, external funds, and non-routine expenses as they happen.
3. **Confirm actual balances periodically.** Settlement compares recorded activity with confirmed balances to determine everyday spending.
4. **Review the result.** The dashboard and reports distinguish personal cash, obligations, expenses, and actual reserve growth.

The current workflows include weekly DANA and wallet settlement and BCA monthly cycles. Account names and routing are configuration data rather than a reason to duplicate the core financial rules.

### Architecture

FinTrack keeps the web interface, application services, and financial rules in one TypeScript codebase:

| Layer | Responsibility |
| --- | --- |
| **Next.js App Router + React** | Responsive pages, server-side data loading, and API routes under `src/app`. |
| **Application services** | Coordinate onboarding, ledger events, settlement, transfers, reconciliation, reports, and exports in `src/server/application`. |
| **Domain logic** | Express financial rules independently of the UI in `src/server/domain`. |
| **Supabase Auth** | Authenticate the owner; the app verifies identity and resolves the configured owner before granting access. |
| **Drizzle + PostgreSQL** | Store financial records in Supabase PostgreSQL through a server-side `node-postgres` connection. Versioned migrations live in `drizzle/`. |

Protected database work runs through `withOwnerDb()`, which establishes owner identity inside a transaction. PostgreSQL row-level security and explicit owner predicates provide additional enforcement. Financial tables live in a private `fintrack` schema that is not exposed through the Supabase Data API, and the runtime database role cannot bypass row-level security.

Money is stored as integer minor units (`bigint`) and represented as decimal strings in the API—not floating-point JavaScript numbers. Business dates use `Asia/Jakarta`.

Client mutations invalidate cached and prefetched app data so balances refresh after a change. Page loaders use set-based reads, with integration tests guarding database query budgets.

### Technology stack

- **Language:** TypeScript with strict type checking
- **Web:** Next.js 16, React 19
- **UI:** Tailwind CSS 4, daisyUI, Chart.js, Motion
- **Database and authentication:** Supabase PostgreSQL and Supabase Auth
- **Data access and validation:** Drizzle ORM, `node-postgres`, Zod
- **Testing:** Vitest and Playwright
- **Deployment:** Vercel (`sin1`) and Supabase (`ap-southeast-1`)

## Getting started

### Prerequisites

- Node.js **24 or later**
- pnpm **10** (the exact version is declared in `package.json`)
- Docker running locally
- Supabase CLI

### Run locally

1. Clone the repository and install dependencies:

   ```bash
   git clone https://github.com/agriby-chaniago/fintrack_new.git
   cd fintrack_new
   pnpm install
   ```

2. Start local Supabase and prepare the database:

   ```bash
   supabase start -x studio,imgproxy,edge-runtime,logflare,vector,realtime,storage-api,postgres-meta
   pnpm env:local
   pnpm db:migrate
   pnpm db:provision
   ```

   `pnpm env:local` writes `.env.local` using your local Supabase configuration. See [`.env.example`](.env.example) for available settings. Keep credentials and environment files out of version control.

3. Create an Auth user in your local Supabase environment, then bind its UUID as the owner:

   ```bash
   pnpm owner:bind --auth-user-id <auth-user-uuid>
   ```

   FinTrack has no public signup flow. Follow the [owner bootstrap and recovery runbook](docs/runbooks/owner-bootstrap-and-recovery.md) for Auth configuration, owner creation, and recovery details.

4. Start the app:

   ```bash
   pnpm dev
   ```

   Open [http://localhost:3000](http://localhost:3000), sign in as the owner, and complete financial onboarding.

### Run checks

```bash
pnpm lint
pnpm typecheck
pnpm test          # Unit tests
pnpm test:db       # Database integration and security tests
pnpm build
pnpm test:e2e      # Playwright against the development server
pnpm test:e2e:prod # Playwright against the production build; run pnpm build first
```

Database and end-to-end tests require the local Supabase environment. To reuse a system Chromium installation, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

**Do not run database tests against production.** `pnpm test:db` resets the local `app_owner` row and creates temporary Auth users. Rebind your local owner after testing if needed.

## Project status and documentation

FinTrack is actively used in production as a personal project. Owner authentication, onboarding, ledger workflows, settlement, reconciliation, reports, export, and encrypted backups are implemented. The responsive website is the current focus; a native mobile app is deferred.

For deeper product and operational details:

- [Product requirements](PRD.md) — product scope and financial rules
- [Implementation plan](docs/implementation-plan.md) — technical design and testing guidance
- [Contributor and agent guidelines](AGENTS.md) — repository conventions and database rules
- [Owner bootstrap and recovery](docs/runbooks/owner-bootstrap-and-recovery.md)
- [Production setup and release](docs/runbooks/production-and-release.md)
- [Backup, restore, and export](docs/runbooks/backup-and-restore.md)

## Contributing

FinTrack is a personal project that welcomes community improvements. Bug fixes, documentation updates, accessibility improvements, and well-scoped enhancements are all welcome. Contributions should preserve its low-input, single-owner design.

For larger changes or new financial behavior, open an issue first to discuss the problem and proposed approach. Read [AGENTS.md](AGENTS.md) and the relevant sections of [PRD.md](PRD.md) before changing business rules or database access.

1. **Fork** the repository on GitHub and clone your fork.
2. **Create a branch** for your change, such as `fix/settlement-validation` or `docs/setup-guide`.
3. **Make a focused change**, adding or updating tests when behavior changes.
4. **Run the relevant checks** listed above. Include database tests for schema or security changes, and end-to-end tests for affected user flows.
5. **Commit and push** your branch to your fork.
6. **Open a pull request** against this repository. Explain the problem, your approach, and the checks you ran. Include screenshots for UI changes and link any related issue.

Use versioned Drizzle migrations for database changes; do not modify the schema through dashboard edits or `drizzle-kit push`. Never include credentials, personal financial records, or real backup files in issues or pull requests.

## License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPLv3)**. See [LICENSE](LICENSE) for the full terms.

You may use, study, modify, and redistribute FinTrack under that license. If you modify it and let users interact with it remotely over a network, AGPLv3 requires offering those users the corresponding source code of your modified version under the same license.

For commercial use or closed-source deployments outside the AGPLv3 terms, contact the project owner directly to discuss a written license agreement. Commercial use that complies with AGPLv3 is permitted by the license.
