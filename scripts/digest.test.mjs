// Unit tests for the nightly digest math in lib/integrations/toast.ts: voids,
// discounts, guests, cash vs card, dayparts and top pours, on a fixture shaped
// like Toast ordersBulk output. No Toast credentials or network needed.

import { summarizeOrders, businessDayWindow } from '../lib/integrations/toast.ts'
import { summarizeSales } from '../lib/integrations/toastSummary.ts'
import { pullFailedParagraph, assertVoiceRules } from '../lib/gm/digestWriter.ts'

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
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`)
}

// One night (Nov 6, EST = UTC-5).
const orders = [
  { // 9:15pm, 2 guests, cash, $2 happy-hour discount on the check
    checks: [{
      amount: 30, totalAmount: 32.1, numberOfGuests: 2, openedDate: '2026-11-07T02:15:00.000+0000',
      appliedDiscounts: [{ name: 'Happy Hour', discountAmount: 2 }],
      payments: [{ type: 'CASH', amount: 32.1 }],
      selections: [{ displayName: 'Well Vodka', quantity: 3, price: 18 }, { displayName: 'Bud Light', quantity: 3, price: 12 }],
    }],
  },
  { // 11:30pm, card declined then re-run, one item voided, a comp on an item
    checks: [{
      amount: 24, totalAmount: 25.68, numberOfGuests: 1, openedDate: '2026-11-07T04:30:00.000+0000',
      payments: [
        { type: 'CREDIT', amount: 25.68, paymentStatus: 'VOIDED' },
        { type: 'CREDIT', amount: 25.68, paymentStatus: 'CAPTURED' },
      ],
      selections: [
        { displayName: 'Well Vodka', quantity: 4, price: 24, appliedDiscounts: [{ name: 'Manager Comp', discountAmount: 6 }] },
        { displayName: 'Jameson', quantity: 1, price: 9, voided: true },
      ],
    }],
  },
  { // 1:10am, after midnight but the same business day; guests left blank
    checks: [{
      amount: 16, totalAmount: 17.12, numberOfGuests: 0, openedDate: '2026-11-07T06:10:00.000+0000',
      payments: [{ type: 'CASH', amount: 17.12 }],
      selections: [{ displayName: 'Bud Light', quantity: 4, price: 16 }],
    }],
  },
  { // whole check voided
    checks: [{ voided: true, amount: 40, totalAmount: 42.8, openedDate: '2026-11-07T03:00:00.000+0000', selections: [] }],
  },
  { deleted: true, checks: [{ amount: 999, totalAmount: 999 }] },
]

const digest = summarizeOrders(orders)

console.log('\nDigest totals')
test('net sales skip voided and deleted checks', () => eq(digest.netSales, 70, 'netSales'))
test('orders count live checks only', () => eq(digest.totalOrders, 3, 'totalOrders'))
test('guests use numberOfGuests, at least 1 per check', () => eq(digest.totalGuests, 4, 'totalGuests'))
test('voids = voided check total + voided items', () => eq(digest.voidAmount, 51.8, 'voidAmount'))
test('discounts = check discounts + item comps', () => eq(digest.discountAmount, 8, 'discountAmount'))

console.log('\nCash vs card')
test('cash sums cash payments', () => eq(digest.cashSales, 49.22, 'cashSales'))
test('a declined card attempt is not counted', () => eq(digest.cardSales, 25.68, 'cardSales'))

console.log('\nDayparts and pours')
test('dayparts on the venue clock, after midnight is its own bucket', () =>
  eq(digest.dayparts, { before10pm: 30, tenTo12am: 24, after12am: 16 }, 'dayparts'))
test('price is the line total, ties on qty break by sales', () =>
  eq(digest.topPours.slice(0, 2), [{ name: 'Well Vodka', qty: 7, sales: 42 }, { name: 'Bud Light', qty: 7, sales: 28 }], 'topPours'))

console.log('\nAgreement with toast:summary')
const summary = summarizeSales(orders)
test('same net sales', () => eq(summary.sales.netSales, digest.netSales, 'netSales'))
test('same voids', () => eq(summary.voids.total, digest.voidAmount, 'voids'))
test('same check count', () => eq(summary.sales.checks, digest.totalOrders, 'checks'))

console.log('\nBusiness day')
test('5am to 5am across the Nov 1 clock change', () =>
  eq(businessDayWindow('2026-10-31'), { start: '2026-10-31T05:00:00.000-0400', end: '2026-11-01T05:00:00.000-0500' }, 'window'))

console.log('\nFailed Toast pull')
const failedText = pullFailedParagraph('2026-11-06')
test('says the pull failed instead of an all-clear', () => {
  if (!failedText.includes('pull failed')) throw new Error(`no failure notice: ${failedText}`)
  if (/nothing to chase|in band/i.test(failedText)) throw new Error(`reads as an all-clear: ${failedText}`)
})
test('names the night', () => {
  if (!failedText.includes('Friday (2026-11-06)')) throw new Error(`wrong night: ${failedText}`)
})
test('passes the voice rules', () => eq(assertVoiceRules(failedText), { ok: true, reasons: [] }, 'voice'))

// --- Summary ---------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f.name}: ${f.err.message}`)
  process.exit(1)
}
