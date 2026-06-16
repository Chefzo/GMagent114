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

## Phase 1 — what ships first

**Only the 2am EOD digest.** Everything else is scaffolded but doesn't fire until the digest has been earning trust for 7 nights.

Pipeline:

1. Vercel Cron hits `/api/gm/shift-digest` at 07:10 UTC (~2am LV).
2. Pulls yesterday's full Toast roll-up (covers, net, comps, voids, labor, top pours).
3. Asks Claude to write the operator-voice paragraph (one paragraph, no exclamation points, name the lever).
4. Gates the paragraph through `assertVoiceRules` — bad output falls back to a deterministic mock so a hallucinated digest never ships.
5. SMS to `OWNER_PHONE` via Twilio, post to `SLACK_OPS_CHANNEL` via Slack.
6. Persists to `shift_digests` in Supabase.

## Deploy in 10 minutes

### 1. Import to Vercel

1. Go to https://vercel.com/new
2. **Import Git Repository** → pick `Chefzo/GMagent114`
3. **Framework Preset:** Next.js (auto-detected)
4. **Root Directory:** `./`
5. Don't deploy yet — set env vars first.

### 2. Add env vars in Vercel

Settings → Environment Variables. Add every row below, mark each as **Secret**, scope to **Production** + **Preview**. **Never commit real values to git** — use Vercel's env UI only. See `.env.example` for the full list of variable names.

| Variable | Where to get it | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com | `sk-ant-...` |
| `CLAUDE_MODEL` | optional override | default `claude-sonnet-4-6` |
| `TOAST_CLIENT_ID` | Toast Developer Portal | |
| `TOAST_CLIENT_SECRET` | Toast Developer Portal | rotate any value that ever touched chat/git |
| `TOAST_RESTAURANT_GUID` | Toast Web → Settings → Restaurant Info | UUID format |
| `SUPABASE_URL` | Supabase → Settings → API | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role | never expose client-side |
| `TWILIO_ACCOUNT_SID` | Twilio Console | `AC...` |
| `TWILIO_AUTH_TOKEN` | Twilio Console | rotate after any chat/git exposure |
| `TWILIO_FROM_NUMBER` | Twilio purchased number | E.164 format |
| `TWILIO_MESSAGING_SERVICE_SID` | Twilio Messaging Service | `MG...`, after A2P 10DLC approval |
| `SLACK_BOT_TOKEN` | Slack App → OAuth & Permissions | `xoxb-...` |
| `SLACK_OPS_CHANNEL` | Slack channel name | default `#one-fourteen-ops` |
| `OWNER_PHONE` | Enzo's cell | E.164 format |
| `CRON_SECRET` | generated locally | 32+ char random string |

Generate `CRON_SECRET` locally: `openssl rand -hex 24`.

> **Secret hygiene:** if any production secret has ever appeared in a README, README diff, commit message, chat transcript, screenshot, or screen recording — rotate it. Cheap. Five minutes. Do it now.

### 3. Apply the Supabase schema

In Supabase dashboard → SQL Editor → New query → paste the contents of `supabase/schema.sql` → Run. Creates `shift_digests`, `pre_shift_briefs`, `deposit_reconciliations`, `weekly_pnl_snapshots`, `permits_licenses`, `event_runs`, and a few more.

### 4. Deploy

Back in Vercel → click **Deploy**. First build takes ~90 seconds.

### 5. Smoke test (no waiting for 2am)

Once deployed, hit the API by hand to fire a digest right now:

```
curl -X POST "https://your-vercel-url.vercel.app/api/gm/shift-digest?token=YOUR_CRON_SECRET"
```

Reads yesterday's Toast data, generates the paragraph, sends SMS to your phone, posts to Slack, persists to Supabase. Same code path Vercel Cron will hit at 2am.

### 6. Verify cron

Vercel → your project → **Crons** tab. Should show 6 entries. The 2am digest is the only one that does anything real today — the rest are scaffolded.

## Dry-run mode

For preview deploys or local dev, set any of:

- `DIGEST_DRY_RUN=1` — uses mock writer instead of Anthropic
- `TWILIO_DRY_RUN=1` — logs SMS instead of sending
- `SLACK_DRY_RUN=1` — logs Slack post instead of sending

A smoke script is in `scripts/smoke-digest.mjs`:

```
npm install
npx tsx scripts/smoke-digest.mjs
```

Prints the paragraph + dispatch results without touching any external API.

## Voice rules

Every digest is gated through `assertVoiceRules()`:

- One paragraph (no blank lines)
- No exclamation points
- No throat-clearing openers ("Last night was…", "Yesterday we…")
- No cheesy hospitality language ("crushed it", "guests had a wonderful time", "rockstars", "team killed it")
- No emojis
- No markdown formatting
- ≤ 7 sentences
- ≤ 1200 chars
- Must contain a net sales reference (so the digest is never just vibes)

Bad output is replaced with the deterministic mock fallback so a model hallucination never reaches Enzo's phone.

Voice rules are unit-tested. CI runs `npm test` on every push and PR — see `.github/workflows/voice-rules.yml`. Tighten a rule, add a test case, ship.

## Approval queue, escalation, and money safety

Hardcoded in `lib/policies/escalation.ts` and `lib/policies/approvals.ts`:

- Public review responses, liquor orders, GFS orders, Sling schedules, and any vendor-facing portal submission MUST go through the approval queue.
- Financial events over $100 escalate to Enzo.
- The agent never moves money. Bookkeeping owns that.
- The agent never touches HR. Bartenders are boots on the ground.

## What's stubbed (Phase 2+)

- Pre-shift bartender brief (`/api/gm/pre-shift`) — pulls events, weather, staffing. Stub today.
- Deposit reconciliation (`/api/gm/deposit-recon`) — Toast close vs. expected cash + card. Stub today.
- Weekly P&L snapshot (`/api/gm/pnl-snapshot`) — Sunday 6pm operator-voice paragraph. Stub today.
- Permit reminder engine (`/api/gm/permits`) — KY ABC, BMI/ASCAP, liq liability, food permit. Stub today.
- Event lifecycle (`/api/gm/event-lifecycle`) — 14-day, day-of, post-event. Stub today.

These ship after the EOD digest earns 7 nights of trust.
