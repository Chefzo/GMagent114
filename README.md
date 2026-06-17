# GM Agent for "114"

An autonomous **General Manager agent** for the bar *114*. It does the recurring
admin work a human GM would — starting with **ordering** (liquor, beer, wine, and
GFS food) — so you can run on bartenders alone and focus elsewhere.

It runs **mostly automatically and pings you only for decisions**: on each order
morning it checks what sold (Toast), updates back-bar counts, builds the reorder
lists, and emails you the proposed orders. Nothing is purchased until you reply
**APPROVE**.

---

## What it does today (v1)

**Ordering, end to end:**
1. Pulls sales/depletion from **Toast POS** (direct API) since the last order.
2. Updates the **Inventory** in your Google Sheet.
3. Builds a reorder list per vendor — orders items at/below their reorder point
   up to par, rounded to whole cases/packs.
4. Emails you **one approval summary** with the math and an estimated total.
5. On your reply (`APPROVE ALL` / `APPROVE GFS` / `SKIP`), sends the vendor
   orders (GFS also gets an order-guide CSV) and logs them to OrderHistory.

**Inventory counting (built):**
- A scheduled **count reminder** emails staff a category-ordered checklist
  ([`inventory-reminder`](.github/workflows/inventory-reminder.yml) workflow).
- Staff reply with the numbers; the chat agent's `record_count` tool writes them
  to the Inventory tab (counts become the source of truth) and reports
  **variance** vs. the theoretical on-hand sales implied — flagging likely
  over-pours/shrinkage (SHORT) or unlogged receipts (OVER).

**Scheduling review (built):**
- A weekly job reads next week's published **Sling** shifts and emails the owner
  a review ([`schedule-review`](.github/workflows/schedule-review.yml) workflow):
  **coverage gaps** (below the minimum bartenders for a daypart), **overtime
  risk** (anyone over the weekly threshold), and **projected labor cost** vs. a
  budget. Read-only — drafting/pushing a schedule back to Sling stays
  approval-gated.

**Weekly GM report (built):**
- A Monday-morning job emails the owner the week's digest
  ([`weekly-report`](.github/workflows/weekly-report.yml) workflow): **sales vs
  last week**, **labor %**, **pour cost %**, **top/slow movers**, and **what was
  ordered** — synthesized from Toast, the week's shifts, and OrderHistory.

**Events (built):**
- A daily job reads upcoming bookings from **Google Calendar** (the source of
  truth for events) and emails the owner a **prep checklist** per booking —
  staffing (≈1 bartender / 50 guests) and stock prep scaled to headcount
  ([`event-reminders`](.github/workflows/event-reminders.yml) workflow).
  Headcount/contact are parsed from each event's description
  (`headcount: 80`, `contact: …`).

All five modules are built. See `src/modules/`.

### How the integrations actually connect
| System | How | Notes |
|---|---|---|
| Toast POS | Direct API | Request "Standard API Access" from your Toast rep (longest lead time). |
| Sling | Direct API | Admin API token — quick. Used by the scheduling module. |
| GFS / liquor | Email + order-guide CSV | No single-store order API exists, so orders are auto-drafted and sent on your approval (this is also the money-safety gate). |
| Google Sheets / Gmail | Direct API | Data backbone + approval/order emails. |
| Google Calendar | Direct API | Source of truth for events; read for prep reminders. |

---

## Try it right now (no credentials needed)

```bash
npm install
npm run ordering -- --dry-run   # runs against sample data, sends no email
npm test                        # unit + end-to-end tests
```

The dry-run prints the exact approval email you'd receive on an order morning.

---

## Going live — setup checklist

1. **Build the Google Sheet.** Create one spreadsheet with the tabs/columns in
   [`config/sheets.schema.md`](config/sheets.schema.md) and fill in your par
   levels, current counts, vendors, and catalog SKUs.
2. **Get credentials** (copy `.env.example` to `.env` and fill in):
   - **Anthropic API key** (for the chat agent).
   - **Toast**: ask your Toast rep to enable *Standard API Access* → client ID,
     secret, restaurant GUID. *(Start this first — it can take days/weeks.)*
   - **Sling**: an admin API token (or `SLING_EMAIL`/`SLING_PASSWORD`) for the
     scheduling review.
   - **Google service account**: create one, download its JSON key, and share
     the spreadsheet with the service-account email. For sending email + reading
     the calendar, enable domain-wide delegation (scopes: `gmail.send`,
     `calendar.readonly`) and set `GOOGLE_IMPERSONATE_USER` to your bar's Google
     account.
   - `OWNER_EMAIL`, `GM_SPREADSHEET_ID`, and (optional) `GOOGLE_CALENDAR_ID`
     (defaults to the impersonated user's primary calendar).
3. **Verify read-only** before enabling sends:
   ```bash
   npm run ordering -- --dry-run         # math + draft email, still no sends
   ```
   Then a real run (`npm run ordering`) emails *you* the approval — no vendor
   email goes out until you approve.
4. **Schedule it.** Add each `.env` value as a **GitHub repo secret**
   (Settings → Secrets and variables → Actions), then the
   [`ordering`](.github/workflows/ordering.yml) workflow runs on your order
   days. Use the Actions tab's **Run workflow** button (with *dry run* checked)
   to test the scheduler first.

> If Toast access is still pending, the ordering math will run off your manual
> Inventory counts until Toast comes online — nothing is blocked.

---

## Chat with the agent

```bash
npm run chat                 # live (needs ANTHROPIC_API_KEY + Google/Toast)
npm run chat -- --dry-run    # against sample data
```
Ask things like *"what would the order look like this week?"* or *"what's below
par?"*.

---

## Project layout

```
src/
  agent/     persona.ts (system prompt), chat.ts (talk to it)
  tools/     toast, sling, googleSheets, gmail, gfs clients + mock fixtures
  modules/   ordering, inventory, scheduling, reporting, events (all built)
  jobs/      runOrdering, runInventoryReminder, runScheduleReview, runWeeklyReport, runEventReminders, checkToast
  lib/       auth, config, approval, types, logger
config/      sheets.schema.md — the Google Sheets layout
.github/workflows/  ordering, inventory-reminder, schedule-review, weekly-report, event-reminders
test/        fixtures + tests
```

## Safety notes
- **Nothing is ordered without your explicit `APPROVE` reply.**
- Secrets live only in `.env` (gitignored) or GitHub repo secrets — never committed.
- `--dry-run` touches no network and sends no email.
