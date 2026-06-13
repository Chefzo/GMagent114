import { NextResponse } from 'next/server'
import { runDepositRecon } from '@/lib/gm/depositRecon'

export async function GET() {
  const result = await runDepositRecon()
  return NextResponse.json(result)
}

export async function POST() {
  return GET()
}
