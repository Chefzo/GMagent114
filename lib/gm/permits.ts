// License + permit reminder engine.
//
// Tracked items live in the permits_licenses table (seeded with the KY ABC,
// food, BMI/ASCAP, liquor-liability, health, and fire-inspection set). Each
// daily sweep computes days-to-renewal and fires a reminder as each item
// crosses the 60 / 30 / 7-day marks. Per spec the 7-day notice is an
// escalation to Enzo by SMS; 60 and 30 are awareness posts to the ops channel.
//
// permit_reminders records every fired tier so a daily cron never double-sends.

import { getSupabaseClient } from '@/lib/integrations/supabase'
import { notifyOwner } from '@/lib/gm/notify'
import { logJobRun } from '@/lib/gm/jobLog'

export const REMINDER_TIERS = [60, 30, 7] as const
export type ReminderTier = (typeof REMINDER_TIERS)[number]

/** Pure: whole days from `todayISO` until `renewalISO` (negative if past due). */
export function daysUntil(renewalISO: string, todayISO: string): number {
  const a = Date.parse(`${todayISO}T00:00:00Z`)
  const b = Date.parse(`${renewalISO}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

/**
 * Pure: the most-urgent reminder tier that is due (days <= tier) and not yet
 * sent. Returns null when nothing new is due. Past-due items return the 7-day
 * tier so they keep escalating until renewed.
 */
export function dueTier(days: number, alreadySent: number[]): ReminderTier | null {
  const due = REMINDER_TIERS.filter((t) => days <= t && !alreadySent.includes(t))
  if (!due.length) return null
  return Math.min(...due) as ReminderTier
}

function permitLine(name: string, authority: string | null, days: number, tier: ReminderTier): string {
  const auth = authority ? ` (${authority})` : ''
  if (days < 0) return `ESCALATION — ${name}${auth} renewal is ${Math.abs(days)} days PAST DUE. This is a license-at-risk item.`
  if (tier === 7) return `ESCALATION — ${name}${auth} renews in ${days} days. Lock the renewal this week.`
  return `Permit reminder: ${name}${auth} renews in ${days} days.`
}

export async function runPermitReminderSweep(opts: { today?: string } = {}) {
  const today = opts.today ?? new Date().toISOString().slice(0, 10)
  const supabase = getSupabaseClient()

  if (!supabase) {
    const summary = 'Permit sweep ran with no Supabase config — nothing to check.'
    await logJobRun({ job: 'permits', status: 'noop', summary })
    return { job: 'permits', status: 'noop', summary, fired: [] }
  }

  const { data: permits } = await supabase
    .from('permits_licenses')
    .select('id, name, authority, renewal_date, status')
    .neq('status', 'retired')
  const { data: sentRows } = await supabase.from('permit_reminders').select('permit_id, days_before')

  const sentByPermit = new Map<number, number[]>()
  for (const row of sentRows ?? []) {
    const arr = sentByPermit.get(row.permit_id as number) ?? []
    arr.push(row.days_before as number)
    sentByPermit.set(row.permit_id as number, arr)
  }

  const fired: Array<{ name: string; tier: ReminderTier; days: number; escalated: boolean }> = []
  const nowIso = new Date().toISOString()

  for (const p of permits ?? []) {
    if (!p.renewal_date) continue
    const days = daysUntil(p.renewal_date as string, today)
    const alreadySent = sentByPermit.get(p.id as number) ?? []
    const tier = dueTier(days, alreadySent)
    if (tier === null) continue

    const line = permitLine(p.name as string, (p.authority as string) ?? null, days, tier)
    const escalated = tier === 7 || days < 0
    await notifyOwner({ text: line, smsTo: escalated ? undefined : null })

    // Record this tier plus any larger overdue tiers so we don't backfill noise.
    const toRecord = REMINDER_TIERS.filter((t) => days <= t && !alreadySent.includes(t))
    await supabase
      .from('permit_reminders')
      .insert(
        toRecord.map((t) => ({
          permit_id: p.id,
          days_before: t,
          scheduled_for: p.renewal_date,
          sent_at: nowIso,
          status: 'sent',
        })),
      )

    fired.push({ name: p.name as string, tier, days, escalated })
  }

  const summary = fired.length
    ? `Fired ${fired.length} permit reminder(s): ${fired.map((f) => `${f.name} (${f.days}d)`).join(', ')}.`
    : 'Permit sweep clean — no renewals inside the 60-day window.'
  await logJobRun({
    job: 'permits',
    status: fired.length ? 'sent' : 'noop',
    summary,
    payload: { fired },
    escalated: fired.some((f) => f.escalated),
  })

  return { job: 'permits', status: fired.length ? 'sent' : 'clean', summary, fired }
}
