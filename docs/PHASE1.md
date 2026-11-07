# Phase 1 Scope — status

All six Phase 1 lanes are wired on the Next.js + Supabase + Vercel Cron stack.

| Lane | Status | Notes |
|---|---|---|
| Toast end-of-shift digest | ✅ live | Live Toast pull → Claude → voice gate → SMS/Slack → `shift_digests`. |
| Pre-shift brief | ✅ live | Live weather + events table + features → bartender SMS. Google Calendar feed optional (needs `GOOGLE_*`). |
| Deposit reconciliation | ✅ live | Toast cash vs counted drop. Needs the counted figure (inline param or `actual_cash_reported`). |
| Weekly P&L snapshot | ✅ live | QuickBooks P&L (prime/food/bev/labor %) + Toast cross-check → `weekly_pnl_snapshots`. |
| Permit reminders | ✅ live | 60/30/7-day tiers, de-duped, 7-day escalates. Seed real renewal dates. |
| Event lifecycle | ✅ live | 14-day / day-of / recap off the `events` table. |

Shared infrastructure added with the build:

- `lib/gm/notify.ts` — unified SMS + Slack dispatch.
- `lib/gm/jobLog.ts` — `job_runs` heartbeat per lane execution.
- `lib/gm/approvalQueue.ts` — the single approval/escalation queue.
- `lib/integrations/anthropic.ts` — one Claude call site for all writers.
- `lib/integrations/weather.ts` — Open-Meteo, no key.
- Mission Control dashboard (`app/page.tsx`) reading all of the above from Supabase.

Rule that still governs everything: keep every external write behind explicit approval gates, and never move money.

See `RUNBOOK.md` to operate it and `ESCALATION-POLICY.md` for the thresholds.
