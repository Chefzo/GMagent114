import { NextRequest, NextResponse } from 'next/server'
import { runPreShiftBrief } from '@/lib/gm/preShift'
import { checkCronAuth } from '@/lib/policies/cronAuth'

export async function GET(req: NextRequest) {
  const unauth = checkCronAuth(req)
  if (unauth) return unauth
  const date = req.nextUrl.searchParams.get('date') ?? undefined
  const result = await runPreShiftBrief({ date })
  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  return GET(req)
}
