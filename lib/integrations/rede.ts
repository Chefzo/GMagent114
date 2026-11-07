// RedE App broadcast sender — pushes GM output to the frontline staff app
// (redeapp.com) alongside SMS + Slack. Mirrors the twilio/slack integration
// shape: dry-run flag, missing-credentials → stub, structured result, no throws.
//
// ─────────────────────────────────────────────────────────────────────────────
// STATUS (2026-07-09): send is VERIFIED working. Rede issues a bearer token from
// POST /api/auth/v1/bearer/login {username,password} that reaches the One Fourteen
// network (confirmed live) — so this app can send DIRECTLY from Vercel, no browser
// session or worker. Two modes, chosen by REDE_MODE:
//   • REDE_MODE=direct → bearer login (REDE_USERNAME + REDE_PASSWORD, or a
//                        pre-supplied REDE_API_TOKEN) → POST. Serverless, durable
//                        (auto re-mints on 401). RECOMMENDED.
//   • REDE_MODE=queue  → enqueue into Supabase `rede_outbox`; the local `rede-mcp`
//                        worker drains it. Legacy fallback (needs an always-on Mac).
// REDE_DRY_RUN=1 overrides both and makes Rede a safe no-op. Keep it on until
// the pipeline is intentionally switched on.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseClient } from '@/lib/integrations/supabase'

type RedeResult = {
  ok: boolean
  subject: string
  provider: 'rede' | 'stub' | 'queue'
  id?: string
  error?: string
}

export interface RedeRecipient {
  recipient_id: string
  /** "account" = one person; "group" = a broadcast group (e.g. Managers). */
  recipient_type: 'account' | 'group'
}

export interface RedeMessage {
  /** Message subject (Rede messages carry a subject; SMS/Slack do not). */
  subject: string
  /** Message body (the operator paragraph / alert text). */
  body: string
  /** Rede network to post to. Defaults to REDE_NETWORK_ID → One Fourteen. */
  networkId?: string
  /**
   * Targets. REQUIRED to actually send (Rede rejects a message with no
   * recipients). Defaults to REDE_RECIPIENTS (JSON) when omitted. Leaving both
   * unset makes send a safe no-op stub.
   */
  recipients?: RedeRecipient[]
  /**
   * Optional HTML body. When set, the message is sent as content_type
   * "text/html" using this instead of `body` (which stays the plain-text
   * fallback for logs). Rede + BoomBot both render text/html messages.
   */
  html?: string
}

function parseRecipients(raw: string | undefined): RedeRecipient[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v : []
  } catch {
    console.warn('[rede] REDE_RECIPIENTS is not valid JSON, ignoring')
    return []
  }
}

const REDE_BASE = process.env.REDE_BASE ?? 'https://secure.redeapp.com'
// One Fourteen network (verified 2026-07-08). Override via env per environment.
const DEFAULT_NETWORK_ID = process.env.REDE_NETWORK_ID ?? 'acd984ed-1a7e-4e98-8e02-5ce0bd73a8e2'

// ── Bearer auth ──────────────────────────────────────────────────────────────
// Rede issues a bearer token from POST /api/auth/v1/bearer/login {username,
// password}. Verified 2026-07-09: the Rede admin account's token
// administers the One Fourteen network and can send to it — so the app sends
// directly from Vercel, no browser session/worker. Token is cached per warm
// instance and re-minted on 401. A pre-supplied REDE_API_TOKEN wins if set.
let _tokenCache: string | null = null

