// Read layer for the Mission Control dashboard. All queries are best-effort and
// degrade to empty when Supabase isn't configured, so the page renders a
// "connect Supabase" state instead of throwing on a fresh deploy.

import { getSupabaseClient } from '@/lib/integrations/supabase'

export interface MissionControlData {
  connected: boolean
  latestDigest: { business_date: string; summary_text: string; created_at: string } | null
  recentRuns: Array<{ job: string; status: string; summary: string; escalated: boolean; created_at: string }>
  pendingApprovals: Array<{ action: string; summary: string; created_at: string }>
  upcomingPermits: Array<{ name: string; authority: string | null; renewal_date: string }>
  upcomingEvents: Array<{ name: string; event_date: string; headcount: number | null }>
}

const EMPTY: MissionControlData = {
  connected: false,
  latestDigest: null,
  recentRuns: [],
  pendingApprovals: [],
  upcomingPermits: [],
  upcomingEvents: [],
}

export async function loadMissionControl(): Promise<MissionControlData> {
  const supabase = getSupabaseClient()
  if (!supabase) return EMPTY

  const today = new Date().toISOString().slice(0, 10)

  const [digest, runs, approvals, permits, events] = await Promise.all([
    supabase.from('shift_digests').select('business_date, summary_text, created_at').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('job_runs').select('job, status, summary, escalated, created_at').order('created_at', { ascending: false }).limit(12),
    supabase.from('approval_queue').select('action, summary, created_at').eq('status', 'pending').order('created_at', { ascending: false }).limit(10),
    supabase.from('permits_licenses').select('name, authority, renewal_date').gte('renewal_date', today).order('renewal_date', { ascending: true }).limit(5),
    supabase.from('events').select('name, event_date, headcount').gte('event_date', today).neq('status', 'cancelled').order('event_date', { ascending: true }).limit(5),
  ])

  return {
    connected: true,
    latestDigest: (digest.data as MissionControlData['latestDigest']) ?? null,
    recentRuns: (runs.data as MissionControlData['recentRuns']) ?? [],
    pendingApprovals: (approvals.data as MissionControlData['pendingApprovals']) ?? [],
    upcomingPermits: (permits.data as MissionControlData['upcomingPermits']) ?? [],
    upcomingEvents: (events.data as MissionControlData['upcomingEvents']) ?? [],
  }
}
