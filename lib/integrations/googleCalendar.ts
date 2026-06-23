// Google Calendar integration — service account auth.
//
// Auth: Uses a Google service account (GOOGLE_SERVICE_ACCOUNT_EMAIL +
// GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY). The service account must be granted
// "See all event details" access on each calendar you want to pull from.
//
// Calendar IDs come from GOOGLE_CALENDAR_IDS (comma-separated). Common values:
//   - "primary"        — your main Google calendar
//   - An email address — a calendar shared with the service account
//   - A long ID string — from Google Calendar settings > calendar ID
//
// Falls back to [] when credentials are missing (preview deploys stay green).

export interface CalendarEvent {
  id: string
  title: string
  start: string        // ISO 8601
  end: string          // ISO 8601
  allDay: boolean
  location?: string
  description?: string
  calendarId: string
}

function getCalendarConfig() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  const calendarIds = (process.env.GOOGLE_CALENDAR_IDS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  if (!email || !rawKey || !calendarIds.length) return null
  // Private key stored with literal \n in env; expand them.
  const privateKey = rawKey.replace(/\\n/g, '\n')
  return { email, privateKey, calendarIds }
}

// ── JWT / OAuth2 ──────────────────────────────────────────────────────────

function base64url(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

async function signRs256(data: string, pem: string): Promise<string> {
  const { createSign } = await import('node:crypto')
  const sign = createSign('SHA256')
  sign.update(data)
  sign.end()
  return sign
    .sign(pem, 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

async function buildJwt(email: string, privateKey: string, scope: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = base64url(
    JSON.stringify({
      iss: email,
      scope,
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    })
  )
  const signing = `${header}.${claim}`
  const sig = await signRs256(signing, privateKey)
  return `${signing}.${sig}`
}

async function getAccessToken(email: string, privateKey: string): Promise<string> {
  const jwt = await buildJwt(
    email,
    privateKey,
    'https://www.googleapis.com/auth/calendar.readonly'
  )
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  if (!res.ok) throw new Error(`Google OAuth failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { access_token?: string }
  if (!data.access_token) throw new Error('Google OAuth returned no access_token')
  return data.access_token
}

// ── Events fetch ──────────────────────────────────────────────────────────

async function fetchEventsForCalendar(
  token: string,
  calendarId: string,
  timeMin: string,
  timeMax: string
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50',
  })
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    console.warn(`[googleCalendar] fetch failed calendarId=${calendarId} status=${res.status}`)
    return []
  }
  const data = (await res.json()) as {
    items?: Array<{
      id?: string
      summary?: string
      start?: { dateTime?: string; date?: string }
      end?: { dateTime?: string; date?: string }
      location?: string
      description?: string
    }>
  }
  return (data.items ?? []).map(ev => ({
    id: ev.id ?? '',
    title: ev.summary ?? '(No title)',
    start: ev.start?.dateTime ?? ev.start?.date ?? '',
    end: ev.end?.dateTime ?? ev.end?.date ?? '',
    allDay: !ev.start?.dateTime,
    location: ev.location,
    description: ev.description,
    calendarId,
  }))
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Returns upcoming calendar events for the next `lookaheadHours` hours
 * (default 24) across all configured calendar IDs.
 * Returns [] when credentials aren't configured.
 */
export async function getUpcomingEvents(lookaheadHours = 24): Promise<CalendarEvent[]> {
  const cfg = getCalendarConfig()
  if (!cfg) {
    console.warn('[googleCalendar] credentials not configured — returning empty event list')
    return []
  }
  try {
    const token = await getAccessToken(cfg.email, cfg.privateKey)
    const now = new Date()
    const timeMin = now.toISOString()
    const timeMax = new Date(now.getTime() + lookaheadHours * 3_600_000).toISOString()
    const results = await Promise.all(
      cfg.calendarIds.map(id => fetchEventsForCalendar(token, id, timeMin, timeMax))
    )
    return results.flat().sort((a, b) => a.start.localeCompare(b.start))
  } catch (err) {
    console.error('[googleCalendar] failed to fetch events:', err)
    return []
  }
}
