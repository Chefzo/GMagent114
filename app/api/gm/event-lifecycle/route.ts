import { NextResponse } from 'next/server'
import { runEventLifecycleSweep } from '@/lib/gm/eventLifecycle'

export async function GET() {
  const result = await runEventLifecycleSweep()
  return NextResponse.json(result)
}

export async function POST() {
  return GET()
}
