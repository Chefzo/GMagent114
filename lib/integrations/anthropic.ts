// Single Anthropic call site for every operator-voice writer (digest, pre-shift,
// P&L). Keeps the API contract, model override, and failure handling in one
// place so each lane only owns its prompt — not HTTP plumbing.
//
// Returns null on any failure (missing key, dry-run, API error, empty body).
// Callers MUST supply their own deterministic fallback so a model outage never
// blocks a lane and a hallucination never ships unchecked.

export interface GenerateTextOpts {
  system: string
  user: string
  maxTokens?: number
}

export async function generateText(opts: GenerateTextOpts): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null

  const model = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6'
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 400,
        system: opts.system,
        messages: [{ role: 'user', content: opts.user }],
      }),
    })
    if (!res.ok) {
      console.error(`[anthropic] status ${res.status}: ${await res.text()}`)
      return null
    }
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> }
    const text = (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
      .trim()
    return text || null
  } catch (err) {
    console.error('[anthropic] call failed', err)
    return null
  }
}
