# GMagent114 Runbook

Operating the Virtual GM once it's live on Vercel. For first-time setup, see the root `README.md`.

## The lanes and when they fire

| Lane | Cron (UTC) | ~Louisville | Output |
|---|---|---|---|
| Nightly digest | `10 7 * * *` | 2:10 am | SMS + Slack to Enzo |
| Pre-shift brief | `0 21 * * *` | 4:00 pm | SMS to lead bartender, Slack mirror |
| Deposit recon | `30 12 * * *` | 7:30 am | Slack always; SMS only on a flag/escalation |
| Weekly P&L | `0 23 * * 0` | Sun 6:00 pm | SMS + Slack to Enzo |
| Permits | `0 13 * * *` | 8:00 am | Slack for 60/30-day; SMS for 7-day + past-due |
| Event lifecycle | `0 14 * * *` | 9:00 am | Slack; SMS for 14-day readiness gaps |

(Louisville is UTC−4 in summer / −5 in winter; the UTC schedules are fixed, so the local time shifts an hour across DST.)

## Firing a lane by hand

Every route takes the cron secret as `?token=` and accepts the same call Vercel Cron makes:

```
curl -X POST "https://<app>.vercel.app/api/gm/shift-digest?token=$CRON_SECRET"
```

Useful parameters for manual runs / backfills:

- `shift-digest` — (none; always yesterday)
- `pre-shift?date=YYYY-MM-DD`
- `deposit-recon?date=YYYY-MM-DD&reportedCash=812.50`
- `pnl-snapshot?weekEnding=YYYY-MM-DD`
- `permits?today=YYYY-MM-DD` (override "now" for testing tier math)
- `event-lifecycle?today=YYYY-MM-DD`

## Recording a cash count for deposit recon

Until the closing checklist feeds it automatically, enter the counted drop one of two ways:

1. **Inline:** `curl ".../deposit-recon?token=$CRON_SECRET&date=2026-06-16&reportedCash=812.50"`
2. **In Supabase:** insert a `deposit_reconciliations` row for the business date with `actual_cash_reported` set; the next sweep reads it.

`> $50` off → flag SMS to Enzo. `> $100` off → escalation (SMS + a row in `approval_queue`). The agent never moves money.

## Maintaining the permit calendar

Permits live in `permits_licenses`. To add or update one:

```sql
update permits_licenses set renewal_date = '2027-03-01' where name = 'KY ABC license';
```

Reminders are de-duped via `permit_reminders` (one row per fired tier). If you change a renewal date and want the tiers to re-fire, delete that permit's rows from `permit_reminders`.

## Managing events

Events live in the `events` table. Set `beo_signed`, `deposit_collected`, `fnb_minimum`, and `staffing_locked` as they're completed — the 14-day check escalates whatever is still false/null. `event_runs` records each fired phase so a milestone never repeats.

## Dry-run / preview

Set any of `DIGEST_DRY_RUN`, `TWILIO_DRY_RUN`, `SLACK_DRY_RUN` to `1`. Preview deploys should always run all three. With no `CRON_SECRET` set, routes are open (acceptable only on a credential-free preview).

## When something looks wrong

- **Check `job_runs`** first — every lane logs one row per run (`job`, `status`, `summary`, `escalated`). Mission Control surfaces the last 12.
- **Digest came out generic / `status: fallback`** — Toast auth or the order pull failed; the lane used the deterministic mock. Verify `TOAST_*` env and that the restaurant GUID is right.
- **`voiceOk: false`** — Claude produced output that failed the voice gate; the deterministic mock shipped instead. Safe, but worth a look at the model output in logs.
- **No SMS** — check `TWILIO_*` env and that A2P 10DLC is approved; without it, only `TWILIO_MESSAGING_SERVICE_SID` sends reliably.
