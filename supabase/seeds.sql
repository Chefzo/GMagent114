-- Seed data for GMagent114 Phase 1. Safe to re-run: every insert is guarded by
-- a unique key with on-conflict-do-nothing/update. Run AFTER schema.sql.

-- Config the lanes read ----------------------------------------------------
insert into gm_config (key, value_json) values
  ('labor_target_pct', '{"pct": 27}'::jsonb),
  ('prime_cost_target_pct', '{"pct": 60}'::jsonb),
  ('deposit_variance_threshold', '{"flag": 50, "escalate": 100}'::jsonb),
  ('drink_features', '{"items": ["bourbon flight", "the house old fashioned"]}'::jsonb)
on conflict (key) do update set value_json = excluded.value_json, updated_at = now();

-- KY permit + license calendar ---------------------------------------------
-- renewal_date values are placeholders — replace with One Fourteen's real
-- dates. Reminders fire at 60/30/7 days out off whatever is set here.
insert into permits_licenses (name, authority, renewal_date, owner, status, notes) values
  ('KY ABC license',        'KY Alcoholic Beverage Control', '2026-12-31', 'Enzo', 'active', 'State liquor license'),
  ('Local alcohol license', 'Louisville Metro',              '2026-12-31', 'Enzo', 'active', 'City alcohol license'),
  ('Food service permit',   'Louisville Metro Health Dept',  '2026-09-30', 'Enzo', 'active', 'Retail food permit'),
  ('Health inspection',     'Louisville Metro Health Dept',  '2026-09-30', 'Enzo', 'active', 'Routine inspection cycle'),
  ('BMI license',           'BMI',                           '2027-01-15', 'Enzo', 'active', 'Music performance rights'),
  ('ASCAP license',         'ASCAP',                         '2027-01-15', 'Enzo', 'active', 'Music performance rights'),
  ('Liquor liability',      'Insurance carrier',             '2026-11-01', 'Enzo', 'active', 'Liability policy renewal'),
  ('Fire inspection',       'Louisville Fire Dept',          '2026-10-01', 'Enzo', 'active', 'Annual fire inspection')
on conflict do nothing;

-- Roster: at least one lead for the pre-shift brief. Replace phone numbers.
insert into staff_contacts (name, role, phone, sms_enabled, active, notes) values
  ('Lead Bartender', 'lead_bartender', '+15025550114', true, true, 'Placeholder — set the real lead + number')
on conflict do nothing;

-- A sample event so the lifecycle sweep has something to walk. Replace/remove.
insert into events (event_key, name, event_date, headcount, contact, beo_signed, deposit_collected, fnb_minimum, staffing_locked, status) values
  ('sample-private-party', 'Sample Private Party', '2026-07-15', 60, 'Event POC', false, false, 1500.00, false, 'booked')
on conflict (event_key) do nothing;
