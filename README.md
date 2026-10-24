# GMagent114 — One Fourteen Virtual GM

A virtual operator for the recurring GM-cadence work at **One Fourteen Bar** (Louisville). Owns the nightly digest, pre-shift brief, deposit recon, weekly P&L, permits, and event lifecycle. Bartenders get clean SMS; Enzo gets one paragraph a day; nothing public, financial, legal, or staff-sensitive happens without approval.

## Stack

- **Next.js 16 + React 19** on Vercel
- **Supabase Postgres** for digest log, approval queue, permits, event runs
- **Vercel Cron** for the recurring jobs
- **Twilio SMS** for Enzo + bartenders
- **Slack** for #one-fourteen-ops mirror
- **Toast API** for sales / labor / pours
- **Anthropic Claude** for the digest writer voice

## Phase 1 — the six GM-cadence lanes

All six Phase 1 lanes are wired (not stubs). Each one runs on Vercel Cron, routes owner output through SMS + Slack, logs a `job_runs` heartbeat, and persists to its own table. The **2am digest is the trust-builder** — let it earn a week before you turn the rest loose, but the code is live for all of them.

| Lane | Route | Cron (UTC) | What it does |
|---|---|---|---|
| **Nightly digest** | `/api/gm/shift-digest` | `10 7 * * *` | Yesterday's Toast roll-up → Claude operator paragraph → voice-gated → SMS + Slack. |
| **Pre-shift brief** | `/api/gm/pre-shift` | `0 21 * * *` | Tonight's events + live weather + drink features → terse SMS to the lead bartender. |
| **Deposit recon** | `/api/gm/deposit-recon` | `30 12 * * *` | Counted cash drop vs Toast cash. >$50 flags, >$100 escalates. Never moves money. |
| **Weekly P&L** | `/api/gm/pnl-snapshot` | `0 23 * * 0` | QuickBooks rolling-7-day P&L (prime, food, bev, labor % vs prior week) + Toast cross-check → voice-gated opinion, not a dump. Prime cost >65% escalates. |
| **Permits** | `/api/gm/permits` | `0 13 * * *` | 60 / 30 / 7-day renewal reminders. 7-day is an escalation. De-duped per tier. |
| **Event lifecycle** | `/api/gm/event-lifecycle` | `0 14 * * *` | 14-day readiness check, day-of bar brief, next-day recap prompt. |

The digest pipeline:

1. Vercel Cron hits `/api/gm/shift-digest` at 07:10 UTC (~2am LV).
2. Pulls yesterday's full Toast roll-up (covers, net, comps, voids, labor, top pours).
3. Asks Claude to write the operator-voice paragraph (one paragraph, no exclamation points, name the lever).
4. Gates the paragraph through `assertVoiceRules` — bad output falls back to a deterministic mock so a hallucinated digest never ships.
5. SMS to `OWNER_PHONE` via Twilio, post to `SLACK_OPS_CHANNEL` via Slack.
6. Persists to `shift_digests` in Supabase.

### Mission Control

The home page (`/`) is the operator control plane: latest digest, recent job runs, pending approvals, and upcoming permits + events — read live from Supabase. Renders a "preview mode" banner until Supabase is configured.

## Deploy in 10 minutes

### 1. Import to Vercel

1. Go to https://vercel.com/new
2. **Import Git Repository** → pick `Chefzo/GMagent114`
3. **Framework Preset:** Next.js (auto-detected)
4. **Root Directory:** `./`
5. Don't deploy yet — set env vars first.

### 2. Add env vars in Vercel

Settings → Environment Variables. Add every row below, mark each as **Secret**, scope to **Production** + **Preview**.

| Variable | Value | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | From console.anthropic.com |
| `CLAUDE_MODEL` | `claude-sonnet-4-6` | Optional override |
| `TOAST_CLIENT_ID` | (from Toast Developer Portal) | |
| `TOAST_CLIENT_SECRET` | (rotated value) | |
| `TOAST_RESTAURANT_GUID` | `091d922b-6d79-4c41-8ceb-b05fe20db847` | |
| `SUPABASE_URL` | `https://paxwebfhozillhrdmemv.supabase.co` | |
| `SUPABASE_SERVICE_ROLE_KEY` | (from Supabase → Settings → API → service_role) | |
| `TWILIO_ACCOUNT_SID` | `AC...` | |
| `TWILIO_AUTH_TOKEN` | (Twilio Auth Token, NEVER paste in chat) | |
| `TWILIO_FROM_NUMBER` | `+15023341588` | The 502 number you bought |
| `TWILIO_MESSAGING_SERVICE_SID` | `MG...` | After A2P 10DLC approval |
| `SLACK_BOT_TOKEN` | `xoxb-...` | |
| `SLACK_OPS_CHANNEL` | `#one-fourteen-ops` | |
| `OWNER_PHONE` | `+15025550114` | E.164 format, your cell |
| `CRON_SECRET` | (generate a random string, 32+ chars) | Locks the API routes to Vercel Cron only |

