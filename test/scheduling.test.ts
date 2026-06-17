// Tests for the scheduling module: coverage gaps, gap summarization, overtime
// risk, labor projection, and the end-to-end dry-run review. Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeCoverageGaps,
  computeLaborProjection,
  computeOvertimeRisk,
  runScheduleReview,
  summarizeGaps,
} from "../src/modules/scheduling.ts";
import { MockBackbone, MockCalendar, MockMailer, MockSales, MockSchedule } from "../src/tools/mock.ts";
import type { Toolbox } from "../src/tools/clients.ts";
import { fixtureScheduling, fixtureShifts } from "./fixtures.ts";

test("computeCoverageGaps: flags Friday 21:00–24:00 short a bartender", () => {
  const gaps = computeCoverageGaps(fixtureShifts, fixtureScheduling.coverageRules);
  // Fri (day 5) 21,22,23 have 1, need 2.
  const fri = gaps.filter((g) => g.day === 5);
  assert.deepEqual(fri.map((g) => g.hour), [21, 22, 23]);
  assert.ok(fri.every((g) => g.have === 1 && g.need === 2));
  // Thursday and Saturday are fully covered -> no gaps.
  assert.equal(gaps.filter((g) => g.day === 4 || g.day === 6).length, 0);
});

test("summarizeGaps: collapses consecutive hours into one window", () => {
  const windows = summarizeGaps(computeCoverageGaps(fixtureShifts, fixtureScheduling.coverageRules));
  assert.equal(windows.length, 1);
  assert.deepEqual(windows[0], { day: 5, startHour: 21, endHour: 24, have: 1, need: 2 });
});

test("computeOvertimeRisk: flags Alex over 40h, not the others", () => {
  const ot = computeOvertimeRisk(fixtureShifts, fixtureScheduling.overtimeThreshold);
  assert.equal(ot.length, 1);
  assert.equal(ot[0]!.bartender, "Alex");
  assert.equal(ot[0]!.hours, 44);
});

test("computeLaborProjection: uses wage overrides and flags over budget", () => {
  const labor = computeLaborProjection(fixtureShifts, fixtureScheduling);
  // 71 total hours: Alex 44 + Sam 15 + Jordan 12.
  assert.equal(labor.totalHours, 71);
  // Alex 44*20 + Sam 15*18 + Jordan 12*18 = 880 + 270 + 216 = 1366.
  assert.equal(labor.totalCost, 1366);
  assert.equal(labor.overBudget, true); // budget 1300
});

test("end-to-end dry-run: review emails the owner with all three flags", async () => {
  const mailer = new MockMailer();
  const tb: Toolbox = {
    data: new MockBackbone(),
    sales: new MockSales(),
    schedule: new MockSchedule(),
    calendar: new MockCalendar(),
    mailer,
    dryRun: true,
  };

  const review = await runScheduleReview(tb, "2026-06-21T00:00:00Z", "2026-06-28T00:00:00Z");

  assert.equal(review.windows.length, 1);
  assert.equal(review.overtime.length, 1);
  assert.equal(review.labor.overBudget, true);
  assert.equal(mailer.sent.length, 1);
  assert.match(mailer.sent[0]!.subject, /Schedule review/);
  assert.match(mailer.sent[0]!.body, /Coverage gaps/);
  assert.match(mailer.sent[0]!.body, /Overtime risk/);
});

test("runScheduleReview: no email when schedule is clean", async () => {
  const mailer = new MockMailer();
  const data = new MockBackbone();
  // Clean config: no coverage rules, very high OT threshold, no budget.
  data.getSchedulingConfig = async () => ({
    coverageRules: [],
    overtimeThreshold: 100,
    defaultHourlyWage: 18,
    wageByBartender: {},
  });
  const tb: Toolbox = { data, sales: new MockSales(), schedule: new MockSchedule(), calendar: new MockCalendar(), mailer, dryRun: true };

  const review = await runScheduleReview(tb, "2026-06-21T00:00:00Z", "2026-06-28T00:00:00Z");
  assert.equal(review.email, null);
  assert.equal(mailer.sent.length, 0);
});
