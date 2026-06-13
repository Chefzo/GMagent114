# One Fourteen Virtual GM — Production Implementation Spec

## What this is

This is the operating spec for **GMagent114**: a Virtual GM layer for One Fourteen Bar.

Job:
- own the recurring GM cadence
- keep bartenders supported, not replaced
- keep Enzo out of routine bar ops
- escalate only when a real human decision is needed

Success condition:
- Enzo spends **under 15 minutes/day** on routine bar ops
- bartenders get clean SMS prompts, not chaos
- Mission Control becomes the control plane
- nothing public, financial, legal, or staff-sensitive happens without approval gates

---

## Operator brief

**Role:** One Fourteen Virtual GM

**Voice:** operator-direct. Name the lever, not the spreadsheet.

**Non-negotiables:**
- never place an order without Enzo approval
- never publish a schedule without Enzo approval
- never post a public review response without Enzo approval
- never move money
- never drift into HR
- bartenders are boots on the ground; the system supports judgment, it does not replace it
- staff-facing comms are SMS only
- vendor-facing email signs `One Fourteen Operations`

**Escalate immediately when:**
- anything financial is over `$100`
- anything operational touches the guest
- anything legal / permit / license related is at risk

---

## Primary systems

### Control plane
- **Mission Control** (`onefourteenops.com`)
- houses automations, approvals, logs, queue state, dashboards, escalation views

### Data systems
- **Toast** — sales, labor, checks, comps, voids, dayparts, top pours
- **Supabase** — config tables, pars, POs, order drafts, approval states, permits, vendors, issue logs
- **Google Calendar** — events, reservations, event milestones, permit calendar
- **Google Drive** — photo intake, archive, supporting docs
- **Slack** — owner / ops team notifications only
- **Twilio SMS** — all bartender and Enzo text workflows
- **Email inbox** — invoice intake + permit notices + vendor replies

### Human-facing channels
- **Enzo:** SMS first, Slack second, Mission Control dashboard always available
- **Bartenders:** SMS only
- **Taylor:** Slack DM + Notion page or equivalent doc handoff
- **Vendors:** email automation only, signed `One Fourteen Operations`

---

## Core architecture

## 1. Event bus
Every automation should emit events:
- `shift.closed`
- `shift.digest.generated`
- `pre_shift.brief.sent`
- `review.negative.detected`
- `checklist.missed`
- `deposit.variance.detected`
- `liquor_order.draft_ready`
- `gfs_order.draft_ready`
- `schedule.draft_ready`
- `vendor_invoice.variance_detected`
- `permit.reminder_due`
- `maintenance.ticket_opened`
- `maintenance.ticket.escalated`

## 2. Approval queue
Anything gated lands in one queue with status:
- `draft`
- `pending_approval`
- `approved`
- `rejected`
- `sent`
- `failed`
- `escalated`

Approval-required objects:
- public review responses
- liquor orders
- GFS orders
- Sling schedule drafts
- vendor-facing portal submissions

## 3. Config-first rules
Do not hardcode ops rules into workflow logic when they can live in config.

Use Supabase tables for:
- labor target
- prime cost target
- staffing rules by daypart
- par levels by SKU
- vendor routing rules
- permit/renewal dates
- escalation thresholds
- review response tone templates
- bartender roster + phone numbers + role tags

---

## Supabase schema

## tables

### `gm_config`
Generic key/value config store.

Fields:
- `id`
- `key`
- `value_json`
- `updated_at`

Examples:
- `labor_target_pct = 27`
- `deposit_variance_threshold = 50`
- `financial_escalation_threshold = 100`

### `staff_contacts`
Fields:
- `id`
- `name`
- `role`
- `phone`
- `sms_enabled`
- `active`
- `notes`

### `bartender_checklists`
Fields:
- `id`
- `name`
- `shift_type` (`close`, `open`, `event_close`)
- `items_json`
- `active`

### `shift_digests`
Fields:
- `id`
- `business_date`
- `toast_sales_json`
- `toast_labor_json`
- `summary_text`
- `sent_sms_at`
- `sent_slack_at`
- `anomaly_flag`

### `pre_shift_briefs`
Fields:
- `id`
- `shift_date`
- `lead_bartender_id`
- `summary_text`
- `sent_at`
- `ack_received_at`
- `ack_message_id`
- `status`

