# GM Agent — Google Sheets schema

One spreadsheet (its ID goes in `GM_SPREADSHEET_ID`). Create these tabs with
**exactly these header rows** (row 1). The agent reads/writes by header name, so
column order can change but the names must match. You and staff can edit any
cell by hand on a phone — the agent treats the Sheet as the source of truth.

---

## Config
Key/value settings plus vendor definitions.

| key | value |
|---|---|
| barName | 114 |
| ownerEmail | you@example.com |
| orderDays | Mon,Thu |
| vendor:gfs | Gordon Food Service\|rep@gfs.com\|gfs-orderguide |
| vendor:breakthru | Breakthru Beverage\|orders@breakthru.com\|email |
| overtimeThreshold | 40 |
| defaultHourlyWage | 18 |
| weeklyLaborBudget | 1300 |
| wage:Alex | 20 |

Vendor rows use key `vendor:<key>` and value `Name|email|channel`, where
`channel` is `email` or `gfs-orderguide`.

Scheduling settings (all optional, used by the scheduling module):
`overtimeThreshold` (weekly hours, default 40), `defaultHourlyWage` (default 15),
`weeklyLaborBudget` (a $ cap; a projection over it is flagged), and per-bartender
wage overrides as `wage:<bartender name>`.

## ParLevels
The target stock and reorder trigger per item.

`item | category | unit | par | reorderPoint | vendor`

- `category`: liquor | beer | wine | food | other
- `vendor`: a vendor `<key>` from Config
- when on-hand ≤ `reorderPoint`, the agent orders up to `par`

## Inventory
Current on-hand counts (agent updates this from Toast depletion / counts).

`item | onHand | lastCounted | location`

## VendorCatalog
How each item is ordered from its vendor.

`vendor | item | sku | packSize | lastPrice`

- `packSize`: units per orderable pack/case
- `lastPrice`: price per pack (used for the order estimate)

## OrderHistory
Appended by the agent when an order is sent.

`timestamp | vendor | items | estTotal | status`

## Events
Events live in **Google Calendar** (the source of truth) — the events module
reads bookings from there, not from a Sheet tab. Put `headcount: 80` and
`contact: …` in the calendar event's description and the agent will pick them up
for the prep checklist. Set `GOOGLE_CALENDAR_ID` if it isn't the impersonated
user's primary calendar.

## Schedule  (used by the scheduling module)
`date | bartender | start | end | position | source`

Live shifts are read from Sling; this tab mirrors them for reference/manual edits.

## Coverage  (used by the scheduling module)
Minimum staffing per daypart. Absent tab => coverage-gap checks are skipped.

`day | minBartenders | startHour | endHour`

- `day`: a name (`Mon`) or number (`0`=Sun … `6`=Sat)
- `startHour`/`endHour`: 24h local hours, e.g. `18` and `24`
