// EOD shift digest job. The Phase 1 trust-builder.
//
// Pipeline:
//   1. Pull yesterday's Toast roll-up (lib/integrations/toast).
//   2. Ask Claude to write the operator-voice paragraph (digestWriter).
//   3. Gate the paragraph through assertVoiceRules — bad output is replaced
//      with the deterministic mock fallback so a hallucinated digest never
//      ships to Enzo's phone.
//   4. Dispatch: SMS to OWNER_PHONE via Twilio, post to SLACK_OPS_CHANNEL.
//   5. Persist the digest + dispatch timestamps in Supabase (shift_digests).
//
// Triggered by Vercel Cron at 07:10 UTC (2am Louisville) and by manual
// GET/POST to /api/gm/shift-digest with the cron header.

import { getLastNightToastDigest } from '@/lib/integrations/toast'
import { writeDigestParagraph, assertVoiceRules } from '@/lib/gm/digestWriter'
import { sendSms } from '@/lib/integrations/twilio'
import { postSlackMessage } from '@/lib/integrations/slack'
import { getSupabaseClient } from '@/lib/integrations/supabase'

type DispatchStatus = { ok: boolean; provider: string; error?: string }

export async function runShiftDigest() {
  const digest = await getLastNightToastDigest()

  let paragraph = await writeDigestParagraph(digest)
  const voice = assertVoiceRules(paragraph)
  if (!voice.ok) {
    console.warn('[shift-digest] paragraph failed voice rules, regenerating', voice.reasons)
    // Fall through to the mock writer's deterministic output.
    process.env.DIGEST_DRY_RUN = '1'
    paragraph = await writeDigestParagraph(digest)
    delete process.env.DIGEST_DRY_RUN
  }

  const ownerPhone = process.env.OWNER_PHONE
  const opsChannel = process.env.SLACK_OPS_CHANNEL ?? '#one-fourteen-ops'

  const [smsResult, slackResult] = await Promise.all<DispatchStatus>([
    ownerPhone
      ? sendSms(ownerPhone, paragraph)
      : Promise.resolve({ ok: false, provider: 'stub', error: 'no_owner_phone' }),
    postSlackMessage(opsChannel, paragraph),
  ])

  await persist({
    businessDate: digest.businessDate,
    summary: paragraph,
    payload: digest,
    smsResult,
    slackResult,
  })

  return {
    job: 'shift-digest',
    status: digest.source === 'toast_live' ? 'ready' : 'fallback',
    voiceOk: voice.ok,
    voiceReasons: voice.reasons,
    summary: paragraph,
    sms: smsResult,
    slack: slackResult,
    payload: digest,
  }
}

async function persist(opts: {
  businessDate: string
  summary: string
  payload: unknown
  smsResult: DispatchStatus
  slackResult: DispatchStatus
}) {
  const supabase = getSupabaseClient()
  if (!supabase) return
  const now = new Date().toISOString()
  await supabase.from('shift_digests').insert({
    business_date: opts.businessDate,
    summary_text: opts.summary,
    payload_json: opts.payload as Record<string, unknown>,
    sent_sms_at: opts.smsResult.ok ? now : null,
    sent_slack_at: opts.slackResult.ok ? now : null,
  })
}
