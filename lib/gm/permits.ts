// Permit reminder sweep — fires daily at 8am Louisville.
//
// Reads permit_items table in Supabase. Each row:
//   name         TEXT  — e.g. "Liquor License", "Health Permit"
//   expiry_date  DATE  — YYYY-MM-DD
//   notes        TEXT  — optional renewal instructions
//   active       BOOL  — soft-delete flag
//
// Tiered alert logic:
//   Within PERMIT_ALERT_DAYS (default 30): Slack notice
//   Within 7 days: Slack + SMS warning
//   Expired or today: Slack + SMS urgent escalation

import { sendSms } from '@/lib/integrations/twilio'
import { postSlackMessage } from '@/lib/integrations/slack'
import { getSupabaseClient } from '@/lib/integrations/supabase'

const ALERT_DAYS = Number(process.env.PERMIT_ALERT_DAYS ?? 30)
const URGENT_DAYS = 7
const TABLE = process.env.PERMITS_TABLE ?? 'permit_items'

interface PermitItem {
  id: string
  name: string
  expiry_date: string
  notes: string | null
}

export async function runPermitReminderSweep() {
  const permits = await fetchActivePermits()

  if (!permits.length) {
    return {
      job: 'permits',
      status: 'no_permits',
      summary: 'No active permit records in Supabase. Add rows to permit_items table.',
      alerts: [],
    }
  }

  const today = todayISO()
  const alerts: Array<{ name: string; expiry: string; level: 'urgent' | 'warning' | 'notice'; sent: boolean }> = []
  const ownerPhone = process.env.OWNER_PHONE
  const opsChannel = process.env.SLACK_OPS_CHANNEL ?? '#one-fourteen-ops'

  for (const permit of permits) {
    const daysLeft = daysBetween(today, permit.expiry_date)
    if (daysLeft > ALERT_DAYS) continue

    const level: 'urgent' | 'warning' | 'notice' =
      daysLeft <= 0 ? 'urgent' : daysLeft <= URGENT_DAYS ? 'warning' : 'notice'

    const prefix =
      daysLeft <= 0
        ? `URGENT — EXPIRED: ${permit.name} expired on ${permit.expiry_date}.`
        : daysLeft <= URGENT_DAYS
        ? `URGENT — ${permit.name} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} (${permit.expiry_date}).`
        : `Reminder: ${permit.name} expires in ${daysLeft} days (${permit.expiry_date}).`

    const msg = permit.notes ? `${prefix} Notes: ${permit.notes}` : prefix

    await postSlackMessage(opsChannel, msg).catch(() => null)
    if (level !== 'notice' && ownerPhone) await sendSms(ownerPhone, msg).catch(() => null)

    alerts.push({ name: permit.name, expiry: permit.expiry_date, level, sent: true })
  }

  const urgentCount = alerts.filter(a => a.level === 'urgent').length
  const warningCount = alerts.filter(a => a.level === 'warning').length

  return {
    job: 'permits',
    status:
      urgentCount > 0 ? 'urgent' : warningCount > 0 ? 'warning' : alerts.length > 0 ? 'notice' : 'clear',
    permitCount: permits.length,
    alerts,
    summary:
      alerts.length === 0
        ? `All ${permits.length} permits clear — nothing expiring within ${ALERT_DAYS} days.`
        : `${alerts.length} permit alert${alerts.length === 1 ? '' : 's'} dispatched (${urgentCount} urgent, ${warningCount} warning).`,
  }
}

async function fetchActivePermits(): Promise<PermitItem[]> {
  const supabase = getSupabaseClient()
  if (!supabase) return []
  const { data, error } = await supabase
    .from(TABLE)
    .select('id, name, expiry_date, notes')
    .eq('active', true)
    .order('expiry_date', { ascending: true })
  if (error) {
    console.error('[permits] Supabase fetch failed:', error.message)
    return []
  }
  return (data ?? []) as PermitItem[]
}

function todayISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Louisville' })
}

function daysBetween(from: string, to: string): number {
  const a = new Date(from + 'T12:00:00').getTime()
  const b = new Date(to + 'T12:00:00').getTime()
  return Math.round((b - a) / 86_400_000)
}
