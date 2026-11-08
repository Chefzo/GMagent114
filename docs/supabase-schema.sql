-- ⚠ SUPERSEDED — DO NOT RUN. The source of truth is supabase/schema.sql.
-- This file describes the June 23 table design (permit_items, deposit_records,
-- deposit_recons, event_milestones, pre_shift_briefs.brief_date …) that was never
-- applied to the live project and that the current lanes no longer read. Kept
-- for history only; delete once the July lanes are live.
--
-- GMagent114 Supabase schema
-- Run in Supabase Dashboard → SQL Editor.
-- Tables are append-only logs; nothing is updated in place.

-- ── Shift digests (EOD digest job) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS shift_digests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_date  date NOT NULL,
  summary_text   text NOT NULL,
  payload_json   jsonb,
  sent_sms_at    timestamptz,
  sent_slack_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON shift_digests (business_date DESC);

-- ── Weekly P&L snapshots ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS weekly_pnl_snapshots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_ending  date NOT NULL,
  summary_text text NOT NULL,
  payload_json jsonb,
  sent_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON weekly_pnl_snapshots (week_ending DESC);

-- ── Pre-shift briefs ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pre_shift_briefs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_date    date NOT NULL,
  brief_text    text NOT NULL,
  event_count   int NOT NULL DEFAULT 0,
  events_json   jsonb,
  sent_slack_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON pre_shift_briefs (brief_date DESC);

-- ── Deposit records (manager-entered) ────────────────────────────────────
-- Managers insert one row per night with the cash amount deposited.
CREATE TABLE IF NOT EXISTS deposit_records (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_date date NOT NULL,
  amount        numeric(10,2) NOT NULL,
  notes         text,
  entered_by    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON deposit_records (business_date DESC);

-- ── Deposit reconciliations (system-generated) ───────────────────────────
CREATE TABLE IF NOT EXISTS deposit_recons (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_date  date NOT NULL,
  toast_cash     numeric(10,2),
  deposit_amount numeric(10,2),
  variance       numeric(10,2),
  alert_sent     boolean NOT NULL DEFAULT false,
  alert_text     text,
  toast_source   text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON deposit_recons (business_date DESC);

-- ── Permit items (manually maintained) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS permit_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  expiry_date  date NOT NULL,
  notes        text,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON permit_items (expiry_date ASC) WHERE active = true;

-- Seed your actual permits (edit expiry dates):
-- INSERT INTO permit_items (name, expiry_date, notes) VALUES
--   ('Liquor License',              '2026-12-31', 'Renew via KABC portal. 60-day lead time.'),
--   ('Health Permit',               '2026-09-30', 'Louisville Metro Health Dept. Inspection required.'),
--   ('Music/Entertainment License', '2026-12-31', 'Annual city license.');

-- ── Event milestones (event lifecycle job) ────────────────────────────────
CREATE TABLE IF NOT EXISTS event_milestones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       text NOT NULL,
  event_title    text NOT NULL,
  event_date     date NOT NULL,
  milestone_days int NOT NULL,
  alert_text     text,
  fired_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON event_milestones (event_id, milestone_days);
CREATE INDEX ON event_milestones (event_date DESC);

-- ── Lock every table to the public API keys ──────────────────────────────
-- The jobs only reach Supabase from the server with the service-role key,
-- which skips these locks, so no policies are needed.
ALTER TABLE shift_digests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_pnl_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE pre_shift_briefs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposit_records      ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposit_recons       ENABLE ROW LEVEL SECURITY;
ALTER TABLE permit_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_milestones     ENABLE ROW LEVEL SECURITY;
