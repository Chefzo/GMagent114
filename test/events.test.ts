// Tests for the events module: description parsing, prep-checklist math, the
// reminder email, and the end-to-end dry-run reminder. Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildEventReminderEmail,
  buildPrepChecklist,
  parseEventDetails,
  runEventReminders,
} from "../src/modules/events.ts";
import { MockBackbone, MockCalendar, MockMailer, MockSales, MockSchedule } from "../src/tools/mock.ts";
import type { Toolbox } from "../src/tools/clients.ts";
import type { CalendarEvent } from "../src/lib/types.ts";

test("parseEventDetails: pulls headcount and contact from a description", () => {
  assert.deepEqual(parseEventDetails("headcount: 80\ncontact: Mara (555-0142)"), {
    headcount: 80,
    contact: "Mara (555-0142)",
  });
  assert.equal(parseEventDetails("guests = 35, open bar").headcount, 35);
  assert.equal(parseEventDetails("no details here").headcount, undefined);
});

test("buildPrepChecklist: scales staffing with headcount (1 bartender / 50)", () => {
  const base: CalendarEvent = { id: "e", title: "Party", start: "", end: "" };
  assert.equal(buildPrepChecklist({ ...base, headcount: 80 }).staffingBartenders, 2);
  assert.equal(buildPrepChecklist({ ...base, headcount: 35 }).staffingBartenders, 1);
  // No headcount => at least 1 bartender and a "confirm" note.
  const unknown = buildPrepChecklist(base);
  assert.equal(unknown.staffingBartenders, 1);
  assert.match(unknown.stockPrep[0]!.note, /headcount TBD/i);
});

test("buildEventReminderEmail: one block per event; null when empty", () => {
  assert.equal(buildEventReminderEmail([], "114"), null);
  const ev: CalendarEvent = { id: "e", title: "Mara's 30th", start: "2026-06-20T19:00:00Z", end: "2026-06-20T23:00:00Z", headcount: 80 };
  const out = buildEventReminderEmail([{ event: ev, checklist: buildPrepChecklist(ev) }], "114");
  assert.ok(out);
  assert.match(out!.subject, /1 to prep/);
  assert.match(out!.body, /Mara's 30th/);
  assert.match(out!.body, /2 bartender/);
});

test("end-to-end dry-run: reminder emails the owner with both fixture events", async () => {
  const mailer = new MockMailer();
  const tb: Toolbox = {
    data: new MockBackbone(),
    sales: new MockSales(),
    schedule: new MockSchedule(),
    calendar: new MockCalendar(),
    mailer,
    dryRun: true,
  };

  const { events, email } = await runEventReminders(tb, { withinDays: 7 });
  assert.equal(events.length, 2);
  // Sorted by start; the birthday (in 2 days) comes before the corp HH (in 5).
  assert.equal(events[0]!.event.id, "evt-birthday");
  assert.ok(email);
  assert.equal(mailer.sent.length, 1);
  assert.match(mailer.sent[0]!.subject, /Upcoming events/);
});