### `review_queue`
Fields:
- `id`
- `source` (`google`,`yelp`,`instagram`)
- `author_name`
- `rating`
- `review_text`
- `detected_at`
- `draft_response`
- `approval_status`
- `posted_at`
- `escalated_at`

### `closing_checklist_runs`
Fields:
- `id`
- `business_date`
- `bartender_id`
- `checklist_id`
- `status`
- `responses_json`
- `photo_urls_json`
- `missing_items_json`
- `escalated_at`

### `deposit_reconciliations`
Fields:
- `id`
- `business_date`
- `toast_cash_total`
- `expected_card_total`
- `actual_cash_reported`
- `variance_amount`
- `status`
- `escalated_at`

### `inventory_par_levels`
Fields:
- `id`
- `sku`
- `display_name`
- `category` (`liquor`,`beer`,`wine`,`food`,`na`)
- `vendor_id`
- `par_level`
- `reorder_unit`
- `active`

### `inventory_photo_runs`
Fields:
- `id`
- `business_date`
- `category` (`liquor`,`food`)
- `photo_urls_json`
- `vision_output_json`
- `status`
- `review_notes`

### `order_drafts`
Fields:
- `id`
- `order_type` (`liquor`,`gfs`)
- `vendor_id`
- `business_week`
- `lines_json`
- `approval_status`
- `approval_link_token`
- `approved_at`
- `submitted_at`
- `submission_status`
- `fallback_text`

### `schedule_rules`
Fields:
- `id`
- `day_of_week`
- `daypart`
- `rule_json`
- `active`

Examples:
- Fri/Sat after 9pm = 2 bartenders
- Tuesday closed
- Sunday brunch = 1 bartender + 1 barback

### `schedule_drafts`
Fields:
- `id`
- `week_of`
- `draft_json`
- `approval_status`
- `approved_at`
- `published_at`
- `publish_status`

### `variance_reports`
Fields:
- `id`
- `week_ending`
- `category`
- `report_json`
- `summary_text`
- `sent_slack_at`

### `content_briefs`
Fields:
- `id`
- `week_of`
- `brief_text`
- `notion_url`
- `slack_sent_at`

### `weekly_pnl_snapshots`
Fields:
- `id`
- `week_ending`
- `sales_json`
- `labor_json`
- `cost_json`
- `summary_text`
- `sent_at`

### `event_runs`
Fields:
- `id`
- `event_id`
- `phase` (`14_day`,`4_hour`,`24_hour_recap`)
- `status`
- `payload_json`
- `sent_at`
- `escalated_at`

### `vendor_invoices`
Fields:
- `id`
- `vendor_name`
- `invoice_number`
- `invoice_date`
- `total_amount`
- `ocr_json`
- `matched_order_id`
- `variance_amount`
- `short_qty_flag`
- `status`
- `escalated_at`
- `bookkeeping_routed_at`

### `permits_licenses`
Fields:
- `id`
- `name`
- `authority`
- `renewal_date`
- `owner`
- `status`
- `notes`

### `permit_reminders`
Fields:
- `id`
- `permit_id`
- `days_before`
- `scheduled_for`
- `sent_at`
- `status`

### `maintenance_tickets`
Fields:
- `id`
- `reported_by_staff_id`
- `channel` (`sms`)
- `category`
- `description`
- `vendor_id`
- `status`
- `opened_at`
- `last_vendor_contact_at`
- `escalated_at`
- `resolved_at`

### `vendors`
Fields:
- `id`
- `name`
- `category`
- `contact_name`
- `contact_email`
- `contact_phone`
- `portal_url`
- `notes`
- `active`

---

## Automation spec by lane

## 1. Daily Toast end-of-shift digest

### trigger
- cron: `2:00 AM America/Louisville`
- fallback: run when Toast close-of-day is available

### inputs
- Toast sales summary
- labor summary
- top items / top pours
- comps
- voids
- AOV
- prime cost trend inputs if available

### output
- one paragraph SMS to Enzo
- one paragraph Slack post to `#one-fourteen-ops`

### format
- operator voice
- one thing that matters
- no bullet spam

### escalation
- labor above target materially
- comp spike
- void spike
- abnormal sales drop
- major cash issue

### blocker
- if Toast sync fails, send `data missing` alert by 7 AM

---

## 2. Daily pre-shift brief

