// EOD shift digest job. The Phase 1 trust-builder.
//
// Pipeline:
//   1. Pull yesterday's Toast roll-up (lib/integrations/toast).
//   2. Ask Claude to write the operator-voice paragraph (digestWriter).
//   3. Gate the paragraph through assertVoiceRules — bad output is replaced
//      with the deterministic mock fallback so a hallucinated digest never
//      ships to Enzo's phone.
//   4. Dispatch via notifyOwner: SMS to OWNER_PHONE, post to SLACK_OPS_CHANNEL.
//   5. Persist the digest in shift_digests + a job_runs heartbeat row.
//
// Triggered by Vercel Cron at 07:10 UTC (2am Louisville) and by manual
// GET/POST to /api/gm/shift-digest with the cron secret.

import { getLastNightToastDigest } from '@/lib/integrations/toast'
import { writeDigestParagraph, assertVoiceRules, pullFailedParagraph } from '@/lib/gm/digestWriter'
import { getSupabaseClient } from '@/lib/integrations/supabase'
import { notifyOwner, type NotifyResult } from '@/lib/gm/notify'
import { renderRundownHtml } from '@/lib/gm/redeBrief'
import { logJobRun } from '@/lib/gm/jobLog'

export async function runShiftDigest() {
  const digest = await getLastNightToastDigest()
  const live = digest.source === 'toast_live'

  let paragraph = live ? await writeDigestParagraph(digest) : pullFailedParagraph(digest.businessDate)
  const voice = assertVoiceRules(paragraph)
  if (live && !voice.ok) {
    console.warn('[shift-digest] paragraph failed voice rules, using mock fallback', voice.reasons)
    // Deterministic mock never fails the gate, so a bad model output can't ship.
    const prev = process.env.DIGEST_DRY_RUN
    process.env.DIGEST_DRY_RUN = '1'
    paragraph = await writeDigestParagraph(digest)
    if (prev === undefined) delete process.env.DIGEST_DRY_RUN
    else process.env.DIGEST_DRY_RUN = prev
  }

  const dispatch = await notifyOwner({
    text: paragraph,
    redeSubject: `RUNDOWN — ${digest.businessDate}`,
    redeHtml: renderRundownHtml(digest, paragraph),
  })

  await persist({ businessDate: digest.businessDate, summary: paragraph, payload: digest, dispatch })

  const status = live ? 'ready' : 'fallback'
  await logJobRun({ job: 'shift-digest', status, summary: paragraph, payload: { source: digest.source, dispatch } })

  return {
    job: 'shift-digest',
    status,
    voiceOk: voice.ok,
    voiceReasons: voice.reasons,
    summary: paragraph,
    sms: dispatch.sms,
    slack: dispatch.slack,
    rede: dispatch.rede,
    payload: digest,
  }
}

async function persist(opts: {
  businessDate: string
  summary: string
  payload: unknown
  dispatch: NotifyResult
}) {
  const supabase = getSupabaseClient()
  if (!supabase) return
  const now = new Date().toISOString()
  await supabase.from('shift_digests').insert({
    business_date: opts.businessDate,
    summary_text: opts.summary,
    payload_json: opts.payload as Record<string, unknown>,
    sent_sms_at: opts.dispatch.sms.ok ? now : null,
    sent_slack_at: opts.dispatch.slack.ok ? now : null,
  })
}
