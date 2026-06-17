// Tests for the weekly reporting module: metric math, mover ranking, the digest
// email, and the end-to-end dry-run report. Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWeeklyReportEmail,
  computeWeeklyMetrics,
  rankMovers,
  runWeeklyReport,
} from "../src/modules/reporting.ts";
import { MockBackbone, MockCalendar, MockMailer, MockSales, MockSchedule } from "../src/tools/mock.ts";
import type { Toolbox } from "../src/tools/clients.ts";
import { fixtureSales } from "./fixtures.ts";

test("computeWeeklyMetrics: labor % and pour cost % of sales", () => {
  const m = computeWeeklyMetrics({ sales: 20000, priorSales: 18000, laborCost: 5000, costOfGoods: 4000 });
  assert.equal(m.laborPct, 25);
  assert.equal(m.pourCostPct, 20);
});

test("computeWeeklyMetrics: guards divide-by-zero when sales is 0", () => {
  const m = computeWeeklyMetrics({ sales: 0, priorSales: 0, laborCost: 100, costOfGoods: 50 });
  assert.equal(m.laborPct, 0);
  assert.equal(m.pourCostPct, 0);
});

test("rankMovers: most-used first", () => {
  const ranked = rankMovers([
    { item: "A", unitsUsed: 2 },
    { item: "B", unitsUsed: 9 },
    { item: "C", unitsUsed: 0 },
  ]);
  assert.deepEqual(ranked.map((r) => r.item), ["B", "A", "C"]);
});

test("buildWeeklyReportEmail: shows delta, top sellers, non-movers, and orders", () => {
  const m = computeWeeklyMetrics({ sales: 24800, priorSales: 22750, laborCost: 1366, costOfGoods: 575.5 });
  const { subject, body } = buildWeeklyReportEmail(
    "114",
    m,
    [
      { item: "Tito's Vodka 1L", unitsUsed: 5 },
      { item: "Cocktail Napkins", unitsUsed: 0 },
    ],
    [{ timestamp: "2026-06-15T13:05:00Z", vendor: "breakthru", items: "Tito's x2", estTotal: 376, status: "sent" }],
  );
  assert.match(subject, /\+9\.0%/); // (24800-22750)/22750
  assert.match(body, /Top sellers: Tito's Vodka 1L \(5\)/);
  assert.match(body, /Didn't move: Cocktail Napkins/);
  assert.match(body, /breakthru: Tito's x2 \(\$376\.00\)/);
});

test("end-to-end dry-run: report emails the owner with sales delta and labor %", async () => {
  const mailer = new MockMailer();
  const tb: Toolbox = {
    data: new MockBackbone(),
    sales: new MockSales(),
    schedule: new MockSchedule(),
    calendar: new MockCalendar(),
    mailer,
    dryRun: true,
  };

  const { metrics } = await runWeeklyReport(tb, new Date());

  // Mock sales: recent window => thisWeek, older => priorWeek.
  assert.equal(metrics.sales, fixtureSales.thisWeek);
  assert.equal(metrics.priorSales, fixtureSales.priorWeek);
  // Labor (fixture shifts) is $1366; labor % = 1366/24800 ≈ 5.5%.
  assert.ok(metrics.laborPct > 5 && metrics.laborPct < 6);
  assert.equal(mailer.sent.length, 1);
  assert.match(mailer.sent[0]!.subject, /Weekly update/);
});