### trigger
- `doors_open_time - 4 hours`

### inputs
- reservations on books
- calendar events tonight
- weather
- drink features / pours to push
- staffing
- known issues

### output
- SMS to lead bartender
- requires thumbs-up receipt acknowledgment

### escalation
- no acknowledgment within 30 minutes
- shift has missing staff / event risk / weather disruption

---

## 3. Daily review monitoring

### trigger
- every hour

### sources
- Google reviews
- Yelp
- Instagram tags / mentions

### logic
- if rating `< 3` → escalate to Enzo within 1 hour with draft response
- if rating `>= 3` → queue response within 24 hours

### approval gate
- **all public responses require Enzo approval** per spec

### note
- if you later want auto-post for 4-star and 5-star, that is a policy change, not default

---

## 4. End-of-shift checklist enforcement

### trigger
- at close / after shift end

### flow
- send checklist to closing bartender by SMS
- bartender replies item by item
- require photo on:
  - cash drop
  - back-bar reset

### escalation
- missing item
- no response
- missing photo
- suspicious mismatch in cash/drop

---

## 5. Deposit reconciliation

### trigger
- same morning after Toast close and bartender confirmation land

### logic
- compare Toast close-of-day totals to expected cash + card settlement
- variance > `$50` → same-morning flag to Enzo
- variance > `$100` → escalation lane

---

## 6. Weekly liquor order

### trigger
- Monday AM

### inputs
- Friday-night back-bar photo
- vision bottle count parse
- Supabase par levels
- vendor maps

### output
- RNDC order draft
- craft distributor order draft
- SMS approve / edit link to Enzo

### approval gate
- must be approved before submission

### fallback
- if portal automation fails, send manual order list to Enzo

---

## 7. Weekly GFS food order

### trigger
- Tuesday AM

### same pattern as liquor
- photo ingest
- compare to pars
- generate draft
- approval gate
- portal submit if approved
- manual fallback if portal fails

---

## 8. Weekly Sling schedule draft

### trigger
- Tuesday AM

### inputs
- rolling 4-week Toast sales by daypart
- staffing rules from config
- Sling availability

### output
- draft schedule
- SMS approval request to Enzo

### approval gate
- publish only after explicit approval

### post-approval action
- publish to Sling
- notify staff via Sling native push

---

## 9. Weekly back-bar variance

### trigger
- Saturday AM

### inputs
- Friday-night photo
- POS pour data

### output
- top 5 shrink / over-pour SKUs
- Slack post to `#one-fourteen-ops`
- operator commentary line

### escalation
- unusual shrink on high-value SKU
- repeated shortage week-over-week

---

## 10. Weekly content brief to Taylor

### trigger
- Friday AM

### inputs
- next week events
- menu changes
- drink features
- reservations of note

### output
- shoot-ready brief
- Slack DM to Taylor
- Notion page or doc link

### tone
- dark editorial
- all-caps headlines
- no exclamation points

---

## 11. Weekly P&L snapshot

### trigger
- Sunday PM

### output to Enzo
- labor %
- food cost %
- beverage cost %
- prime cost vs target
- top 3 movers
- top 3 laggards
- 2-3 levers worth pulling this week

### rule
- opinion, not raw dump

---

## 12. Event lifecycle

### 14 days out
- BEO signed
- deposit collected
- F&B minimum confirmed
- staffing locked

### 4 hours out
- bartender brief
- timeline
- guest count
- F&B minimum
- point of contact

### 24 hours after
- recap actuals vs minimum
- tip pool
- anomalies
- lessons

### escalation
- missing deposit
- unsigned BEO
- staffing gap
- guest-impacting ops risk

---

## 13. Vendor invoice matching

### trigger
- new inbound invoice email to dedicated agent inbox

### flow
- OCR invoice
- match against PO / order in Supabase
- clean match → log and route to bookkeeping
- variance > `$25` or short quantity → flag Enzo

### note
- this does not pay bills
- bookkeeping owns payment

---

## 14. License + permit calendar

### tracked items
- KY ABC
- food permit
- BMI / ASCAP
- liquor liability
- health department
- fire inspection

### reminders
- 60 days
- 30 days
- 7 days

### rule
- 7-day reminder is an escalation, not a casual notification

---

## 15. Maintenance log

### intake
- bartender SMS report
- examples: ice machine, glassware, POS, draft system, walk-in temp

