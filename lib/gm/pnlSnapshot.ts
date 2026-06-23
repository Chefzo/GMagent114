// Weekly P&L snapshot job. Sunday 6pm Louisville.
//
// Pipeline:
//   1. Pull QBO P&L for the rolling 7 days (and the prior 7 for comparison).
//   2. Pull Toast totals for the same range so we have a sales+covers cross-check.
//   3. Ask Claude to write the operator-voice paragraph + 2-3 numbered moves.
//   4. Gate through assertPnlVoice — bad output is replaced with the
//      deterministic mock fallback.
//   5. Dispatch: SMS to OWNER_PHONE via Twilio, post to SLACK_OPS_CHANNEL.
//   6. Persist to weekly_pnl_snapshots in Supabase.

import { getWeeklyPnl } from '@/lib/integrations/quickbooks'
import { getLastNightToastDigest } from '@/lib/integrations/toast'
import { writePnlParagraph, assertPnlVoice, type PnlInputForWriter } from '@/lib/gm/pnlWriter'
import { sendSms } from '@/lib/integrations/twilio'
import { postSlackMessage } from '@/lib/integrations/slack'
import { getSupabaseClient } from '@/lib/integrations/supabase'
import { ESCALATION_THRESHOLDS } from '@/lib/policies/escalation'

const DEFAULT_TARGETS = {
  primeCostPct: 55,
  laborPct: 25,
  foodCostPct: 30,
  bevCostPct: 20,
}

export async function runPnlSnapshot() {
  const qbo = await getWeeklyPnl()

  // Use Toast as a sales cross-check. The shiftDigest pull is a single-day
  // function; for week totals we'd add a true weekly Toast fetch later. For now
  // we pass the most recent day's covers/sales so Claude has a sanity anchor.
  let toastTotals: PnlInputForWriter['toastTotals']
  try {
    const td = await getLastNightToastDigest()
    if (td.netSales !== null && td.netSales !== undefined) {
      toastTotals = {
        netSales: Number(td.netSales) || 0,
        covers: Number(td.totalGuests ?? 0) || 0,
        laborPct: td.laborPct ?? null,
      }
    }
  } catch (err) {
    console.warn('[pnl-snapshot] Toast totals cross-check failed', err)
  }

  const input: PnlInputForWriter = {
    weekStart: qbo.weekStart,
    weekEnd: qbo.weekEnd,
    revenue: qbo.revenue,
    cogsTotal: qbo.cogsTotal,
    cogsFood: qbo.cogsFood,
    cogsBev: qbo.cogsBev,
    labor: qbo.labor,
    primeCostPct: qbo.primeCostPct,
    foodCostPct: qbo.foodCostPct,
    bevCostPct: qbo.bevCostPct,
    laborPct: qbo.laborPct,
    netIncome: qbo.netIncome,
    source: qbo.source,
    flags: qbo.flags,
    prior: qbo.prior,
    toastTotals,
    targets: DEFAULT_TARGETS,
  }

  let paragraph = await writePnlParagraph(input)
  const voice = assertPnlVoice(paragraph)
  if (!voice.ok) {
    console.warn('[pnl-snapshot] voice rules failed, regenerating with mock writer', voice.reasons)
    process.env.PNL_DRY_RUN = '1'
    paragraph = await writePnlParagraph(input)
    delete process.env.PNL_DRY_RUN
  }

  const ownerPhone = process.env.OWNER_PHONE
  const opsChannel = process.env.SLACK_OPS_CHANNEL ?? '#one-fourteen-ops'

  const [smsResult, slackResult] = await Promise.all([
    ownerPhone ? sendSms(ownerPhone, paragraph) : Promise.resolve({ ok: false, provider: 'stub', error: 'no_owner_phone' } as const),
    postSlackMessage(opsChannel, paragraph),
  ])

  // Optional escalation: if prime cost crosses the escalation threshold, surface
  // an additional alert. ESCALATION_THRESHOLDS is the source of truth.
  if (qbo.primeCostPct !== null && qbo.primeCostPct > (ESCALATION_THRESHOLDS.primeCostAlertPct ?? 65)) {
    const alert = `Prime cost alert: ${qbo.primeCostPct}% this week is over the ${ESCALATION_THRESHOLDS.primeCostAlertPct ?? 65}% escalation threshold.`
    if (ownerPhone) await sendSms(ownerPhone, alert).catch(() => null)
    await postSlackMessage(opsChannel, alert).catch(() => null)
  }

  await persist({
    weekEnding: qbo.weekEnd,
    summary: paragraph,
    payload: { qbo, toast: toastTotals ?? null, input },
    smsResult,
    slackResult,
  })

  return {
    job: 'pnl-snapshot',
    status: qbo.source === 'qbo_live' ? 'ready' : 'fallback',
    voiceOk: voice.ok,
    voiceReasons: voice.reasons,
    summary: paragraph,
    sms: smsResult,
    slack: slackResult,
    payload: { qbo, toast: toastTotals ?? null },
  }
}

async function persist(opts: {
  weekEnding: string
  summary: string
  payload: unknown
  smsResult: { ok: boolean; provider: string; error?: string }
  slackResult: { ok: boolean; provider: string; error?: string }
}) {
  const supabase = getSupabaseClient()
  if (!supabase) return
  const now = new Date().toISOString()
  await supabase.from('weekly_pnl_snapshots').insert({
    week_ending: opts.weekEnding,
    summary_text: opts.summary,
    payload_json: opts.payload as Record<string, unknown>,
    sent_at: (opts.smsResult.ok || opts.slackResult.ok) ? now : null,
  })
}
