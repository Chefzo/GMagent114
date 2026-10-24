// Unit tests for the pure decision logic in each Phase 1 lane. These are the
// rules that decide whether Enzo's phone buzzes — they get tested in isolation,
// with no Toast / Twilio / Supabase in the loop.

import { classifyVariance, depositLine } from '../lib/gm/depositRecon.ts'
import { daysUntil, dueTier } from '../lib/gm/permits.ts'
import { eventPhase, missingMilestones } from '../lib/gm/eventLifecycle.ts'
import { wowDeltaPct, laborPct } from '../lib/gm/pnlSnapshot.ts'
import { buildPreShiftSms } from '../lib/gm/preShift.ts'

let passed = 0
let failed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed++
    failures.push({ name, err })
    console.log(`  ✗ ${name}`)
    console.log(`      ${err.message}`)
  }
}

function eq(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

function assert(cond, label) {
  if (!cond) throw new Error(label)
}

// --- Deposit recon ---------------------------------------------------------
console.log('\nDeposit recon — variance classification:')

test('within band is ok', () => eq(classifyVariance(40), 'ok', '$40 variance'))
test('boundary $50 is ok (threshold is strictly greater)', () => eq(classifyVariance(50), 'ok', '$50 variance'))
test('over $50 flags', () => eq(classifyVariance(75), 'flag', '$75 variance'))
test('over $100 escalates', () => eq(classifyVariance(150), 'escalate', '$150 variance'))
test('negative variance uses absolute value', () => eq(classifyVariance(-120), 'escalate', '-$120 variance'))
test('awaiting-count line names the pending state', () =>
  assert(depositLine('2026-06-16', 800, null, 0).toLowerCase().includes('awaiting'), 'awaiting line'))
test('escalation line is tagged ESCALATION', () =>
  assert(depositLine('2026-06-16', 800, 650, -150).startsWith('ESCALATION'), 'escalation tag'))

// --- Permits ---------------------------------------------------------------
console.log('\nPermits — date math + tier selection:')

test('daysUntil counts forward', () => eq(daysUntil('2026-06-27', '2026-06-17'), 10, '10 days out'))
test('daysUntil goes negative when past due', () => eq(daysUntil('2026-06-10', '2026-06-17'), -7, '7 days past'))
test('45 days out, nothing sent -> 60 tier', () => eq(dueTier(45, []), 60, '45d'))
test('45 days out, 60 already sent -> null', () => eq(dueTier(45, [60]), null, '45d w/ 60 sent'))
test('20 days out, 60 sent -> 30 tier', () => eq(dueTier(20, [60]), 30, '20d'))
test('5 days out, 60+30 sent -> 7 tier', () => eq(dueTier(5, [60, 30]), 7, '5d'))
test('90 days out -> nothing due', () => eq(dueTier(90, []), null, '90d'))
test('past due, all sent -> null (no repeat)', () => eq(dueTier(-3, [60, 30, 7]), null, 'past due all sent'))
test('past due, 7 not yet sent -> 7 keeps escalating', () => eq(dueTier(-3, [60, 30]), 7, 'past due 7 unsent'))

// --- Event lifecycle -------------------------------------------------------
console.log('\nEvent lifecycle — phase + readiness:')

test('exactly 14 days out -> 14_day', () => eq(eventPhase('2026-07-01', '2026-06-17'), '14_day', '14d'))
test('day of -> day_of', () => eq(eventPhase('2026-06-17', '2026-06-17'), 'day_of', 'day of'))
test('one day after -> recap', () => eq(eventPhase('2026-06-16', '2026-06-17'), '24_hour_recap', 'recap'))
test('13 days out -> no phase', () => eq(eventPhase('2026-06-30', '2026-06-17'), null, '13d'))
test('all milestones met -> no gaps', () =>
  eq(missingMilestones({ name: 'X', event_key: 'x', event_date: '2026-07-01', beo_signed: true, deposit_collected: true, fnb_minimum: 1500, staffing_locked: true }).length, 0, 'no gaps'))
test('missing deposit + BEO -> two gaps', () => {
  const gaps = missingMilestones({ name: 'X', event_key: 'x', event_date: '2026-07-01', beo_signed: false, deposit_collected: false, fnb_minimum: 1500, staffing_locked: true })
  eq(gaps.length, 2, 'two gaps')
})

// --- Weekly P&L ------------------------------------------------------------
console.log('\nWeekly P&L — metric math:')

test('week-over-week up', () => eq(wowDeltaPct(110, 100), 10, '+10%'))
test('week-over-week down', () => eq(wowDeltaPct(90, 100), -10, '-10%'))
test('prior zero guards divide-by-zero', () => eq(wowDeltaPct(100, 0), 0, 'prior 0'))
test('labor pct computes', () => eq(laborPct(2700, 10000), 27, '27%'))
test('labor pct null when no cost', () => eq(laborPct(null, 10000), null, 'no cost'))

// --- Pre-shift -------------------------------------------------------------
console.log('\nPre-shift — SMS assembly:')

test('includes events, push, and the confirm prompt', () => {
  const sms = buildPreShiftSms({
    dateISO: '2026-06-17',
    weather: { highF: 88, lowF: 70, precipChancePct: 10, summary: 'clear' },
    eventNames: ['Industry Night'],
    features: ['bourbon flight'],
  })
  assert(sms.includes('Industry Night'), 'event name')
  assert(sms.includes('bourbon flight'), 'feature')
  assert(sms.includes('88/70F'), 'temps')
  assert(sms.toLowerCase().includes('confirm'), 'confirm prompt')
})

test('rain only surfaces at 40%+', () => {
  const dry = buildPreShiftSms({ dateISO: '2026-06-17', weather: { highF: 80, lowF: 65, precipChancePct: 10, summary: 'clear' }, eventNames: [], features: [] })
  const wet = buildPreShiftSms({ dateISO: '2026-06-17', weather: { highF: 80, lowF: 65, precipChancePct: 70, summary: 'rain' }, eventNames: [], features: [] })
  assert(!dry.includes('% rain'), 'no rain clause when dry')
  assert(wet.includes('70% rain'), 'rain clause when wet')
})

// --- Summary ---------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f.name}: ${f.err.message}`)
  process.exit(1)
}
