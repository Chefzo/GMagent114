import { NextRequest, NextResponse } from 'next/server'
import { runDepositRecon } from '@/lib/gm/depositRecon'
import { checkCronAuth } from '@/lib/policies/cronAuth'

export async function GET(req: NextRequest) {
  const unauth = checkCronAuth(req)
  if (unauth) return unauth
  const date = req.nextUrl.searchParams.get('date') ?? undefined
  const reportedRaw = req.nextUrl.searchParams.get('reportedCash')
  const reportedCash = reportedRaw != null && reportedRaw !== '' ? Number(reportedRaw) : undefined
  const result = await runDepositRecon({ date, reportedCash })
  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  return GET(req)
}
