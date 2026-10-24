# Escalation & Approval Policy

The hard rules the Virtual GM operates under. These live in code
(`lib/policies/escalation.ts`, `lib/policies/approvals.ts`) and config
(`gm_config`), not in prose — this doc is the human-readable mirror.

## Non-negotiables

- **Never moves money.** Deposit recon surfaces a gap; bookkeeping owns payment.
- **Never publishes** a schedule, places an order, or posts a public review response without Enzo's explicit approval.
- **Never touches HR.** Bartenders are boots on the ground; the system supports judgment, it doesn't replace it.
- **Staff-facing comms are SMS only.** Vendor-facing email signs *One Fourteen Operations*.

## Escalation thresholds (`lib/policies/escalation.ts`)

| Trigger | Threshold | Action |
|---|---|---|
| Cash variance (deposit recon) | `> $50` | Flag to Enzo by SMS |
| Cash variance (deposit recon) | `> $100` | Escalate: SMS + `approval_queue` row |
| Any financial event | `> $100` | Escalate immediately |
| Permit / license renewal | `7 days` out or past due | Escalate to Enzo by SMS |
| Permit / license renewal | `60` / `30` days | Awareness post to ops channel |
| Event readiness (14 days out) | any of BEO / deposit / F&B min / staffing missing | Escalate to Enzo by SMS |
| Maintenance ticket (Phase 2) | open `> 48h` or guest-impacting | Escalate |

Thresholds are also mirrored in `gm_config` (`deposit_variance_threshold`, `financial_escalation_threshold`, `labor_target_pct`) so they can be tuned without a deploy.

## What requires approval before it goes out (`APPROVAL_GATED_ACTIONS`)

- Public review responses
- Liquor orders
- GFS food orders
- Sling schedule publishes
- Any vendor-facing portal submission

Phase 1 lanes are read-and-notify, so the queue mostly holds **escalations parked for awareness** today. The gated draft objects above arrive with the Phase 2–4 lanes. Approval states: `pending` → `approved` / `edited` / `rejected` / `expired` → `sent`.

## Routing

- **Enzo:** SMS first, Slack `#one-fourteen-ops` mirror second, Mission Control always available.
- **Bartenders:** SMS only — short, shift-relevant, no AI voice, no fake persona.
- **Ops channel:** awareness log; not an approval surface on its own.
