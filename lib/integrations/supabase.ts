// Real Supabase client (service role). Used for persisting digests, approval
// state, permits, deposit reconciliations, and the event bus.
//
// Returns null when SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing so
// preview deploys without secrets stay green.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null | undefined

export function getSupabaseClient(): SupabaseClient | null {
  if (cached !== undefined) return cached

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    console.warn('[supabase] missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — running unpersisted')
    cached = null
    return cached
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cached
}
