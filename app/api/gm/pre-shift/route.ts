import { NextResponse } from 'next/server'
import { runPreShiftBrief } from '@/lib/gm/preShift'

export async function GET() {
  const result = await runPreShiftBrief()
  return NextResponse.json(result)
}

export async function POST() {
  return GET()
}
