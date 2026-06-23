// Deposit reconciliation job — fires daily at 7:30am Louisville.
//
// Pipeline:
//   1. Pull yesterday's Toast cash sales.
//   2. Look up the manager's deposit entry from deposit_records in Supabase.
//      If no record exists, fire a missing-deposit alert.
//   3. Compute variance: Toast cash vs recorded deposit.
//   4. If variance > ESCALATION_THRESHOLDS.depositVariance ($50): SMS + Slack.
//   5. Persist recon result to deposit_recons.
//
// deposit_records is written by the bar manager (manual Supabase insert or
// a future Slack slash command). The recon job compares against what Toast says.

import { getLastNightToastDigest } from '@/lib/integrations/toast'
import { sendSms } from '@/lib/integrations/twilio'
import { postSlackMessage } from '@/lib/integrations/slack'
import { getSupabaseClient } from '@/lib/integrations/supabase'
import { ESCALATION_THRESHOLDS } from '@/lib/policies/escalation'

export async function runDepositRecon() {
  const digest = await getLastNightToastDigest()
  const businessDate = digest.businessDate
  const toastCash = digest.cashSales ?? 0

  const depositRecord = await fetchDepositRecord(businessDate)
  const depositAmount = depositRecord?.amount ?? null
  const variance = depositAmount !== null ? Math.abs(toastCash - depositAmount) : null
  const missing = depositAmount === null

  const ownerPhone = process.env.OWNER_PHONE
  const opsChannel = process.env.SLACK_OPS_CHANNEL ?? '#one-fourteen-ops'

  let alertSent = false
  let alertText = ''

  if (missing) {
    alertText = `Deposit recon ${businessDate}: No deposit record found. Toast shows $${toastCash.toFixed(2)} cash. Manager needs to log the deposit.`
    await postSlackMessage(opsChannel, alertText).catch(() => null)
    if (ownerPhone) await sendSms(ownerPhone, alertText).catch(() => null)
    alertSent = true
  } else if (variance !== null && variance > ESCALATION_THRESHOLDS.depositVariance) {
    const dir = toastCash > depositAmount! ? 'short' : 'over'
    alertText = `Deposit recon ${businessDate}: $${variance.toFixed(2)} variance (deposit ${dir}). Toast cash: $${toastCash.toFixed(2)} / Recorded: $${depositAmount!.toFixed(2)}. Flag for review.`
    await postSlackMessage(opsChannel, alertText).catch(() => null)
    if (ownerPhone) await sendSms(ownerPhone, alertText).catch(() => null)
    alertSent = true
  }

  await persistRecon({ businessDate, toastCash, depositAmount, variance, alertSent, alertText: alertSent ? alertText : null, toastSource: digest.source })

  return {
    job: 'deposit-recon',
    status: missing
      ? 'missing_deposit'
      : variance !== null && variance > ESCALATION_THRESHOLDS.depositVariance
      ? 'variance_alert'
      : 'clean',
    businessDate,
    toastCash,
    depositAmount,
    variance,
    threshold: ESCALATION_THRESHOLDS.depositVariance,
    alertSent,
    summary: missing
      ? `No deposit record found for ${businessDate}.`
      : `Variance $${(variance ?? 0).toFixed(2)} vs $${ESCALATION_THRESHOLDS.depositVariance} threshold.`,
  }
}

async function fetchDepositRecord(businessDate: string): Promise<{ amount: number } | null> {
  const supabase = getSupabaseClient()
  if (!supabase) return null
  const { data, error } = await supabase
    .from('deposit_records')
    .select('amount')
    .eq('business_date', businessDate)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  if (error || !data) return null
  return { amount: Number(data.amount) }
}

async function persistRecon(opts: {
  businessDate: string
  toastCash: number
  depositAmount: number | null
  variance: number | null
  alertSent: boolean
  alertText: string | null
  toastSource: string
}) {
  const supabase = getSupabaseClient()
  if (!supabase) return
  await supabase.from('deposit_recons').insert({
    business_date: opts.businessDate,
    toast_cash: opts.toastCash,
    deposit_amount: opts.depositAmount,
    variance: opts.variance,
    alert_sent: opts.alertSent,
    alert_text: opts.alertText,
    toast_source: opts.toastSource,
    created_at: new Date().toISOString(),
  })
}
