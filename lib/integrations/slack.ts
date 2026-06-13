// Real Slack channel poster. Used to mirror Enzo-facing digests into
// #one-fourteen-ops so the channel becomes the operational log.

type SlackResult = {
  ok: boolean
  channel: string
  text: string
  provider: 'slack' | 'stub'
  ts?: string
  error?: string
}

export async function postSlackMessage(channel: string, text: string): Promise<SlackResult> {
  if (process.env.SLACK_DRY_RUN === '1') {
    console.log(`[slack:dry-run] channel=${channel} text=${truncate(text)}`)
    return { ok: true, channel, text, provider: 'stub' }
  }

  const token = process.env.SLACK_BOT_TOKEN
  if (!token) {
    console.warn('[slack] missing SLACK_BOT_TOKEN, falling back to stub')
    return { ok: false, channel, text, provider: 'stub', error: 'missing_credentials' }
  }

  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ channel, text, unfurl_links: false, unfurl_media: false }),
  })
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; ts?: string; error?: string }
  if (!data.ok) {
    console.error(`[slack] post failed channel=${channel} error=${data.error}`)
    return { ok: false, channel, text, provider: 'slack', error: data.error ?? 'unknown' }
  }
  console.log(`[slack] posted channel=${channel} ts=${data.ts}`)
  return { ok: true, channel, text, provider: 'slack', ts: data.ts }
}

function truncate(s: string, n = 80): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}
