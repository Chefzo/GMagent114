// Weekly P&L snapshot — the Sunday-PM operator read.
//
// Pulls the trailing-7-day Toast roll-up plus the prior week for a
// week-over-week comparison, layers in the labor target from gm_config, and
// asks Claude to write an opinion (not a raw dump): top movers, the labor read,
// and two or three levers worth pulling. Food/beverage cost % is flagged as
// pending until the vendor-invoice lane (Phase 2) feeds real COGS.
//
// Falls back to a deterministic paragraph when Claude is unavailable.

import { getToastWeekRollup, previousBusinessDateISO } from '@/lib/integrations/toast'
import { getSupabaseClient } from '@/lib/integrations/supabase'
import { generateText } from '@/lib/integrations/anthropic'
import { notifyOwner } from '@/lib/gm/notify'
import { logJobRun } from '@/lib/gm/jobLog'

/** Pure: week-over-week percentage change, guarding divide-by-zero. */
export function wowDeltaPct(current: number, prior: number): number {
  if (prior <= 0) return 0
  return Number((((current - prior) / prior) * 100).toFixed(1))
}

/** Pure: labor as a percentage of sales. */
export function laborPct(laborCost: number | null, sales: number): number | null {
  if (laborCost == null || sales <= 0) return null
  return Number(((laborCost / sales) * 100).toFixed(1))
}

const PNL_SYSTEM_PROMPT = `
You are the One Fourteen Virtual GM writing the Sunday-evening weekly P&L read
to the owner, Enzo. Operator voice, no fluff, no markdown, no exclamation
points. This is an opinion, not a data dump. Lead with the read on the week,
name the labor situation against target, call the top movers only if they
change a decision, and end with two or three concrete levers to pull this week.
Three to six sentences. If COGS/cost data is marked pending, say so in one
clause and don't invent food or beverage cost percentages.
`.trim()

interface PnlInputs {
  weekEnding: string
  netSales: number
  priorNetSales: number
  wowPct: number
  avgDailyNet: number
  totalGuests: number
  laborTargetPct: number
  laborPct: number | null
  topMovers: Array<{ name: string; qty: number }>
  daysWithData: number
}

function mockPnl(i: PnlInputs): string {
  const dir = i.wowPct >= 0 ? 'up' : 'down'
  const labor = i.laborPct != null ? `Labor ran ${i.laborPct}% against a ${i.laborTargetPct}% target` : `Labor data pending`
  const top = i.topMovers[0]?.name ?? 'the well'
  return `Week ending ${i.weekEnding}: $${Math.round(i.netSales).toLocaleString()} net, ${dir} ${Math.abs(i.wowPct)}% on the prior week. ${labor}. ${top} led the movers. Cost percentages pending the invoice lane. Lever this week: hold the line on labor against the slower weeknights and push the top mover where the margin sits.`
}

async function writePnl(i: PnlInputs): Promise<string> {
  if (process.env.DIGEST_DRY_RUN === '1') return mockPnl(i)
  const user = ['This week vs prior:', JSON.stringify(i, null, 2), '', 'Write the weekly P&L read.'].join('\n')
  const text = await generateText({ system: PNL_SYSTEM_PROMPT, user, maxTokens: 500 })
  return text ?? mockPnl(i)
}

export async function runPnlSnapshot(opts: { weekEnding?: string } = {}) {
  const weekEnding = opts.weekEnding ?? previousBusinessDateISO()

  const thisWeek = await getToastWeekRollup(weekEnding, 7)
  const priorEnd = new Date(`${weekEnding}T12:00:00Z`)
  priorEnd.setUTCDate(priorEnd.getUTCDate() - 7)
  const priorWeek = await getToastWeekRollup(priorEnd.toISOString().slice(0, 10), 7)

  // Labor target from config (default 27%). Actual labor % now comes from the
  // Toast labor pull (time entries × wage) folded into the week roll-up below.
  let laborTargetPct = 27
  const supabase = getSupabaseClient()
  if (supabase) {
    const { data } = await supabase.from('gm_config').select('value_json').eq('key', 'labor_target_pct').maybeSingle()
    const v = (data?.value_json as { pct?: number } | number | undefined)
    if (typeof v === 'number') laborTargetPct = v
    else if (v && typeof v.pct === 'number') laborTargetPct = v.pct
  }

  const inputs: PnlInputs = {
    weekEnding,
    netSales: thisWeek.netSales,
    priorNetSales: priorWeek.netSales,
    wowPct: wowDeltaPct(thisWeek.netSales, priorWeek.netSales),
    avgDailyNet: thisWeek.avgDailyNet,
    totalGuests: thisWeek.totalGuests,
    laborTargetPct,
    laborPct: laborPct(thisWeek.laborCost, thisWeek.netSales),
    topMovers: thisWeek.topMovers,
    daysWithData: thisWeek.daysWithData,
  }

  const summary = await writePnl(inputs)
  const dispatch = await notifyOwner({ text: summary })

  if (supabase) {
    await supabase.from('weekly_pnl_snapshots').insert({
      week_ending: weekEnding,
      summary_text: summary,
      payload_json: { ...inputs, source: thisWeek.source },
      sent_at: dispatch.sms.ok || dispatch.slack.ok ? new Date().toISOString() : null,
    })
  }

  const status = thisWeek.source === 'toast_live' ? 'ready' : 'fallback'
  await logJobRun({ job: 'pnl-snapshot', status, summary, payload: { inputs, dispatch } })

  return { job: 'pnl-snapshot', status, summary, inputs, dispatch }
}
