// Deposit reconciliation — the morning-after cash check.
//
// Compares the cash Toast recorded at close against the cash the closing
// bartender actually counted and dropped. The counted figure comes from the
// closing-checklist flow (Phase 2) or is entered by hand; until it lands, this
// lane parks an "awaiting count" row rather than inventing a variance.
//
// Thresholds (lib/policies/escalation): >$50 flags Enzo, >$100 escalates.
// The agent never moves money — it only surfaces the gap.

import { getToastRollupForDate, previousBusinessDateISO } from '@/lib/integrations/toast'
import { getSupabaseClient } from '@/lib/integrations/supabase'
import { ESCALATION_THRESHOLDS } from '@/lib/policies/escalation'
import { notifyOwner } from '@/lib/gm/notify'
import { enqueueApproval } from '@/lib/gm/approvalQueue'
import { logJobRun, type JobStatus } from '@/lib/gm/jobLog'

export type VarianceLevel = 'ok' | 'flag' | 'escalate'

/** Pure: classify a cash variance against the configured thresholds. */
export function classifyVariance(variance: number): VarianceLevel {
  const abs = Math.abs(variance)
  if (abs > ESCALATION_THRESHOLDS.financialImmediate) return 'escalate'
  if (abs > ESCALATION_THRESHOLDS.depositVariance) return 'flag'
  return 'ok'
}

/** Pure: the operator-voice line for a reconciliation result. */
export function depositLine(date: string, toastCash: number, reported: number | null, variance: number): string {
  if (reported === null) {
    return `Deposit recon for ${date}: Toast shows $${toastCash.toFixed(2)} cash. Awaiting the counted drop to reconcile.`
  }
  const dir = variance >= 0 ? 'over' : 'short'
  const level = classifyVariance(variance)
  if (level === 'ok') {
    return `Deposit recon for ${date}: drawer reconciled within band ($${Math.abs(variance).toFixed(2)} ${dir}). Nothing to chase.`
  }
  const tag = level === 'escalate' ? 'ESCALATION' : 'Flag'
  return `${tag} — deposit recon ${date}: counted drop is $${Math.abs(variance).toFixed(2)} ${dir} vs Toast cash of $${toastCash.toFixed(2)}. Confirm the count before close of business.`
}

export async function runDepositRecon(opts: { date?: string; reportedCash?: number | null } = {}) {
  const date = opts.date ?? previousBusinessDateISO()
  const rollup = await getToastRollupForDate(date)
  const toastCash = Number((rollup.cashSales ?? 0).toFixed(2))

  // Prefer an explicitly passed count; otherwise read one a bartender may have
  // already filed against this date.
  let reported = opts.reportedCash ?? null
  const supabase = getSupabaseClient()
  if (reported === null && supabase) {
    const { data } = await supabase
      .from('deposit_reconciliations')
      .select('actual_cash_reported')
      .eq('business_date', date)
      .not('actual_cash_reported', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data && typeof data.actual_cash_reported === 'number') reported = data.actual_cash_reported
  }

  const variance = reported === null ? 0 : Number((reported - toastCash).toFixed(2))
  const level = reported === null ? 'ok' : classifyVariance(variance)
  const line = depositLine(date, toastCash, reported, variance)

  // Awaiting a count is informational; a real variance over band reaches Enzo.
  let dispatch = null
  let jobStatus: JobStatus = 'noop'
  if (reported !== null && level !== 'ok') {
    dispatch = await notifyOwner({ text: line })
    jobStatus = 'escalated'
    if (level === 'escalate') {
      await enqueueApproval({ action: 'escalation', summary: line, payload: { date, toastCash, reported, variance } })
    }
  } else if (reported !== null) {
    dispatch = await notifyOwner({ text: line, smsTo: null }) // reconciled: Slack log only
    jobStatus = 'sent'
  }

  if (supabase) {
    await supabase.from('deposit_reconciliations').insert({
      business_date: date,
      variance_amount: reported === null ? null : variance,
      status: reported === null ? 'awaiting_count' : level,
      payload_json: { toastCash, reported, variance, level, source: rollup.source },
      escalated_at: level === 'escalate' ? new Date().toISOString() : null,
    })
  }

  await logJobRun({
    job: 'deposit-recon',
    status: jobStatus,
    summary: line,
    payload: { date, toastCash, reported, variance, level },
    escalated: level === 'escalate',
  })

  return {
    job: 'deposit-recon',
    status: reported === null ? 'awaiting_count' : level,
    summary: line,
    toastCash,
    reportedCash: reported,
    variance,
    dispatch,
  }
}
