import { getLastNightToastDigest } from '@/lib/integrations/toast'

export async function runShiftDigest() {
  const digest = await getLastNightToastDigest()

  return {
    job: 'shift-digest',
    status: 'stub',
    summary: 'Toast digest scaffold ready. Real Toast parsing not wired yet.',
    payload: digest,
  }
}
