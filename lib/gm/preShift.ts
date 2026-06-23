// Pre-shift brief job — fires at 4pm Louisville (9pm UTC) daily.
//
// Pipeline:
//   1. Pull upcoming Google Calendar events for the next 20 hours.
//   2. Build a structured brief: tonight's events, times, locations, notes.
//   3. Post to SLACK_OPS_CHANNEL so the floor team sees it before open.
//   4. Persist to pre_shift_briefs in Supabase.
//
// SMS to owner intentionally skipped — this brief is for the floor team.
// Enzo gets the 2am digest instead.

import { getUpcomingEvents, type CalendarEvent } from '@/lib/integrations/googleCalendar'
import { postSlackMessage } from '@/lib/integrations/slack'
import { getSupabaseClient } from '@/lib/integrations/supabase'

export async function runPreShiftBrief() {
  const events = await getUpcomingEvents(20)
  const brief = buildBrief(events)
  const opsChannel = process.env.SLACK_OPS_CHANNEL ?? '#one-fourteen-ops'

  const slackResult = await postSlackMessage(opsChannel, brief)

  await persist({ brief, events, slackResult })

  return {
    job: 'pre-shift',
    status: events.length > 0 ? 'ready' : 'no_events',
    eventCount: events.length,
    summary: brief,
    slack: slackResult,
  }
}

function buildBrief(events: CalendarEvent[]): string {
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Louisville',
  })

  if (!events.length) {
    return `Pre-shift brief — ${dateStr}\n\nNo calendar events tonight. Standard open. Check res book manually.`
  }

  const lines = [`Pre-shift brief — ${dateStr}`, '']

  for (const ev of events) {
    const startTime = ev.allDay
      ? 'All day'
      : new Date(ev.start).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          timeZone: 'America/Louisville',
        })
    lines.push(ev.location ? `• ${startTime} — ${ev.title} @ ${ev.location}` : `• ${startTime} — ${ev.title}`)
    if (ev.description) {
      const firstLine = ev.description.split('\n')[0].trim().slice(0, 120)
      if (firstLine) lines.push(`  ${firstLine}`)
    }
  }

  lines.push('')
  lines.push('Confirm pars, check ice, staff in 15 before open.')

  return lines.join('\n')
}

async function persist(opts: {
  brief: string
  events: CalendarEvent[]
  slackResult: { ok: boolean; provider: string; error?: string }
}) {
  const supabase = getSupabaseClient()
  if (!supabase) return
  const now = new Date().toISOString()
  await supabase.from('pre_shift_briefs').insert({
    brief_date: now.slice(0, 10),
    brief_text: opts.brief,
    event_count: opts.events.length,
    events_json: opts.events as unknown as Record<string, unknown>[],
    sent_slack_at: opts.slackResult.ok ? now : null,
  })
}
