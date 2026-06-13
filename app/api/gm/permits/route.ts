import { NextRequest, NextResponse } from 'next/server'
import { runPermitReminderSweep } from '@/lib/gm/permits'
import { checkCronAuth } from '@/lib/policies/cronAuth'

export async function GET(req: NextRequest) {
  const unauth = checkCronAuth(req)
  if (unauth) return unauth
  const result = await runPermitReminderSweep()
  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  return GET(req)
}
