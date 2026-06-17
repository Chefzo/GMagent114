// Live Google Calendar source. Reads events from the bar's calendar via the
// Calendar v3 API using the same service-account impersonation as Gmail/Sheets.
// The calendar is the source of truth for bookings; headcount/contact are parsed
// out of each event's description (see parseEventDetails).

import { googleAccessToken } from "../lib/auth.ts";
import { env, requireEnv } from "../lib/config.ts";
import { log } from "../lib/logger.ts";
import type { CalendarEvent } from "../lib/types.ts";
import type { CalendarSource } from "./clients.ts";
import { parseEventDetails } from "../modules/events.ts";

const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const API = "https://www.googleapis.com/calendar/v3/calendars";

interface GCalEvent {
  id?: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

export class GoogleCalendarSource implements CalendarSource {
  private readonly impersonate = requireEnv("GOOGLE_IMPERSONATE_USER");
  private readonly calendarId = env("GOOGLE_CALENDAR_ID") ?? "primary";

  async listEvents(fromIso: string, toIso: string): Promise<CalendarEvent[]> {
    const token = await googleAccessToken([SCOPE], this.impersonate);
    const url =
      `${API}/${encodeURIComponent(this.calendarId)}/events` +
      `?timeMin=${encodeURIComponent(fromIso)}&timeMax=${encodeURIComponent(toIso)}` +
      `&singleEvents=true&orderBy=startTime`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Calendar list failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { items?: GCalEvent[] };

    const events = (json.items ?? []).map((e) => {
      const details = parseEventDetails(e.description ?? "");
      return {
        id: e.id ?? "",
        title: e.summary ?? "(untitled)",
        start: e.start?.dateTime ?? e.start?.date ?? "",
        end: e.end?.dateTime ?? e.end?.date ?? "",
        headcount: details.headcount,
        contact: details.contact,
        notes: e.description,
      };
    });
    log.info(`Calendar: ${events.length} event(s) for ${fromIso}..${toIso}`);
    return events;
  }
}