### flow
- classify issue
- route to correct vendor
- log ticket
- track open state

### escalation
- anything open > 48 hours
- anything that touches guest service immediately

---

## SMS rules

### bartender SMS
Must be:
- short
- shift-relevant
- no long paragraphs
- no “AI” voice
- no pretending to be a person with a name

### Enzo SMS
Must be:
- one paragraph
- operator opinion
- name the lever
- if action is needed, make it obvious in one line

---

## Approval design

## approval surfaces
- SMS approve / edit link
- Mission Control approvals queue
- optional Slack mirror for awareness only

## approval objects
- review responses
- liquor orders
- food orders
- schedule drafts
- vendor portal submissions

## approval states
- `pending`
- `approved`
- `edited`
- `rejected`
- `expired`

---

## Build order

## Phase 1 — GM heartbeat
Ship first.

1. Toast end-of-shift digest
2. Pre-shift brief
3. Deposit reconciliation
4. Weekly P&L snapshot
5. Event lifecycle reminder engine
6. License + permit reminder engine

**Why first:**
- highest owner leverage
- lowest automation risk
- no public posting
- no ordering automation yet

## Phase 2 — compliance + enforcement
7. Closing checklist enforcement
8. Review monitoring + draft queue
9. Maintenance log + vendor routing
10. Vendor invoice matching

**Why second:**
- operationally valuable
- still mostly queue / escalation based
- approval gates are easy to keep clean

## Phase 3 — draft generation engines
11. Liquor draft order
12. GFS draft order
13. Sling schedule draft
14. Weekly variance report
15. Taylor content brief

**Why third:**
- more dependencies
- heavier integrations
- bigger consequence if wrong

## Phase 4 — portal automation
16. RNDC portal submit
17. GFS portal submit
18. Sling publish after approval

**Why last:**
- external write actions
- requires stable drafts and stable approvals first

---

## Required integrations checklist

## already likely available / partially available
- Toast
- Google Calendar
- Slack
- Google Drive
- Mission Control

## needed to complete spec
- Twilio SMS
- Supabase
- Review source connectors (Google / Yelp / Instagram tags)
- dedicated invoice inbox ingestion
- OCR pipeline
- vision pipeline for bottle counts
- Sling integration
- vendor portal automation runner
- bookkeeping routing target
- Notion or equivalent brief destination for Taylor

---

## Repo structure recommendation

```txt
/app
  /api
    /gm
      /shift-digest
      /pre-shift
      /reviews
      /closing-checklist
      /deposit-recon
      /liquor-order
      /gfs-order
      /schedule-draft
      /variance-report
      /content-brief
      /pnl-snapshot
      /event-lifecycle
      /invoice-match
      /permits
      /maintenance
/lib
  /gm
    digest.ts
    preShift.ts
    reviews.ts
    checklist.ts
    depositRecon.ts
    inventoryVision.ts
    orderDraft.ts
    scheduleDraft.ts
    variance.ts
    contentBrief.ts
    pnl.ts
    eventLifecycle.ts
    invoiceMatch.ts
    permits.ts
    maintenance.ts
  /integrations
    toast.ts
    twilio.ts
    slack.ts
    supabase.ts
    drive.ts
    googleCalendar.ts
    sling.ts
    reviews.ts
    ocr.ts
    vision.ts
    email.ts
  /policies
    approvals.ts
    escalation.ts
    thresholds.ts
/supabase
  schema.sql
  seeds.sql
/docs
  VIRTUAL-GM-SPEC.md
  RUNBOOK.md
  ESCALATION-POLICY.md
```

---

## First tickets to create

1. Set up Supabase schema for GMagent114
2. Add Twilio SMS integration
3. Build Toast nightly digest job
4. Build pre-shift brief job + acknowledgment tracking
5. Build deposit reconciliation job
6. Build permits / reminders engine
7. Build Mission Control approvals queue objects for GM actions
8. Build closing checklist SMS flow
9. Build review intake + approval queue
10. Build maintenance SMS intake + routing

---

## Final operator call

This system should act like a **tight GM cadence engine**, not a magic robot manager.

If it does three things well, it wins:
- sees problems early
- asks for approval only when it should
- keeps bartenders and Enzo from chasing routine crap

If it gets noisy, vague, or too autonomous, it fails.
