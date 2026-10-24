// Pre-shift brief — the SMS the lead bartender gets a few hours before doors.
//
// Inputs: tonight's weather (Open-Meteo), tonight's events (Supabase events
// table; a Google Calendar feed can replace it later), the drink features to
// push (gm_config), and the lead bartender on the roster (staff_contacts).
//
// Output is a SHORT bartender-voice SMS — no AI voice, no name, no paragraphs.
// It mirrors into the ops channel and logs to pre_shift_briefs with an ack
// column a future inbound-SMS webhook can stamp.

import { getTonightWeather } from '@/lib/integrations/weather'
import { getUpcomingEvents } from '@/lib/integrations/googleCalendar'
import { getSupabaseClient } from '@/lib/integrations/supabase'
import { notifySms, notifyOwner } from '@/lib/gm/notify'
import { logJobRun } from '@/lib/gm/jobLog'

interface BriefInputs {
  dateISO: string
  weather: Awaited<ReturnType<typeof getTonightWeather>>
  eventNames: string[]
  features: string[]
}

/** Pure: assemble the terse bartender SMS. Short clauses, no fluff. */
export function buildPreShiftSms(i: BriefInputs): string {
  const parts: string[] = ['Pre-shift —']
  if (i.eventNames.length) parts.push(`Tonight: ${i.eventNames.join(', ')}.`)
  if (i.weather) {
    const rain = i.weather.precipChancePct >= 40 ? `, ${i.weather.precipChancePct}% rain` : ''
    parts.push(`${i.weather.highF}/${i.weather.lowF}F, ${i.weather.summary}${rain}.`)
  }
  if (i.features.length) parts.push(`Push: ${i.features.join(', ')}.`)
  parts.push('Reply 👍 to confirm.')
  return parts.join(' ')
}

export async function runPreShiftBrief(opts: { date?: string } = {}) {
  const dateISO = opts.date ?? new Date().toISOString().slice(0, 10)
  const supabase = getSupabaseClient()

  const [weather, calendarEvents] = await Promise.all([getTonightWeather(), getUpcomingEvents()])

  // Tonight's events from the events table (calendar feed is still a stub).
  let eventNames: string[] = (calendarEvents as Array<{ name?: string }>).map((e) => e.name ?? '').filter(Boolean)
  let features: string[] = []
  type Lead = { id?: number; name?: string; phone?: string }
  let lead: Lead | null = null

  if (supabase) {
    const { data: evs } = await supabase.from('events').select('name').eq('event_date', dateISO).neq('status', 'cancelled')
    eventNames = [...eventNames, ...((evs ?? []).map((e) => e.name as string))]

    const { data: feat } = await supabase.from('gm_config').select('value_json').eq('key', 'drink_features').maybeSingle()
    const fv = feat?.value_json as { items?: string[] } | string[] | undefined
    if (Array.isArray(fv)) features = fv
    else if (fv?.items) features = fv.items

    const { data: contacts } = await supabase
      .from('staff_contacts')
      .select('id, name, phone, role')
      .eq('active', true)
      .eq('sms_enabled', true)
      .in('role', ['lead', 'lead_bartender'])
      .limit(1)
    if (contacts?.length) lead = contacts[0] as Lead
  }

  const sms = buildPreShiftSms({ dateISO, weather, eventNames, features })

  // SMS the lead if we have one; always mirror into the ops channel.
  const smsResult = lead?.phone ? await notifySms(lead.phone, sms) : { ok: false, provider: 'skipped', error: 'no_lead' }
  const mirror = await notifyOwner({ text: `[pre-shift ${dateISO}] ${sms}`, smsTo: null })

  if (supabase) {
    await supabase.from('pre_shift_briefs').insert({
      shift_date: dateISO,
      summary_text: sms,
      status: smsResult.ok ? 'sent' : 'undelivered',
      sent_at: smsResult.ok ? new Date().toISOString() : null,
      payload_json: { weather, eventNames, features, leadId: lead?.id ?? null },
    })
  }

  const status = smsResult.ok ? 'sent' : 'noop'
  await logJobRun({ job: 'pre-shift', status, summary: sms, payload: { lead: lead?.name ?? null, smsResult, mirror } })

  return { job: 'pre-shift', status, summary: sms, lead: lead?.name ?? null, sms: smsResult, slack: mirror.slack }
}
