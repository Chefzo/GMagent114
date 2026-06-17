// Module: events. Google Calendar is the source of truth for bookings — this
// module reads upcoming events from the calendar, generates a staffing + stock
// prep checklist from each event's headcount, and emails the owner a reminder
// digest in the lead-up. Pure helpers (parseEventDetails, buildPrepChecklist,
// formatChecklist) are testable on their own; runEventReminders wires them up.

import { log } from "../lib/logger.ts";
import type { CalendarEvent, Category } from "../lib/types.ts";
import type { Toolbox } from "../tools/clients.ts";

export interface PrepChecklist {
  staffingBartenders: number;
  stockPrep: { category: Category; note: string }[];
}

/**
 * Pure: pull structured details out of a free-text calendar description.
 * Recognizes "headcount: 80" / "guests: 80" / "pax 80" and "contact: ...".
 */
export function parseEventDetails(description: string): { headcount?: number; contact?: string } {
  const head = description.match(/(?:headcount|guests|pax|covers)\s*[:=]?\s*(\d+)/i);
  const contact = description.match(/contact\s*[:=]?\s*(.+)/i);
  return {
    headcount: head ? Number(head[1]) : undefined,
    contact: contact ? contact[1]!.trim() : undefined,
  };
}

/** Pure: rough staffing + stock prep from headcount (tune ratios per your venue). */
export function buildPrepChecklist(event: CalendarEvent): PrepChecklist {
  const headcount = event.headcount ?? 0;
  const staffingBartenders = Math.max(1, Math.ceil(headcount / 50));
  const who = headcount > 0 ? `~${headcount} guests` : "headcount TBD — confirm with contact";
  return {
    staffingBartenders,
    stockPrep: [
      { category: "liquor", note: `Top off well + check rail for ${who}` },
      { category: "beer", note: `Stock ~${Math.ceil(headcount / 4)} servings of expected beers` },
      { category: "wine", note: `Chill ~${Math.ceil(headcount / 6)} bottles` },
      { category: "other", note: "Napkins, garnish, ice — confirm 2x normal" },
    ],
  };
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Pure: render one event + its checklist as an email block. */
export function formatChecklist(event: CalendarEvent, checklist: PrepChecklist): string {
  const lines = [
    `${event.title} — ${fmtDate(event.start)}`,
    `  Staffing: ${checklist.staffingBartenders} bartender(s)${event.headcount ? ` for ${event.headcount} guests` : ""}`,
    ...(event.contact ? [`  Contact: ${event.contact}`] : []),
    ...checklist.stockPrep.map((p) => `  • ${p.category}: ${p.note}`),
  ];
  return lines.join("\n");
}

export interface EventReminder {
  events: { event: CalendarEvent; checklist: PrepChecklist }[];
  email: { subject: string; body: string } | null;
}

/** Pure: build the reminder digest for a set of upcoming events; null if none. */
export function buildEventReminderEmail(
  items: { event: CalendarEvent; checklist: PrepChecklist }[],
  barName: string,
): { subject: string; body: string } | null {
  if (items.length === 0) return null;
  const blocks = items.map(({ event, checklist }) => formatChecklist(event, checklist));
  const subject = `[${barName}] Upcoming events — ${items.length} to prep`;
  const body = [
    `Events coming up at ${barName}. Prep checklist per booking:`,
    "",
    blocks.join("\n\n"),
    "",
    `Confirm staffing in Sling and fold the stock into the next order.`,
  ].join("\n");
  return { subject, body };
}

/**
 * Read events in the next `withinDays` from Google Calendar, build a prep
 * checklist for each, and email the owner the reminder digest. Read-only.
 */
export async function runEventReminders(
  tb: Toolbox,
  opts: { withinDays?: number; now?: Date } = {},
): Promise<EventReminder> {
  const withinDays = opts.withinDays ?? 7;
  const now = opts.now ?? new Date();
  const toIso = new Date(now.getTime() + withinDays * 86_400_000).toISOString();

  const config = await tb.data.getConfig();
  const events = await tb.calendar.listEvents(now.toISOString(), toIso);
  const items = events
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((event) => ({ event, checklist: buildPrepChecklist(event) }));

  log.info(`Events: ${items.length} booking(s) within ${withinDays} day(s).`);
  const email = buildEventReminderEmail(items, config.barName);
  if (email) {
    await tb.mailer.send(config.ownerEmail, email.subject, email.body);
  } else {
    log.info("No upcoming events — no reminder sent.");
  }
  return { events: items, email };
}
