// Job-run log — the operational heartbeat record. Every cron lane writes one
// row per execution so Mission Control can show "what fired, when, and what it
// said" without each lane reinventing observability.
//
// Best-effort: a logging failure must never break a lane, and a missing
// Supabase config just no-ops (preview deploys stay green).

import { getSupabaseClient } from '@/lib/integrations/supabase'

export type JobStatus = 'ready' | 'fallback' | 'sent' | 'escalated' | 'noop' | 'error'

export interface JobRunRecord {
  job: string
  status: JobStatus
  summary: string
  /** Anything useful for debugging — raw payload, dispatch results, counts. */
  payload?: unknown
  escalated?: boolean
}

export async function logJobRun(record: JobRunRecord): Promise<void> {
  const supabase = getSupabaseClient()
  if (!supabase) return
  try {
    await supabase.from('job_runs').insert({
      job: record.job,
      status: record.status,
      summary: record.summary,
      payload_json: (record.payload ?? {}) as Record<string, unknown>,
      escalated: record.escalated ?? false,
    })
  } catch (err) {
    console.error('[jobLog] insert failed', err)
  }
}
