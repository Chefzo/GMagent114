// Mission-Control voice for the Sunday 6pm weekly P&L snapshot.
//
// Different from the shift digest in two ways:
//   - It opens with prime cost as the headline number (the lever Enzo cares
//     about), not revenue.
//   - It MUST end with 2-3 numbered moves. The Sunday brief is a planning
//     artifact; he reads it before Monday opens.
//
// Same voice rules as digest: one block (paragraph + numbered list), no
// exclamation, no throat-clearing, name the lever.

const PNL_SYSTEM_PROMPT = `
You are the One Fourteen Virtual GM writing the Sunday-evening weekly P&L
snapshot to the owner, Enzo. He's an owner-operator in Louisville hospitality.

Voice: operator-direct, no fluff. You're a sharp GM texting the owner the read
on last week. You name the prime cost lever, not the data. No exclamation
points. No emojis. No corporate hospitality words ("guests had a wonderful
time", "team crushed it"). No throat-clearing ("Last week we...").

Format:
1. One short paragraph (3-5 sentences) — open with the prime cost % and how it
   landed vs target. Include revenue. Surface food/beverage/labor % only when
   they meaningfully diverge from target. Don't dump every number.
2. A blank line, then 2-3 numbered moves for THIS week. Each move is one
   sentence, action-oriented, specific. Not "review labor scheduling" — "drop
   one bar Tue/Wed until covers come back."

Plain text. Markdown only for the numbered list. No headers.

If QBO data is missing or partial, say so plainly and don't fabricate.
`.trim()

export interface PnlInputForWriter {
  weekStart: string
  weekEnd: string
  revenue: number
  cogsTotal: number
  cogsFood: number | null
  cogsBev: number | null
  labor: number | null
  primeCostPct: number | null
  foodCostPct: number | null
  bevCostPct: number | null
  laborPct: number | null
  netIncome: number
  source: string
  flags: string[]
  prior?: { revenue?: number; primeCostPct?: number | null; netIncome?: number }
  toastTotals?: { netSales: number; covers: number; laborPct: number | null }
  targets: { primeCostPct: number; laborPct: number; foodCostPct: number; bevCostPct: number }
}

export async function writePnlParagraph(input: PnlInputForWriter): Promise<string> {
  if (process.env.PNL_DRY_RUN === '1' || !process.env.ANTHROPIC_API_KEY) {
    return mockPnlParagraph(input)
  }
  try {
    return await callClaude(input)
  } catch (err) {
    console.error('[pnlWriter] Claude failed, using mock', err)
    return mockPnlParagraph(input)
  }
}

async function callClaude(input: PnlInputForWriter): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY!
  const model = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6'
  const userBlock = [
    "Last week's P&L:",
    JSON.stringify(input, null, 2),
    '',
    'Write the snapshot. One paragraph + 2-3 numbered moves. Prime cost is the headline.',
  ].join('\n')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      system: PNL_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userBlock }],
    }),
  })
  if (!res.ok) throw new Error(`Anthropic status ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> }
  const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim()
  if (!text) throw new Error('empty Anthropic response')
  return text
}

function mockPnlParagraph(input: PnlInputForWriter): string {
  const rev = input.revenue || input.toastTotals?.netSales || 0
  const pc = input.primeCostPct
  const target = input.targets.primeCostPct
  const headline = pc !== null
    ? `Prime cost landed at ${pc}% on $${Math.round(rev).toLocaleString()} revenue — ${pc > target ? `${(pc - target).toFixed(1)} points above target` : `under target by ${(target - pc).toFixed(1)} points`}.`
    : `Revenue at $${Math.round(rev).toLocaleString()} — QBO cost data wasn't tagged cleanly enough to compute prime cost this week.`
  const flag = input.source !== 'qbo_live' ? ' QBO data is partial — confirm chart of accounts is tagging COGS food vs bev separately.' : ''
  return `${headline}${flag}\n\n1. Pull next week's order draft Monday and tighten the slow-mover par levels by 20%.\n2. Hold labor flat — no extra coverage requests this week unless reservations cross 80 by Thursday.`
}

export function assertPnlVoice(paragraph: string): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (!paragraph.trim()) reasons.push('empty')
  if (/!/.test(paragraph)) reasons.push('contains exclamation point')
  if (/^last week/i.test(paragraph.trim())) reasons.push("throat-clearing opener ('Last week…')")
  // Must have a numbered list (at least "1.")
  if (!/(\n|^)\s*1\./.test(paragraph)) reasons.push('missing numbered moves section')
  if (paragraph.length > 2000) reasons.push(`too long (${paragraph.length} chars)`)
  return { ok: reasons.length === 0, reasons }
}
