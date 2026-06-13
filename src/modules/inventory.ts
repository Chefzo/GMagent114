// Module: inventory counting.
//
// Flow: the agent walks staff through a guided physical count, category by
// category (liquor -> beer -> wine -> food -> other), writes the results to the
// Inventory tab as the source of truth, and computes variance between what was
// physically counted and the theoretical on-hand the system was tracking
// (decremented by Toast sales). Negative variance = shrinkage / over-pours.
//
// "Mostly automatic + alerts": a scheduled job emails a count reminder/checklist
// (buildCountReminderEmail); once counts come in via chat, runVarianceReview
// persists them and alerts the owner to anything outside tolerance.

import { log } from "../lib/logger.ts";
import type { BarConfig, Category, CountEntry, InventoryItem, ParLevel } from "../lib/types.ts";
import type { DataBackbone, Toolbox } from "../tools/clients.ts";

/** Order categories are counted in (back bar to storage). */
const CATEGORY_ORDER: Category[] = ["liquor", "beer", "wine", "food", "other"];

export interface CountSession {
  startedAt: string;
  byCategory: Partial<Record<Category, InventoryItem[]>>;
}

/** Variance between counted on-hand and the system's theoretical on-hand (negative = shrinkage). */
export interface UsageVariance {
  item: string;
  expectedOnHand: number;
  countedOnHand: number;
  variance: number;
}

export interface ChecklistGroup {
  category: Category;
  items: { item: string; unit: string }[];
}

/** Pure: group the items to count by category, in counting order. */
export function buildCountChecklist(parLevels: ParLevel[]): ChecklistGroup[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    items: parLevels
      .filter((p) => p.category === category)
      .map((p) => ({ item: p.item, unit: p.unit })),
  })).filter((g) => g.items.length > 0);
}

/** Pure: the scheduled "time to count" reminder email. */
export function buildCountReminderEmail(
  checklist: ChecklistGroup[],
  config: BarConfig,
): { subject: string; body: string } {
  const total = checklist.reduce((n, g) => n + g.items.length, 0);
  const blocks = checklist.map((g) => {
    const items = g.items.map((it) => `    • ${it.item} (${it.unit})`).join("\n");
    return `  ${g.category.toUpperCase()}\n${items}`;
  });
  const subject = `[${config.barName}] Time to count inventory — ${total} item(s)`;
  const body = [
    `Inventory count for ${config.barName}. Count each item below and reply with the on-hand numbers`,
    `(e.g. "Tito's 7, Jameson 3, Bud Light 5") — I'll record them and flag anything off.`,
    "",
    ...blocks,
    "",
    `Counting in this order (back bar first) keeps it quick. Reply when you're done.`,
  ].join("\n");
  return { subject, body };
}

/** Pure: compare a fresh physical count to the expected (theoretical) on-hand. */
export function computeVariance(
  counted: InventoryItem[],
  expected: Map<string, number>,
): UsageVariance[] {
  return counted.map((c) => {
    const expectedOnHand = expected.get(c.item) ?? c.onHand;
    return {
      item: c.item,
      expectedOnHand,
      countedOnHand: c.onHand,
      variance: c.onHand - expectedOnHand,
    };
  });
}

/** Pure: the post-count alert listing items outside tolerance (shrinkage first). */
export function buildVarianceReportEmail(
  flagged: UsageVariance[],
  config: BarConfig,
): { subject: string; body: string } {
  const sorted = [...flagged].sort((a, b) => a.variance - b.variance); // most negative first
  const lines = sorted.map((v) => {
    const sign = v.variance < 0 ? "SHORT" : "OVER";
    return `  • ${v.item}: counted ${v.countedOnHand}, expected ${v.expectedOnHand} → ${sign} ${Math.abs(v.variance)}`;
  });
  const subject = `[${config.barName}] Inventory variance — ${flagged.length} item(s) outside tolerance`;
  const body = [
    `Count recorded for ${config.barName}. These items differ from what sales said should be on hand`,
    `(SHORT = possible over-pour/shrinkage, OVER = received-but-not-logged or a counting slip):`,
    "",
    ...lines,
    "",
    `The counts are now the source of truth and feed the next order.`,
  ].join("\n");
  return { subject, body };
}

/** Flatten a guided count session and persist it to the Inventory tab. */
export async function recordCount(data: DataBackbone, session: CountSession): Promise<void> {
  const counts: CountEntry[] = [];
  for (const items of Object.values(session.byCategory)) {
    for (const it of items ?? []) counts.push({ item: it.item, onHand: it.onHand, location: it.location });
  }
  await data.applyCounts(counts);
}

export interface VarianceReview {
  variances: UsageVariance[];
  flagged: UsageVariance[];
  email: { subject: string; body: string } | null;
}

/**
 * Orchestrate a count review:
 *  1) read current (theoretical) on-hand as the "expected" baseline
 *  2) compute variance against the physical counts
 *  3) persist the counts (they become the source of truth)
 *  4) email the owner if anything is outside tolerance (|variance| >= minAbsVariance)
 */
export async function runVarianceReview(
  tb: Toolbox,
  counts: CountEntry[],
  opts: { minAbsVariance?: number } = {},
): Promise<VarianceReview> {
  const minAbs = opts.minAbsVariance ?? 1;
  const config = await tb.data.getConfig();
  const inventory = await tb.data.getInventory();
  const expected = new Map(inventory.map((i) => [i.item, i.onHand]));
  const locOf = new Map(inventory.map((i) => [i.item, i.location]));

  const today = new Date().toISOString().slice(0, 10);
  const counted: InventoryItem[] = counts.map((c) => ({
    item: c.item,
    onHand: c.onHand,
    lastCounted: today,
    location: c.location ?? locOf.get(c.item) ?? "",
  }));

  const variances = computeVariance(counted, expected);
  const flagged = variances.filter((v) => Math.abs(v.variance) >= minAbs);

  await tb.data.applyCounts(counts);
  log.info(`Recorded ${counts.length} count(s); ${flagged.length} outside tolerance (>=${minAbs}).`);

  let email: { subject: string; body: string } | null = null;
  if (flagged.length > 0) {
    email = buildVarianceReportEmail(flagged, config);
    await tb.mailer.send(config.ownerEmail, email.subject, email.body);
  }
  return { variances, flagged, email };
}
