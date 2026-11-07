// Rede → Supabase audit sync. The "read back" half of the loop: pull the network
// roster + groups from Rede (bearer token) into Supabase so Mission Control can
// answer "who's actually on Rede" and "does the broadcast group have members".
//
// NOTE: staff-submitted feedback (form responses, message replies, read receipts)
// is NOT available to this account — the inbound inbox returns 403 even with the
// bearer token, and the forms feature is unused. That needs a Rede-side role/plan
// change. This sync covers the org-state audit that IS accessible.

import { redeApiGet } from '@/lib/integrations/rede'
import { getSupabaseClient } from '@/lib/integrations/supabase'

const NETWORK_ID = process.env.REDE_NETWORK_ID ?? 'acd984ed-1a7e-4e98-8e02-5ce0bd73a8e2'

interface Paged<T> { count?: number; results?: T[] }

interface RosterEntry {
  id: string
  network_id?: string
  account_id?: string
  first_name?: string
  last_name?: string
  employee_key?: string
  state?: string
  is_permanent?: boolean
  activated_at?: string | null
}

interface GroupEntry {
  id: string
  network_id?: string
  name?: string
  member_count?: number
  teams_enabled?: boolean
}

export interface RedeAuditResult {
  ok: boolean
  roster?: number
  groups?: number
  error?: string
}

/** Pull the Rede roster + groups for the network and upsert into Supabase. */
export async function syncRedeAudit(networkId: string = NETWORK_ID): Promise<RedeAuditResult> {
  const supabase = getSupabaseClient()
  if (!supabase) return { ok: false, error: 'no_supabase' }

  const now = new Date().toISOString()

  const roster = (await redeApiGet<Paged<RosterEntry>>(`/api/subscriptions/v1/subscriptions?network_id=${networkId}&limit=200`)).results ?? []
  const rosterRows = roster.map((s) => ({
    rede_id: s.id,
    network_id: s.network_id ?? networkId,
    account_id: s.account_id ?? null,
    first_name: s.first_name ?? null,
    last_name: s.last_name ?? null,
    employee_key: s.employee_key ?? null,
    state: s.state ?? null,
    is_permanent: s.is_permanent ?? null,
    activated_at: s.activated_at ?? null,
    raw: s as unknown as Record<string, unknown>,
    synced_at: now,
  }))
  const rosterErr = rosterRows.length ? (await supabase.from('rede_roster').upsert(rosterRows, { onConflict: 'rede_id' })).error : null

  const groups = (await redeApiGet<Paged<GroupEntry>>(`/api/groups/v1/groups?network_id=${networkId}&limit=200`)).results ?? []
  const groupRows = groups.map((g) => ({
    rede_id: g.id,
    network_id: g.network_id ?? networkId,
    name: g.name ?? null,
    member_count: g.member_count ?? null,
    teams_enabled: g.teams_enabled ?? null,
    raw: g as unknown as Record<string, unknown>,
    synced_at: now,
  }))
  const groupErr = groupRows.length ? (await supabase.from('rede_groups').upsert(groupRows, { onConflict: 'rede_id' })).error : null

  const err = rosterErr ?? groupErr
  if (err) return { ok: false, error: err.message, roster: rosterRows.length, groups: groupRows.length }
  return { ok: true, roster: rosterRows.length, groups: groupRows.length }
}
