import { NextResponse } from 'next/server'
import { runShiftDigest } from '@/lib/gm/shiftDigest'

export async function GET() {
  const result = await runShiftDigest()
  return NextResponse.json(result)
}

export async function POST() {
  return GET()
}
