import { NextRequest, NextResponse } from 'next/server'
import { runPnlSnapshot } from '@/lib/gm/pnlSnapshot'
import { checkCronAuth } from '@/lib/policies/cronAuth'

export async function GET(req: NextRequest) {
  const unauth = checkCronAuth(req)
  if (unauth) return unauth
  const weekEnding = req.nextUrl.searchParams.get('weekEnding') ?? undefined
  const result = await runPnlSnapshot({ weekEnding })
  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  return GET(req)
}
