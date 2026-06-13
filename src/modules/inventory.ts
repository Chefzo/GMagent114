// Module: inventory counting (built after v1 ordering).
//
// Planned flow: the agent walks the bartender through a guided count
// category-by-category (liquor -> beer -> wine -> food), writes results to the
// Inventory tab, then computes usage variance against Toast depletion to surface
// over-pours / shrinkage. This file defines the interface the count flow will
// use so the ordering module can already consume fresh counts.

import type { DataBackbone } from "../tools/clients.ts";
import type { Category, InventoryItem } from "../lib/types.ts";

export interface CountSession {
  startedAt: string;
  byCategory: Partial<Record<Category, InventoryItem[]>>;
}

/** Variance between counted on-hand and Toast-implied on-hand (negative = shrinkage). */
export interface UsageVariance {
  item: string;
  expectedOnHand: number;
  countedOnHand: number;
  variance: number;
}

export async function recordCount(_data: DataBackbone, _session: CountSession): Promise<void> {
  throw new Error("inventory.recordCount not implemented yet — scheduled after v1 ordering.");
}

export function computeVariance(
  counted: InventoryItem[],
  expected: Map<string, number>,
): UsageVariance[] {
  // Pure and already usable: compare a fresh count to expected on-hand.
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
