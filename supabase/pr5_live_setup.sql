-- One-time setup of the live database for PR #5 (feat/phase1-all-lanes).
-- Paste into Supabase dashboard -> SQL Editor -> Run. Safe to run before or
-- after merging: every statement is "if not exists", and main's current code
-- doesn't touch these tables.
--
-- It is PR #5's supabase/schema.sql additions, plus row-level security on the
-- new tables so only the app's server (service-role key) can reach them.
-- It deliberately skips supabase/seeds.sql: those permit renewal dates are
-- placeholders and would fire reminders for dates that aren't real.

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

create table if not exists permit_reminders (
  id bigserial primary key,
  permit_id bigint references permits_licenses(id) on delete cascade,
  days_before integer not null,
  scheduled_for date,
  sent_at timestamptz,
  status text not null default 'sent',
  created_at timestamptz not null default now()
);

create table if not exists approval_queue (
  id bigserial primary key,
  action text not null,
  summary text not null,
  payload_json jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists job_runs (
  id bigserial primary key,
  job text not null,
  status text not null,
  summary text,
  payload_json jsonb not null default '{}'::jsonb,
  escalated boolean not null default false,
  created_at timestamptz not null default now()
);

alter table deposit_reconciliations add column if not exists toast_cash_total numeric(10,2);
alter table deposit_reconciliations add column if not exists expected_card_total numeric(10,2);
alter table deposit_reconciliations add column if not exists actual_cash_reported numeric(10,2);

alter table staff_contacts   enable row level security;
alter table events           enable row level security;
alter table permit_reminders enable row level security;
alter table approval_queue   enable row level security;
alter table job_runs         enable row level security;
