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
