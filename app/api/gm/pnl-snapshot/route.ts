import { NextResponse } from 'next/server'
import { runPnlSnapshot } from '@/lib/gm/pnlSnapshot'

export async function GET() {
  const result = await runPnlSnapshot()
  return NextResponse.json(result)
}

export async function POST() {
  return GET()
}
