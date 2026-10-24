-- Phase 1 starter schema
create table if not exists gm_config (
  id bigserial primary key,
  key text not null unique,
  value_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists shift_digests (
  id bigserial primary key,
  business_date date,
  summary_text text,
  payload_json jsonb not null default '{}'::jsonb,
  sent_sms_at timestamptz,
  sent_slack_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists pre_shift_briefs (
  id bigserial primary key,
  shift_date date,
  summary_text text,
  status text,
  sent_at timestamptz,
  ack_received_at timestamptz,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists deposit_reconciliations (
  id bigserial primary key,
  business_date date,
  variance_amount numeric(10,2),
  status text,
  payload_json jsonb not null default '{}'::jsonb,
  escalated_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists weekly_pnl_snapshots (
  id bigserial primary key,
  week_ending date,
  summary_text text,
  payload_json jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists permits_licenses (
  id bigserial primary key,
  name text not null,
  authority text,
  renewal_date date,
  owner text,
  status text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists event_runs (
  id bigserial primary key,
  event_key text,
  phase text,
  status text,
  payload_json jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  escalated_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Phase 1 lane support (added with the six-lane build)
-- ---------------------------------------------------------------------------

-- Roster the pre-shift brief texts. role tags: 'lead'/'lead_bartender' get the
-- nightly brief; the rest are reachable for future SMS flows.
create table if not exists staff_contacts (
  id bigserial primary key,
  name text not null,
  role text,
  phone text,
  sms_enabled boolean not null default true,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

-- Events source for the lifecycle engine (config-first; a calendar feed can
-- replace it later without changing lib/gm/eventLifecycle.ts).
create table if not exists events (
  id bigserial primary key,
  event_key text not null unique,
  name text not null,
  event_date date not null,
  headcount integer,
  contact text,
  beo_signed boolean default false,
  deposit_collected boolean default false,
  fnb_minimum numeric(10,2),
  staffing_locked boolean default false,
  status text not null default 'booked',
  created_at timestamptz not null default now()
);

-- One row per fired permit reminder tier — the dedup ledger.
create table if not exists permit_reminders (
  id bigserial primary key,
  permit_id bigint references permits_licenses(id) on delete cascade,
  days_before integer not null,
  scheduled_for date,
  sent_at timestamptz,
  status text not null default 'sent',
  created_at timestamptz not null default now()
);

-- The single approval queue. Phase 1 mostly parks escalations here for
-- awareness; Phase 2+ ordering/review drafts land here for sign-off.
create table if not exists approval_queue (
  id bigserial primary key,
  action text not null,
  summary text not null,
  payload_json jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

-- Operational heartbeat: one row per cron lane execution. Mission Control reads
-- this for "what fired, when, and what it said".
create table if not exists job_runs (
  id bigserial primary key,
  job text not null,
  status text not null,
  summary text,
  payload_json jsonb not null default '{}'::jsonb,
  escalated boolean not null default false,
  created_at timestamptz not null default now()
);

-- Columns the deposit-recon lane writes (idempotent for existing installs).
alter table deposit_reconciliations add column if not exists toast_cash_total numeric(10,2);
alter table deposit_reconciliations add column if not exists expected_card_total numeric(10,2);
alter table deposit_reconciliations add column if not exists actual_cash_reported numeric(10,2);
