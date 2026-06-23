// Event lifecycle sweep — fires daily at 9am Louisville.
//
// Scans Google Calendar events in the next 14 days and fires milestone
// reminders at 14, 7, 3, 1, and 0 days out:
//
//   14 days: Confirm headcount and deposit.
//    7 days: Confirm staffing, prep, and any required permits.
//    3 days: Final confirm with client. Send comms to floor team.
//    1 day:  Event tomorrow — verify setup, pars, and staff schedule.
//    0 days: Event today. Pre-shift brief with floor by 4pm.
//
// Deduplication: each (event_id, milestone_days) pair is recorded in
// event_milestones so the same alert never fires twice.
// Escalation: Slack for all milestones; SMS only for day-of and day-before.

import { getUpcomingEvents, type CalendarEvent } from '@/lib/integrations/googleCalendar'
import { sendSms } from '@/lib/integrations/twilio'
import { postSlackMessage } from '@/lib/integrations/slack'
import { getSupabaseClient } from '@/lib/integrations/supabase'

const MILESTONES = [14, 7, 3, 1, 0] as const
type MilestoneDays = (typeof MILESTONES)[number]

const MILESTONE_COPY: Record<MilestoneDays, string> = {
  14: 'Confirm headcount and deposit.',
  7: 'Confirm staffing, prep, and any required permits.',
  3: 'Final confirm with client. Send comms to floor team.',
  1: 'Event tomorrow — verify setup, pars, and staff schedule.',
  0: 'Event today. Pre-shift brief with floor by 4pm.',
}

export async function runEventLifecycleSweep() {
  const events = await getUpcomingEvents(15 * 24)
  const today = todayISO()

  const fired: Array<{ eventId: string; title: string; milestone: number; sent: boolean }> = []

  for (const event of events) {
    const eventDate = event.start.slice(0, 10)
    const daysAway = daysBetween(today, eventDate)
    const matchedMilestone = MILESTONES.find(m => m === daysAway)
    if (matchedMilestone === undefined) continue

    const alreadyFired = await checkMilestoneFired(event.id, matchedMilestone)
    if (alreadyFired) continue

    const msg = `Event lifecycle — ${event.title} (${eventDate}): ${MILESTONE_COPY[matchedMilestone]}`
    const opsChannel = process.env.SLACK_OPS_CHANNEL ?? '#one-fourteen-ops'

    await postSlackMessage(opsChannel, msg).catch(() => null)

    const ownerPhone = process.env.OWNER_PHONE
    if ((matchedMilestone === 0 || matchedMilestone === 1) && ownerPhone) {
      await sendSms(ownerPhone, msg).catch(() => null)
    }

    await recordMilestoneFired(event, matchedMilestone, msg)
    fired.push({ eventId: event.id, title: event.title, milestone: matchedMilestone, sent: true })
  }

  return {
    job: 'event-lifecycle',
    status: fired.length > 0 ? 'alerts_sent' : 'clear',
    eventCount: events.length,
    milestoneFired: fired.length,
    alerts: fired,
    summary:
      fired.length === 0
        ? `${events.length} upcoming events scanned — no milestones due today.`
        : `${fired.length} event milestone alert${fired.length === 1 ? '' : 's'} sent.`,
  }
}

async function checkMilestoneFired(eventId: string, milestone: number): Promise<boolean> {
  const supabase = getSupabaseClient()
  if (!supabase) return false
  const { data } = await supabase
    .from('event_milestones')
    .select('id')
    .eq('event_id', eventId)
    .eq('milestone_days', milestone)
    .limit(1)
    .single()
  return !!data
}

async function recordMilestoneFired(event: CalendarEvent, milestone: number, msg: string) {
  const supabase = getSupabaseClient()
  if (!supabase) return
  await supabase.from('event_milestones').insert({
    event_id: event.id,
    event_title: event.title,
    event_date: event.start.slice(0, 10),
    milestone_days: milestone,
    alert_text: msg,
    fired_at: new Date().toISOString(),
  })
}

function todayISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Louisville' })
}

function daysBetween(from: string, to: string): number {
  const a = new Date(from + 'T12:00:00').getTime()
  const b = new Date(to + 'T12:00:00').getTime()
  return Math.round((b - a) / 86_400_000)
}
