import { NextRequest, NextResponse } from 'next/server'
import { runPermitReminderSweep } from '@/lib/gm/permits'
import { checkCronAuth } from '@/lib/policies/cronAuth'

export async function GET(req: NextRequest) {
  const unauth = checkCronAuth(req)
  if (unauth) return unauth
  const today = req.nextUrl.searchParams.get('today') ?? undefined
  const result = await runPermitReminderSweep({ today })
  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  return GET(req)
}
