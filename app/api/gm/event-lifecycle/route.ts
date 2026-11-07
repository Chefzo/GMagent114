import { NextRequest, NextResponse } from 'next/server'
import { runEventLifecycleSweep } from '@/lib/gm/eventLifecycle'
import { checkCronAuth } from '@/lib/policies/cronAuth'

export async function GET(req: NextRequest) {
  const unauth = checkCronAuth(req)
  if (unauth) return unauth
  const today = req.nextUrl.searchParams.get('today') ?? undefined
  const result = await runEventLifecycleSweep({ today })
  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  return GET(req)
}
