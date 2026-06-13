export async function sendSms(to: string, body: string) {
  return {
    ok: true,
    to,
    body,
    provider: 'stub',
  }
}
