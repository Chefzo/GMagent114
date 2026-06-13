import { getLastNightToastDigest } from '@/lib/integrations/toast'

function fmtMoney(value: number | null | undefined) {
  return typeof value === 'number' ? `$${value.toFixed(2)}` : 'n/a'
}

function fmtPct(value: number | null | undefined) {
  return typeof value === 'number' ? `${value.toFixed(1)}%` : 'n/a'
}

function buildOperatorTakeaway(digest: Awaited<ReturnType<typeof getLastNightToastDigest>>) {
  const labor = digest.laborPct
  const sales = digest.netSales
  const voidPct = digest.voidPct

  if (typeof labor === 'number' && labor > 40) return 'Labor is still the lever. Sales did not carry payroll hard enough.'
  if (typeof voidPct === 'number' && voidPct > 1.5) return 'Voids need a look. That is leakage until proven otherwise.'
  if (typeof sales === 'number' && sales < 1000) return 'Traffic is the problem, not spend. Need a stronger reason to show up.'
  return 'Clean night. Keep the bar moving and do not give it back on labor.'
}

function buildSmsParagraph(digest: Awaited<ReturnType<typeof getLastNightToastDigest>>) {
  const topPours = Array.isArray(digest.topPours) && digest.topPours.length
    ? digest.topPours.slice(0, 3).map((item) => `${item.name} (${item.qty})`).join(', ')
    : 'top pours not wired yet'

  return `${digest.businessDate}: ${digest.totalGuests ?? 'n/a'} covers on ${fmtMoney(digest.netSales)} net, ${fmtMoney(digest.aov)} AOV, pours led by ${topPours}. Comps ${fmtMoney(digest.discountAmount)}, voids ${fmtMoney(digest.voidAmount)} (${fmtPct(digest.voidPct)}), labor ${fmtPct(digest.laborPct)} vs target. ${buildOperatorTakeaway(digest)}`
}

export async function runShiftDigest() {
  const digest = await getLastNightToastDigest()
  const message = buildSmsParagraph(digest)

  return {
    job: 'shift-digest',
    status: digest.source === 'toast_live' ? 'ready' : 'fallback',
    summary: message,
    payload: digest,
  }
}
