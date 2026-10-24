// Event lifecycle reminder engine.
//
// Events live in the events table (config-first; a Google Calendar feed can
// replace it later without touching this logic). A daily sweep walks each
// upcoming event and fires the milestone that lands today:
//
//   14 days out   — readiness check: BEO signed, deposit collected, F&B
//                    minimum confirmed, staffing locked. Any gap escalates.
//   day of (T-0)   — bartender brief: timeline, headcount, F&B minimum, POC.
//   1 day after    — recap prompt: actuals vs minimum, tip pool, lessons.
//
// event_runs records each fired phase so the daily cron never repeats one.

import { getSupabaseClient } from '@/lib/integrations/supabase'
import { notifyOwner } from '@/lib/gm/notify'
import { enqueueApproval } from '@/lib/gm/approvalQueue'
import { logJobRun } from '@/lib/gm/jobLog'

export type EventPhase = '14_day' | 'day_of' | '24_hour_recap'

export interface EventRow {
  event_key: string
  name: string
  event_date: string
  headcount?: number | null
  contact?: string | null
  beo_signed?: boolean | null
  deposit_collected?: boolean | null
  fnb_minimum?: number | null
  staffing_locked?: boolean | null
}

/** Pure: which lifecycle phase (if any) lands on `today` for an event. */
export function eventPhase(eventDateISO: string, todayISO: string): EventPhase | null {
  const a = Date.parse(`${todayISO}T00:00:00Z`)
  const b = Date.parse(`${eventDateISO.slice(0, 10)}T00:00:00Z`)
  const days = Math.round((b - a) / 86_400_000)
  if (days === 14) return '14_day'
  if (days === 0) return 'day_of'
  if (days === -1) return '24_hour_recap'
  return null
}

/** Pure: the readiness gaps that should block an event 14 days out. */
export function missingMilestones(e: EventRow): string[] {
  const gaps: string[] = []
  if (!e.beo_signed) gaps.push('BEO unsigned')
  if (!e.deposit_collected) gaps.push('deposit not collected')
  if (e.fnb_minimum == null) gaps.push('F&B minimum not set')
  if (!e.staffing_locked) gaps.push('staffing not locked')
  return gaps
}

/** Pure: the operator/bartender line for a given phase. */
export function eventLine(e: EventRow, phase: EventPhase): { text: string; escalate: boolean } {
  const head = e.headcount ? `${e.headcount} guests` : 'headcount TBD'
  switch (phase) {
    case '14_day': {
      const gaps = missingMilestones(e)
      if (gaps.length) {
        return { text: `ESCALATION — ${e.name} is 14 days out and not locked: ${gaps.join(', ')}. Close these before the window tightens.`, escalate: true }
      }
      return { text: `${e.name} 14-day check: BEO signed, deposit in, F&B minimum and staffing locked. Clean.`, escalate: false }
    }
    case 'day_of': {
      const poc = e.contact ? `, POC ${e.contact}` : ''
      const min = e.fnb_minimum != null ? `, F&B min $${e.fnb_minimum}` : ''
      return { text: `Tonight: ${e.name}, ${head}${min}${poc}. Brief the bar on timeline and the minimum before doors.`, escalate: false }
    }
    case '24_hour_recap':
      return { text: `Recap due — ${e.name}: actuals vs F&B minimum, tip pool, and anything to carry into the next one.`, escalate: false }
  }
}

export async function runEventLifecycleSweep(opts: { today?: string } = {}) {
  const today = opts.today ?? new Date().toISOString().slice(0, 10)
  const supabase = getSupabaseClient()

  if (!supabase) {
    const summary = 'Event sweep ran with no Supabase config — no events source.'
    await logJobRun({ job: 'event-lifecycle', status: 'noop', summary })
    return { job: 'event-lifecycle', status: 'noop', summary, fired: [] }
  }

  const { data: events } = await supabase
    .from('events')
    .select('event_key, name, event_date, headcount, contact, beo_signed, deposit_collected, fnb_minimum, staffing_locked')
    .neq('status', 'cancelled')
  const { data: runs } = await supabase.from('event_runs').select('event_key, phase')

  const firedKeys = new Set((runs ?? []).map((r) => `${r.event_key}:${r.phase}`))
  const fired: Array<{ name: string; phase: EventPhase; escalate: boolean }> = []
  const nowIso = new Date().toISOString()

  for (const e of (events ?? []) as EventRow[]) {
    const phase = eventPhase(e.event_date, today)
    if (!phase) continue
    if (firedKeys.has(`${e.event_key}:${phase}`)) continue

    const { text, escalate } = eventLine(e, phase)
    await notifyOwner({ text, smsTo: escalate ? undefined : null })
    if (escalate) await enqueueApproval({ action: 'escalation', summary: text, payload: { event: e.event_key, phase } })

    await supabase.from('event_runs').insert({
      event_key: e.event_key,
      phase,
      status: escalate ? 'escalated' : 'sent',
      payload_json: { text },
      sent_at: nowIso,
      escalated_at: escalate ? nowIso : null,
    })
    fired.push({ name: e.name, phase, escalate })
  }

  const summary = fired.length
    ? `Fired ${fired.length} event milestone(s): ${fired.map((f) => `${f.name} [${f.phase}]`).join(', ')}.`
    : 'Event sweep clean — no milestones land today.'
  await logJobRun({
    job: 'event-lifecycle',
    status: fired.length ? 'sent' : 'noop',
    summary,
    payload: { fired },
    escalated: fired.some((f) => f.escalate),
  })

  return { job: 'event-lifecycle', status: fired.length ? 'sent' : 'clean', summary, fired }
}
