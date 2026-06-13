// Tests for the reorder math, approval parsing, and the end-to-end dry-run pass.
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeReorder, runOrderingPass, sendApprovedOrders } from "../src/modules/ordering.ts";
import { parseApprovalReply, resolveApprovedVendors } from "../src/lib/approval.ts";
import { MockBackbone, MockMailer, MockSales } from "../src/tools/mock.ts";
import type { Toolbox } from "../src/tools/clients.ts";
import { fixtureCatalog, fixtureConfig, fixtureInventory, fixtureParLevels } from "./fixtures.ts";

test("computeReorder: only items at/below reorder point, ordered up to par, rounded to packs", () => {
  // Inventory here is the POST-depletion state we expect in fixtures.
  const inv = [
    { item: "Tito's Vodka 1L", onHand: 5, lastCounted: "", location: "" }, // <=6 -> order
    { item: "Jameson 1L", onHand: 3, lastCounted: "", location: "" }, // <=4 -> order
    { item: "Bud Light 12oz", onHand: 3, lastCounted: "", location: "" }, // <=4 -> order
    { item: "Cabernet House", onHand: 14, lastCounted: "", location: "" }, // >9 -> skip
    { item: "Lime", onHand: 1, lastCounted: "", location: "" }, // <=1 -> order
    { item: "Cocktail Napkins", onHand: 4, lastCounted: "", location: "" }, // >2 -> skip
  ];
  const drafts = computeReorder(fixtureParLevels, inv, fixtureCatalog, fixtureConfig);

  // breakthru (Tito's + Jameson), localbeer (Bud Light), gfs (Lime) => 3 vendors
  assert.equal(drafts.length, 3);

  const breakthru = drafts.find((d) => d.vendor.key === "breakthru")!;
  const titos = breakthru.lines.find((l) => l.item === "Tito's Vodka 1L")!;
  // need 12-5=7 units, packSize 6 -> 2 packs
  assert.equal(titos.packs, 2);
  const jame = breakthru.lines.find((l) => l.item === "Jameson 1L")!;
  // need 8-3=5 units, packSize 6 -> 1 pack
  assert.equal(jame.packs, 1);

  // Cabernet must not appear anywhere (above reorder point).
  assert.ok(!drafts.some((d) => d.lines.some((l) => l.item === "Cabernet House")));
});

test("computeReorder: skips items with no catalog entry", () => {
  const par = [{ item: "Mystery Amaro", category: "liquor" as const, unit: "bottle", par: 4, reorderPoint: 2, vendor: "breakthru" }];
  const inv = [{ item: "Mystery Amaro", onHand: 0, lastCounted: "", location: "" }];
  const drafts = computeReorder(par, inv, [], fixtureConfig);
  assert.equal(drafts.length, 0);
});

test("parseApprovalReply: handles ALL, single vendor, and skip", () => {
  assert.deepEqual(parseApprovalReply("approve all please"), { approveAll: true, vendorKeys: [], skip: false });
  assert.deepEqual(parseApprovalReply("APPROVE GFS"), { approveAll: false, vendorKeys: ["gfs"], skip: false });
  assert.deepEqual(parseApprovalReply("approve gfs approve breakthru"), {
    approveAll: false,
    vendorKeys: ["gfs", "breakthru"],
    skip: false,
  });
  assert.equal(parseApprovalReply("let's skip this week").skip, true);
});

test("end-to-end dry-run: depletion applied, drafts produced, approval email sent, approved orders sent", async () => {
  const data = new MockBackbone();
  const mailer = new MockMailer();
  const tb: Toolbox = { data, sales: new MockSales(), mailer, dryRun: true };

  const { drafts, approvalEmail } = await runOrderingPass(tb, "2026-06-09T00:00:00Z");

  // Tito's started at 10, depletion 5 -> 5 on hand, triggers reorder.
  assert.ok(drafts.some((d) => d.lines.some((l) => l.item === "Tito's Vodka 1L")));
  // One approval email to the owner.
  assert.equal(mailer.sent.length, 1);
  assert.match(mailer.sent[0]!.subject, /Order approval needed/);
  assert.match(approvalEmail.body, /APPROVE ALL/);

  // Approve everything -> vendor emails sent + orders recorded.
  const decision = parseApprovalReply("APPROVE ALL");
  const approved = resolveApprovedVendors(decision, drafts);
  await sendApprovedOrders(tb, drafts, approved, await data.getConfig());

  assert.equal(data.orders.length, drafts.length);
  // GFS order carries an order-guide CSV attachment.
  const gfsMail = mailer.sent.find((m) => m.attachments.some((a) => a.filename === "order-guide.csv"));
  assert.ok(gfsMail, "expected a GFS email with an order-guide.csv attachment");
});
