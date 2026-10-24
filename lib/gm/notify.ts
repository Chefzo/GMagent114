// Unified dispatch for every lane. One paragraph in, SMS + Slack + Rede out, with
// a consistent result shape the job logger and Mission Control can read.
//
// Every lane routes owner-facing output through here instead of calling Twilio,
// Slack, and Rede directly, so dry-run behavior, masking, and error handling stay
// identical across the digest, deposit recon, P&L, permits, and event lanes.

import { sendSms } from '@/lib/integrations/twilio'
import { postSlackMessage } from '@/lib/integrations/slack'
import { sendRedeMessage } from '@/lib/integrations/rede'

export type DispatchStatus = { ok: boolean; provider: string; sid?: string; ts?: string; id?: string; error?: string }

export interface NotifyResult {
  sms: DispatchStatus
  slack: DispatchStatus
  rede: DispatchStatus
}

export interface NotifyOpts {
  /** Operator paragraph / bartender SMS body. */
  text: string
  /** Override owner phone. Defaults to OWNER_PHONE. Pass null to skip SMS. */
  smsTo?: string | null
  /** Override Slack channel. Defaults to SLACK_OPS_CHANNEL. Pass null to skip Slack. */
  slackChannel?: string | null
  /**
   * Rede broadcast subject. Rede is OPT-IN per lane: fan-out happens only when a
   * lane passes an explicit non-empty subject (currently the shift-digest does).
   * Undefined or null → skip Rede. Rede itself is dry-run by default (see
   * lib/integrations/rede.ts).
   */
  redeSubject?: string | null
  /** Optional HTML body for Rede only (SMS/Slack still get plain `text`). */
  redeHtml?: string
}

const SKIPPED: DispatchStatus = { ok: false, provider: 'skipped' }

/** Send the same text to Enzo by SMS, mirror it into the ops channel, and broadcast to Rede. */
export async function notifyOwner(opts: NotifyOpts): Promise<NotifyResult> {
  const smsTo = opts.smsTo === undefined ? process.env.OWNER_PHONE ?? null : opts.smsTo
  const channel =
    opts.slackChannel === undefined ? process.env.SLACK_OPS_CHANNEL ?? '#one-fourteen-ops' : opts.slackChannel
  // Rede is opt-in: only fan out when a lane passes an explicit subject.
  const redeSubject = opts.redeSubject ?? null

  const [sms, slack, rede] = await Promise.all<DispatchStatus>([
    smsTo
      ? sendSms(smsTo, opts.text)
      : Promise.resolve({ ...SKIPPED, error: 'no_recipient' }),
    channel ? postSlackMessage(channel, opts.text) : Promise.resolve(SKIPPED),
    redeSubject
      ? sendRedeMessage({ subject: redeSubject, body: opts.text, html: opts.redeHtml })
      : Promise.resolve(SKIPPED),
  ])

  return { sms, slack, rede }
}

/** Send only to a single phone (bartender SMS). No Slack mirror. */
export async function notifySms(to: string, text: string): Promise<DispatchStatus> {
  if (!to) return { ...SKIPPED, error: 'no_recipient' }
  return sendSms(to, text)
}
