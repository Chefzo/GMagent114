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

-- Lock every table to the public API keys. The app only talks to Supabase from
-- the server with the service-role key, which skips these locks, so no
-- policies are needed.
alter table gm_config enable row level security;
alter table shift_digests enable row level security;
alter table pre_shift_briefs enable row level security;
alter table deposit_reconciliations enable row level security;
alter table weekly_pnl_snapshots enable row level security;
alter table permits_licenses enable row level security;
alter table event_runs enable row level security;
