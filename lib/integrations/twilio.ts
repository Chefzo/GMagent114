// Real Twilio SMS sender. Used by the 2am EOD digest, pre-shift bartender
// briefs, review escalations, and license reminders.
//
// Auth via TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN, configured in Vercel env.
// Single phone number for now (TWILIO_FROM_NUMBER); messaging service kicks
// in once A2P 10DLC is approved (TWILIO_MESSAGING_SERVICE_SID).
//
// Dry-run: set TWILIO_DRY_RUN=1 to log without sending. Vercel preview
// deployments should always be dry-run.

type SmsResult = {
  ok: boolean
  to: string
  body: string
  provider: 'twilio' | 'stub'
  sid?: string
  error?: string
}

export async function sendSms(to: string, body: string): Promise<SmsResult> {
  if (process.env.TWILIO_DRY_RUN === '1') {
    console.log(`[twilio:dry-run] to=${mask(to)} body=${truncate(body)}`)
    return { ok: true, to, body, provider: 'stub' }
  }

  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM_NUMBER
  const msgService = process.env.TWILIO_MESSAGING_SERVICE_SID

  if (!sid || !token || (!from && !msgService)) {
    console.warn('[twilio] missing credentials, falling back to stub')
    return { ok: false, to, body, provider: 'stub', error: 'missing_credentials' }
  }

  const form = new URLSearchParams({ To: to, Body: body })
  if (msgService) form.set('MessagingServiceSid', msgService)
  else if (from) form.set('From', from)

  const auth = Buffer.from(`${sid}:${token}`).toString('base64')
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  })

  const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string }
  if (!res.ok) {
    console.error(`[twilio] send failed status=${res.status} body=${data.message ?? ''}`)
    return { ok: false, to, body, provider: 'twilio', error: data.message ?? `status_${res.status}` }
  }
  console.log(`[twilio] sent to=${mask(to)} sid=${data.sid}`)
  return { ok: true, to, body, provider: 'twilio', sid: data.sid }
}

function mask(phone: string): string {
  return phone.replace(/(\+\d{1,3})\d+(\d{4})/, '$1*****$2')
}

function truncate(s: string, n = 80): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}