export async function getRedeToken({ forceFresh = false } = {}): Promise<string | null> {
  if (!forceFresh) {
    if (process.env.REDE_API_TOKEN) return process.env.REDE_API_TOKEN
    if (_tokenCache) return _tokenCache
  }
  const username = process.env.REDE_USERNAME
  const password = process.env.REDE_PASSWORD
  if (!username || !password) return process.env.REDE_API_TOKEN ?? null
  const res = await fetch(`${REDE_BASE}/api/auth/v1/bearer/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) throw new Error(`bearer login failed (${res.status})`)
  const data = (await res.json().catch(() => ({}))) as { token?: string; access_token?: string; bearer?: string; data?: { token?: string } }
  const token = data.token ?? data.access_token ?? data.bearer ?? data.data?.token
  if (!token) throw new Error('no token in bearer login response')
  _tokenCache = token
  return token
}

/** Authenticated GET against the Rede API (bearer, re-mints on 401). */
export async function redeApiGet<T = unknown>(path: string): Promise<T> {
  let token = await getRedeToken()
  if (!token) throw new Error('rede: no credentials (set REDE_USERNAME/REDE_PASSWORD or REDE_API_TOKEN)')
  const get = (t: string) =>
    fetch(`${REDE_BASE}${path}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${t}` } })
  let res = await get(token)
  if (res.status === 401) {
    token = await getRedeToken({ forceFresh: true })
    if (token) res = await get(token)
  }
  if (!res.ok) throw new Error(`rede GET ${path} failed (${res.status})`)
  return res.json() as Promise<T>
}

export async function sendRedeMessage(msg: RedeMessage): Promise<RedeResult> {
  const { subject, body } = msg
  const networkId = msg.networkId ?? DEFAULT_NETWORK_ID
  const recipients = msg.recipients ?? parseRecipients(process.env.REDE_RECIPIENTS)
  const isHtml = typeof msg.html === 'string' && msg.html.length > 0
  const sendBody = isHtml ? (msg.html as string) : body
  const contentType = isHtml ? 'text/html' : 'text'

  // Forced dry-run (default posture until go-live).
  if (process.env.REDE_DRY_RUN === '1') {
    console.log(`[rede:dry-run] network=${networkId} recipients=${recipients.length} subject=${truncate(subject)}`)
    return { ok: true, subject, provider: 'stub' }
  }

  // Queue mode (free-plan path): enqueue to Supabase; the local worker sends.
  // Serverless-safe — no browser session needed here.
  if (process.env.REDE_MODE === 'queue') {
    if (recipients.length === 0) {
      console.warn('[rede] queue: no recipients (set REDE_RECIPIENTS), skipping')
      return { ok: false, subject, provider: 'stub', error: 'no_recipients' }
    }
    const supabase = getSupabaseClient()
    if (!supabase) return { ok: false, subject, provider: 'stub', error: 'no_supabase' }
    const { data, error } = await supabase
      .from('rede_outbox')
      .insert({
        network_id: networkId,
        recipients_json: recipients,
        subject,
        body: sendBody,
        content_type: contentType,
        use_case: process.env.REDE_USE_CASE ?? 'direct_message',
        source: 'gm',
      })
      .select('id')
      .single()
    if (error) {
      console.error(`[rede] queue insert failed: ${error.message}`)
      return { ok: false, subject, provider: 'queue', error: error.message }
    }
    console.log(`[rede:queue] enqueued id=${data?.id} subject=${truncate(subject)}`)
    return { ok: true, subject, provider: 'queue', id: String(data?.id) }
  }

  // Direct mode (bearer token). Serverless-safe — sends straight from Vercel.
  if (recipients.length === 0) {
    // Rede rejects a message with no recipients; never blast by default.
    console.warn('[rede] no recipients (set REDE_RECIPIENTS), falling back to stub')
    return { ok: false, subject, provider: 'stub', error: 'no_recipients' }
  }

  let token: string | null
  try {
    token = await getRedeToken()
  } catch (e) {
    const error = e instanceof Error ? e.message : 'auth_failed'
    console.error(`[rede] bearer login failed: ${error}`)
    return { ok: false, subject, provider: 'stub', error }
  }
  if (!token) {
    console.warn('[rede] no REDE_USERNAME/REDE_PASSWORD or REDE_API_TOKEN, falling back to stub')
    return { ok: false, subject, provider: 'stub', error: 'missing_credentials' }
  }

  // Verified working payload (2026-07-09: 201 status:"sent", incl. bearer→One Fourteen).
  const payload = {
    network_id: networkId,
    recipients,
    subject,
    body: sendBody,
    content_type: contentType,
    use_case: process.env.REDE_USE_CASE ?? 'direct_message',
    is_async: true,
  }

  const post = (tok: string) =>
    fetch(`${REDE_BASE}/api/messaging/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify(payload),
    })

  try {
    let res = await post(token)
    // Token expired mid-flight → re-mint once and retry.
    if (res.status === 401) {
      token = await getRedeToken({ forceFresh: true })
      if (token) res = await post(token)
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string; detail?: string; error?: string }
    if (!res.ok) {
      const err = data.detail ?? data.error ?? `status_${res.status}`
      console.error(`[rede] send failed status=${res.status} error=${err}`)
      return { ok: false, subject, provider: 'rede', error: err }
    }
    console.log(`[rede] sent subject=${truncate(subject)} id=${data.id ?? '?'}`)
    return { ok: true, subject, provider: 'rede', id: data.id }
  } catch (e) {
    const error = e instanceof Error ? e.message : 'unknown'
    console.error(`[rede] send threw error=${error}`)
    return { ok: false, subject, provider: 'rede', error }
  }
}

function truncate(s: string, n = 80): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}
