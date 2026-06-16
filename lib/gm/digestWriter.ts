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
what actually matters. You never start with "Last night was..." or "Yesterday
we..." — you start with the thing that matters. No exclamation points. No
emojis. No markdown. No corporate hospitality words ("guests had a wonderful
time", "team crushed it", "rockstars", "killed it", "blown away", "amazing
night").

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

// ---------------------------------------------------------------------------
// Voice-rule gate
// ---------------------------------------------------------------------------
//
// Used by tests and by the digest pipeline to refuse bad output. Every rule
// added here should have a positive + negative test case in
// scripts/voice-rules.test.mjs. CI runs the test suite on every push/PR.
//
// Philosophy: false positives are cheap (we just fall back to the
// deterministic mock paragraph). False negatives — letting a cheesy or
// hallucinated paragraph reach Enzo's phone at 2am — are expensive.

// Cheesy hospitality language. Case-insensitive substring match.
const CHEESY_PHRASES = [
  'crushed it',
  'killed it',
  'rockstar',
  'rockstars',
  'amazing night',
  'wonderful time',
  'blown away',
  'knocked it out of the park',
  'absolutely',
  'incredible energy',
  'team is fire',
  'team was fire',
  'guests loved',
] as const

// Throat-clearing openers. Matched against the trimmed start of the paragraph.
const THROAT_CLEARING_OPENERS = [
  /^last night was\b/i,
  /^yesterday we\b/i,
  /^yesterday was\b/i,
  /^the team\b/i,
  /^overall,/i,
  /^to summarize/i,
  /^in summary/i,
] as const

// Emoji detection. Covers most Unicode emoji blocks without ES2018 \p{} so we
// stay compatible with older Node test runners.
const EMOJI_RE =
  /[\u203C-\u3299\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{1F300}-\u{1F9FF}]/u

// Markdown formatting we never want in SMS/Slack.
const MARKDOWN_RES: Array<{ re: RegExp; reason: string }> = [
  { re: /(^|\s)#{1,6}\s/, reason: 'markdown heading' },
  { re: /\*\*[^*]+\*\*/, reason: 'markdown bold' },
  { re: /(^|[^*])\*[^*\s][^*]*\*/, reason: 'markdown italic' },
  { re: /(^|\s)`[^`]+`/, reason: 'inline code' },
  { re: /^\s*[-*]\s/m, reason: 'bullet list' },
  { re: /^\s*\d+\.\s/m, reason: 'numbered list' },
]

/**
 * Voice-rule gate. Used by tests and by the digest pipeline to refuse bad
 * output. Returns ok=true only if every rule passes.
 *
 * Add new rules below the existing ones; every new rule needs a matching test
 * case in scripts/voice-rules.test.mjs.
 */
export function assertVoiceRules(paragraph: string): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  const trimmed = paragraph.trim()

  if (!trimmed) {
    return { ok: false, reasons: ['empty paragraph'] }
  }

  // Structural rules
  if (/\n\s*\n/.test(paragraph)) reasons.push('multi-paragraph output')
  if (paragraph.length > 1200) reasons.push(`too long (${paragraph.length} chars)`)

  const sentenceCount = trimmed.split(/[.!?]+/).filter((s) => s.trim().length > 0).length
  if (sentenceCount > 7) reasons.push(`too many sentences (${sentenceCount} > 7)`)

  // Punctuation rules
  if (/!/.test(paragraph)) reasons.push('contains exclamation point')

  // Opener rules
  for (const opener of THROAT_CLEARING_OPENERS) {
    if (opener.test(trimmed)) {
      reasons.push(`throat-clearing opener (${opener.source})`)
      break
    }
  }

  // Cheesy-language rules
  const lower = paragraph.toLowerCase()
  for (const phrase of CHEESY_PHRASES) {
    if (lower.includes(phrase)) {
      reasons.push(`cheesy hospitality phrase ('${phrase}')`)
    }
  }

  // Formatting rules
  if (EMOJI_RE.test(paragraph)) reasons.push('contains emoji')
  for (const { re, reason } of MARKDOWN_RES) {
    if (re.test(paragraph)) {
      reasons.push(reason)
      break
    }
  }

  // Content sanity: the digest must reference money. A paragraph with no
  // dollar figure is either hallucinated or a system prompt drift — either
  // way, we don't want it on Enzo's phone.
  if (!/\$[\d,]+/.test(paragraph) && !/\bnet\b/i.test(paragraph)) {
    reasons.push('no net sales reference')
  }

  return { ok: reasons.length === 0, reasons }
}
