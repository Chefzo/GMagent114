// Tests for the inventory module: count checklist, variance math, and the
// end-to-end variance review (counts persisted + alert on out-of-tolerance).
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCountChecklist,
  buildVarianceReportEmail,
  computeVariance,
  recordCount,
  runVarianceReview,
} from "../src/modules/inventory.ts";
import { MockBackbone, MockMailer, MockSales, MockSchedule } from "../src/tools/mock.ts";
import type { Toolbox } from "../src/tools/clients.ts";
import { fixtureConfig, fixtureParLevels } from "./fixtures.ts";

test("buildCountChecklist: groups by category in counting order, drops empty groups", () => {
  const groups = buildCountChecklist(fixtureParLevels);
  const cats = groups.map((g) => g.category);
  // liquor, beer, wine, food, other all present in fixtures, in that order.
  assert.deepEqual(cats, ["liquor", "beer", "wine", "food", "other"]);
  const liquor = groups.find((g) => g.category === "liquor")!;
  assert.ok(liquor.items.some((i) => i.item === "Tito's Vodka 1L"));
});

test("computeVariance: counted vs expected, negative = short", () => {
  const counted = [
    { item: "Tito's Vodka 1L", onHand: 5, lastCounted: "", location: "" },
    { item: "Jameson 1L", onHand: 8, lastCounted: "", location: "" },
  ];
  const expected = new Map([
    ["Tito's Vodka 1L", 7],
    ["Jameson 1L", 8],
  ]);
  const v = computeVariance(counted, expected);
  assert.equal(v.find((x) => x.item === "Tito's Vodka 1L")!.variance, -2);
  assert.equal(v.find((x) => x.item === "Jameson 1L")!.variance, 0);
});

test("buildVarianceReportEmail: most-negative first, labels SHORT/OVER", () => {
  const { subject, body } = buildVarianceReportEmail(
    [
      { item: "Found Wine", expectedOnHand: 10, countedOnHand: 12, variance: 2 },
      { item: "Short Vodka", expectedOnHand: 7, countedOnHand: 4, variance: -3 },
    ],
    fixtureConfig,
  );
  assert.match(subject, /variance/i);
  // Short Vodka (-3) must be listed before Found Wine (+2).
  assert.ok(body.indexOf("Short Vodka") < body.indexOf("Found Wine"));
  assert.match(body, /SHORT 3/);
  assert.match(body, /OVER 2/);
});

test("recordCount: flattens a session and persists to the backbone", async () => {
  const data = new MockBackbone();
  await recordCount(data, {
    startedAt: new Date().toISOString(),
    byCategory: {
      liquor: [{ item: "Tito's Vodka 1L", onHand: 3, lastCounted: "", location: "back bar" }],
    },
  });
  const inv = await data.getInventory();
  assert.equal(inv.find((i) => i.item === "Tito's Vodka 1L")!.onHand, 3);
});

test("runVarianceReview: persists counts, flags out-of-tolerance, emails owner", async () => {
  const data = new MockBackbone();
  const mailer = new MockMailer();
  const tb: Toolbox = { data, sales: new MockSales(), schedule: new MockSchedule(), mailer, dryRun: true };

  // Fixture Tito's theoretical on-hand is 10; physically count 6 -> SHORT 4 (flagged).
  // Jameson theoretical 7; count 7 -> variance 0 (not flagged).
  const review = await runVarianceReview(tb, [
    { item: "Tito's Vodka 1L", onHand: 6 },
    { item: "Jameson 1L", onHand: 7 },
  ]);

  assert.equal(review.flagged.length, 1);
  assert.equal(review.flagged[0]!.item, "Tito's Vodka 1L");
  assert.equal(review.flagged[0]!.variance, -4);

  // Counts became the source of truth.
  const inv = await data.getInventory();
  assert.equal(inv.find((i) => i.item === "Tito's Vodka 1L")!.onHand, 6);

  // One variance alert to the owner.
  assert.equal(mailer.sent.length, 1);
  assert.equal(mailer.sent[0]!.to, fixtureConfig.ownerEmail);
});

test("runVarianceReview: no alert when everything is within tolerance", async () => {
  const data = new MockBackbone();
  const mailer = new MockMailer();
  const tb: Toolbox = { data, sales: new MockSales(), schedule: new MockSchedule(), mailer, dryRun: true };

  const review = await runVarianceReview(tb, [{ item: "Jameson 1L", onHand: 7 }]); // matches fixture 7
  assert.equal(review.flagged.length, 0);
  assert.equal(mailer.sent.length, 0);
  assert.equal(review.email, null);
});