A quick way to generate `CRON_SECRET` on Mac: `openssl rand -hex 24`. Paste that string.

### 3. Apply the Supabase schema

In Supabase dashboard → SQL Editor → New query → paste the contents of `supabase/schema.sql` → Run. Creates `shift_digests`, `pre_shift_briefs`, `deposit_reconciliations`, `weekly_pnl_snapshots`, `permits_licenses`, `event_runs`, plus the lane-support tables (`staff_contacts`, `events`, `permit_reminders`, `approval_queue`, `job_runs`).

Then run `supabase/seeds.sql` the same way. It seeds config (labor target, thresholds, drink features), the KY permit + license calendar, a placeholder lead bartender, and a sample event. **Edit the seeded permit renewal dates and the lead bartender phone number to the real values** — the reminders and pre-shift brief fire off whatever is in those rows.

### 4. Deploy

Back in Vercel → click **Deploy**. First build takes ~90 seconds.

### 5. Smoke test (no waiting for 2am)

Once deployed, hit the API by hand to fire a digest right now:

```
curl -X POST "https://your-vercel-url.vercel.app/api/gm/shift-digest?token=YOUR_CRON_SECRET"
```

Reads yesterday's Toast data, generates the paragraph, sends SMS to your phone, posts to Slack, persists to Supabase. Same code path Vercel Cron will hit at 2am.

### 6. Verify cron

Vercel → your project → **Crons** tab. Should show 6 entries — one per lane. All six are live; the 2am digest is the one to watch first while the rest earn trust.

## Dry-run mode

For preview deploys or local dev, set any of:

- `DIGEST_DRY_RUN=1` — uses mock writer instead of Anthropic
- `TWILIO_DRY_RUN=1` — logs SMS instead of sending
- `SLACK_DRY_RUN=1` — logs Slack post instead of sending

A smoke script is in `scripts/smoke-digest.mjs`:

```
npm install
npm run smoke        # dry-run digest, no external calls
```

Prints the paragraph + dispatch results without touching any external API.

### Tests

```
npm run typecheck    # tsc --noEmit
npm test             # voice-rule gate + lane decision logic (no network)
```

`npm test` runs `scripts/voice-rules.test.mjs` (the digest voice gate — cheesy-language, markdown, emoji, opener, and money-mention rules) and `scripts/lanes.test.mjs` (deposit variance thresholds, permit tier selection, event phase math, P&L metrics, pre-shift SMS assembly). CI (`.github/workflows/ci.yml`) runs typecheck + tests + a dry-run smoke on every push and PR.

## Voice rules

Every digest is gated through `assertVoiceRules()`:

- One paragraph (no blank lines)
- No exclamation points
- No throat-clearing openers ("Last night was…")
- ≤ 7 sentences
- ≤ 1200 chars

Bad output is replaced with the deterministic mock fallback so a model hallucination never reaches Enzo's phone.

## Approval queue, escalation, and money safety

Hardcoded in `lib/policies/escalation.ts` and `lib/policies/approvals.ts`:

- Public review responses, liquor orders, GFS orders, Sling schedules, and any vendor-facing portal submission MUST go through the approval queue.
- Financial events over $100 escalate to Enzo.
- The agent never moves money. Bookkeeping owns that.
- The agent never touches HR. Bartenders are boots on the ground.

## Data still being fed (honest caveats)

The lanes are wired, but a few depend on inputs that aren't fully plumbed yet — they degrade gracefully and say so rather than inventing numbers:

- **Deposit recon** needs the *counted* cash drop. Until the closing-checklist flow (Phase 2) or a manual entry supplies it, the lane parks an "awaiting count" row. You can pass one by hand: `?reportedCash=812.50`.
- **Weekly P&L** reads QuickBooks (`QBO_*` env). Without QBO credentials it runs in `fallback` status on zeroed stub numbers and flags the data as partial. The Toast cross-check is still the most recent day, not a full week.
- **Pre-shift** pulls live weather and the events table. The **Google Calendar** feed (`lib/integrations/googleCalendar.ts`) is optional: it returns `[]` until `GOOGLE_SERVICE_ACCOUNT_*` and `GOOGLE_CALENDAR_IDS` are set.

## Deferred to later phases

- Closing-checklist SMS enforcement, review monitoring + draft queue, maintenance routing, vendor invoice matching (Phase 2).
- Liquor / GFS / Sling draft generation and portal submission (Phases 3–4).

See `VIRTUAL-GM-SPEC.md` for the full lane-by-lane spec and `docs/RUNBOOK.md` for operating the live system.
