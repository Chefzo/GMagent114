// The single approval queue. Per the spec, anything public-, money-, or
// vendor-facing lands here and waits for Enzo before it goes out. Phase 1 lanes
// are read-and-notify only, so the main writer right now is the escalation path
// (a permit at 7 days, a deposit variance over $100) parking an item for
// awareness. Phase 2+ ordering/review lanes enqueue real draft objects.

import { getSupabaseClient } from '@/lib/integrations/supabase'
import { APPROVAL_GATED_ACTIONS } from '@/lib/policies/approvals'

export type ApprovalAction = (typeof APPROVAL_GATED_ACTIONS)[number] | 'escalation'
export type ApprovalStatus = 'pending' | 'approved' | 'edited' | 'rejected' | 'expired' | 'sent'

export interface ApprovalItem {
  action: ApprovalAction
  /** Human one-liner shown in the SMS / Mission Control row. */
  summary: string
  /** The draft or context the decision is about. */
  payload?: unknown
}

export async function enqueueApproval(item: ApprovalItem): Promise<{ ok: boolean; id?: number }> {
  const supabase = getSupabaseClient()
  if (!supabase) return { ok: false }
  try {
    const { data, error } = await supabase
      .from('approval_queue')
      .insert({
        action: item.action,
        summary: item.summary,
        payload_json: (item.payload ?? {}) as Record<string, unknown>,
        status: 'pending' satisfies ApprovalStatus,
      })
      .select('id')
      .single()
    if (error) throw error
    return { ok: true, id: data?.id as number | undefined }
  } catch (err) {
    console.error('[approvalQueue] enqueue failed', err)
    return { ok: false }
  }
}

export async function listPendingApprovals(limit = 25) {
  const supabase = getSupabaseClient()
  if (!supabase) return []
  const { data } = await supabase
    .from('approval_queue')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(limit)
  return data ?? []
}
