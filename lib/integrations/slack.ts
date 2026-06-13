export async function postSlackMessage(channel: string, text: string) {
  return {
    ok: true,
    channel,
    text,
    provider: 'stub',
  }
}
