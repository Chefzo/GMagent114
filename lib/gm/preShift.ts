import { getUpcomingEvents } from '@/lib/integrations/googleCalendar'

export async function runPreShiftBrief() {
  const events = await getUpcomingEvents()

  return {
    job: 'pre-shift',
    status: 'stub',
    summary: 'Pre-shift brief scaffold ready. Event + reservations + weather inputs still need wiring.',
    payload: { events },
  }
}
