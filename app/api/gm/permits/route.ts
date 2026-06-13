import { NextResponse } from 'next/server'
import { runPermitReminderSweep } from '@/lib/gm/permits'

export async function GET() {
  const result = await runPermitReminderSweep()
  return NextResponse.json(result)
}

export async function POST() {
  return GET()
}
