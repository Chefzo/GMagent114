// Google Calendar feed — intentional stub for Phase 1. The pre-shift brief and
// event lifecycle currently source events from the Supabase `events` table; a
// real Calendar pull can drop in here later returning the same { name, ... }
// shape without touching the lane logic.
export async function getUpcomingEvents(): Promise<Array<{ name: string; start?: string }>> {
  return []
}
