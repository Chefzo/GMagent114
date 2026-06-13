// Mission-Control voice writer for the EOD digest.
//
// Calls Claude with a strict system prompt that enforces:
//   - one paragraph (no blank lines)
//   - no exclamation points
//   - no throat-clearing ("Last night was...")
//   - 3-5 sentences, hard cap at 7
//   - name the lever, not the data
//
// Falls back to a deterministic mock paragraph when ANTHROPIC_API_KEY is
// absent or when DIGEST_DRY_RUN=1, so preview deploys and local dev never
// require live API access.

const DIGEST_SYSTEM_PROMPT = `
You are the One Fourteen Virtual GM writing the 2am end-of-shift digest to the
owner, Enzo. He's an owner-operator in Louisville hospitality.

Voice: operator-direct, no fluff. You're a sharp GM texting the owner a single
paragraph. You name the lever, not the data. You don't dump numbers — you pick
what actually matters. You never start with "Last night was..." — you start
with the thing that matters. No exclamation points. No emojis. No corporate
hospitality words ("guests had a wonderful time", "team crushed it").

Format: one paragraph. 3-5 sentences. Hard cap at 7. Plain text, no markdown.

Always include the net sales number and covers. Surface labor % only if it's
>2 points off target. Surface comp % only if >3% of net. Top sellers go in
only if relevant to the read.

End with one of these patterns:
- A one-line take on what to do tomorrow if there's a lever ("Push the bourbon
  flight tomorrow — three pours away from the well").
- Plain confirmation if there isn't ("Numbers landed in band. Nothing to chase.").
`.trim()

export interface DigestMetrics {
  businessDate: string
  totalGuests?: number | null
  netSales?: number | null
  aov?: number | null
  discountAmount?: number | null
  voidAmount?: number | null
  voidPct?: number | null
  laborPct?: number | null
  topPours?: Array<{ name: string; qty: number }> | null
}

export async function writeDigestParagraph(metrics: DigestMetrics): Promise<string> {
  if (process.env.DIGEST_DRY_RUN === '1' || !process.env.ANTHROPIC_API_KEY) {
    return mockParagraph(metrics)
  }
  try {
    return await callClaude(metrics)
  } catch (err) {
    console.error('[digestWriter] Claude call failed, using mock paragraph', err)
    return mockParagraph(metrics)
  }
}

async function callClaude(metrics: DigestMetrics): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY!
  const model = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6'

  const userBlock = [
    "Last night's numbers:",
    JSON.stringify(metrics, null, 2),
    '',
    'Write the digest. One paragraph. Name the lever or confirm the band.',
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
      max_tokens: 400,
      system: DIGEST_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userBlock }],
    }),
  })
  if (!res.ok) throw new Error(`Anthropic status ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> }
  const text = (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim()
  if (!text) throw new Error('empty Anthropic response')
  return text
}

function mockParagraph(metrics: DigestMetrics): string {
  const covers = metrics.totalGuests ?? 0
  const net = metrics.netSales ?? 0
  const top = metrics.topPours?.[0]?.name ?? 'the well'
  const labor = typeof metrics.laborPct === 'number' ? metrics.laborPct : null
  const laborClause = labor !== null && (labor > 27 || labor < 22) ? `, labor at ${labor.toFixed(1)}%` : ''
  const dow = safeDayOfWeek(metrics.businessDate)
  return `$${Math.round(net).toLocaleString()} net on ${covers} covers, ${dow}${laborClause}. ${top} carried the room. Numbers landed in band. Nothing to chase.`
}

function safeDayOfWeek(dateStr: string): string {
  try {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' })
  } catch {
    return 'last night'
  }
}

/** Voice-rule gate. Used by tests and by the digest pipeline to refuse bad output. */
export function assertVoiceRules(paragraph: string): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (!paragraph.trim()) reasons.push('empty paragraph')
  if (/\n\s*\n/.test(paragraph)) reasons.push('multi-paragraph output')
  if (/!/.test(paragraph)) reasons.push('contains exclamation point')
  if (/^last night was/i.test(paragraph.trim())) reasons.push("throat-clearing opener ('Last night was...')")
  const sentenceCount = paragraph.split(/[.!?]+/).filter((s) => s.trim().length > 0).length
  if (sentenceCount > 7) reasons.push(`too many sentences (${sentenceCount} > 7)`)
  if (paragraph.length > 1200) reasons.push(`too long (${paragraph.length} chars)`)
  return { ok: reasons.length === 0, reasons }
}
