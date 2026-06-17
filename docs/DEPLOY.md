# Going live — setup runbook

The agent runs as five scheduled GitHub Actions workflows. Each reads its config
from **GitHub repo secrets** (Settings → Secrets and variables → Actions). This
runbook lists every secret, where its value comes from, and the one-time Google
setup. Values themselves live in the One Fourteen credentials vault — never paste
them here or into chat.

## 1. GitHub repo secrets

| Secret | Source | Used by |
|---|---|---|
| `TOAST_CLIENT_ID` | vault `toast.json` → `clientId` | ordering, weekly-report |
| `TOAST_CLIENT_SECRET` | vault `toast.json` → `clientSecret` | ordering, weekly-report |
| `TOAST_RESTAURANT_GUID` | vault `toast.json` → `restaurantGuid` | ordering, weekly-report |
| `TOAST_BASE_URL` | `https://ws-api.toasttab.com` | ordering, weekly-report |
| `AGENTMAIL_API_KEY` | vault `agentmail.json` → `apiKey` | all (email) |
| `AGENTMAIL_INBOX` | `onefourteen@agentmail.to` | all (email) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | the service-account key created in step 2 (paste full JSON) | all (Sheets/Calendar) |
| `GOOGLE_IMPERSONATE_USER` | the bar's Google account (e.g. `admin@onefourteenbar.com`) | event-reminders (Calendar) |
| `GOOGLE_CALENDAR_ID` | the events calendar id (or omit for the impersonated user's primary) | event-reminders |
| `GM_SPREADSHEET_ID` | the GM data spreadsheet id (from its URL) | all |
| `OWNER_EMAIL` | where alerts/approvals go | all |
| `SLING_API_TOKEN` | Sling admin API token (to be added) | schedule-review |
| `ANTHROPIC_API_KEY` | console.anthropic.com | `npm run chat` only (not the scheduled jobs) |

> The agent sends via **AgentMail** whenever `AGENTMAIL_API_KEY` is set; it falls
> back to Gmail only if that key is absent.

## 2. Google service account (one time)

1. In Google Cloud, create a service account in the bar's project; create a JSON
   key and download it. Paste the file's full contents into the
   `GOOGLE_SERVICE_ACCOUNT_JSON` secret.
2. Enable the **Google Sheets API** and **Google Calendar API** in that project.
3. **Sheets:** share the GM spreadsheet with the service-account email
   (`...@...iam.gserviceaccount.com`) as an Editor.
4. **Calendar:** in Workspace Admin → Security → API controls → Domain-wide
   delegation, authorize the service account's client ID for scope
   `https://www.googleapis.com/auth/calendar.readonly`, and set
   `GOOGLE_IMPERSONATE_USER` to the account whose calendar holds the events.
   (Put `headcount: 80` / `contact: …` in each event's description so the prep
   checklist is accurate.)

## 3. Verify

- **Toast:** run the `Ordering` workflow with **dry_run = false** off-hours, or
  run `npm run check:toast` from any host with open network egress — it prints
  the restaurant GUID and proves the Orders API is reachable. (The dev sandbox
  blocks `ws-api.toasttab.com`, so this must run on a real runner.)
- **Everything else:** each workflow has a **Run workflow → dry_run** button that
  exercises the logic against fixtures with no live calls or emails.

## 4. Go live

Flip each workflow from dry-run to a real run once its secrets are in place.
Nothing that spends money or messages a vendor sends without an `APPROVE` reply.
