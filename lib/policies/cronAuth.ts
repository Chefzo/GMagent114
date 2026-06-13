// Guards /api/gm/* routes so only Vercel Cron or a manual cron secret can
// trigger them. Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`
// automatically when CRON_SECRET is set in env. For manual runs from a phone
// or a curl, pass the same secret as `?token=<CRON_SECRET>`.

import { NextRequest, NextResponse } from 'next/server'

export function checkCronAuth(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    // No secret configured = open. Acceptable only on preview deploys without
    // real Twilio/Slack credentials.
    return null
  }
  const header = req.headers.get('authorization') ?? ''
  const query = req.nextUrl.searchParams.get('token') ?? ''
  if (header === `Bearer ${secret}` || query === secret) return null
  return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
}
