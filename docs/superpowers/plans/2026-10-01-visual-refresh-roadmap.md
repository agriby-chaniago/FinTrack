# Visual refresh and post-MVP roadmap (S15–S18)

**Spec:** `PRD.md` → `Visual refresh dan fitur pasca-MVP (v0.20)` (P1–P6, all PROPOSED on 1 October 2026).
**Preview:** https://claude.ai/artifact/Q4bY3aNEMPsuNpKtmq7Pyg (palette tokens, contrast, Beranda light/dark against the current UI).

No slice starts until the owner approves the PRD items it depends on and they are relabelled **LOCKED**. Each slice has its own detailed plan, written when the slice starts, so it reflects the code as it stands then.

## Slices

| Slice | PRD | Builds | Plan |
| --- | --- | --- | --- |
| S15 | P1, P2, P4 (teaser only) | `Petrol & Paper` tokens; headline panel, account monograms, section icons, transfer and obligation progress bars, seven-day DANA strip, chart-eligibility card on Beranda | `2026-10-01-s15-palette-and-dashboard-density.md` |
| S16 | P3 | Motion with `LazyMotion` + `domAnimation`; task-list exit/layout, flow step transitions, `+ Catat` sheet, expand/collapse, toast; one shared form submit pattern | Written when S16 starts |
| S17 | P4, P5 | `/aktivitas/laporan` with `Riwayat \| Laporan` segmented control; month report; Chart.js loaded lazily only at `md` and up and only after the threshold | Written when S17 starts |
| S18 | P6 | One-way Telegram digest at 08:00 `Asia/Jakarta`; GitHub Actions → `/api/internal/reminders`; at most one per business date; no amounts | Written when S18 starts |

Order: S15 → S16 → S17. S18 depends only on S12 and can run in parallel once its owner setup is done.

## Known design points per slice

- **S15:** Beranda's query budget (44) must not rise. The seven-day strip reuses the `DailyIncomeSummary.days` that `danaCard` already computes. The DANA settlement count comes from a `count(*) over ()` column on the existing latest-settlement query. Transfer progress uses `TargetView.version.amount` and `linked`, which `listTargets` already returns.
- **S16:** Motion must never animate amounts. Reduced motion keeps opacity only. The global CSS rule that shortens transitions stays as it is.
- **S17:** Chart.js registers only `LineController`, `BarController`, `CategoryScale`, `LinearScale`, `PointElement`, `LineElement`, `BarElement`, and `Tooltip`. The chart module is a `next/dynamic` client import gated by a `matchMedia("(min-width: 48rem)")` check, so mobile never downloads it. The page loader joins `tests/perf/query-budget.integration.test.ts`.
- **S18:** The reminder route needs owner-scoped reads without a session. Design it on the singleton `app_owner` and `withOwnerDb()` like any page loader; never grant the route `BYPASSRLS`. Store the last sent business date in a new `ops` table so retried or manual runs do not send twice. That table's migration must enable RLS, add its policies, and add its grants in the same file.

## Owner actions

1. Approve or amend PRD v0.20 P1–P6.
2. Revoke the bot token that was pasted into chat on 1 October 2026 (@BotFather → `/revoke`), then generate a new one.
3. Before S18: put the new token and the owner chat id in Vercel production env as `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, and add the GitHub Actions secret for the reminder route token.
