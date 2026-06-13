// Sample data for dry-runs and tests: a small but realistic back-bar setup
// for "114". Used by the mock toolbox so the ordering job runs end-to-end with
// no credentials and no side effects.

import type {
  BarConfig,
  CatalogEntry,
  Depletion,
  InventoryItem,
  ParLevel,
} from "../src/lib/types.ts";

export const fixtureConfig: BarConfig = {
  barName: "114",
  ownerEmail: "owner@114.example",
  orderDays: ["Mon", "Thu"],
  vendors: {
    gfs: { key: "gfs", name: "Gordon Food Service", email: "rep@gfs.example", channel: "gfs-orderguide" },
    breakthru: { key: "breakthru", name: "Breakthru Beverage", email: "orders@breakthru.example", channel: "email" },
    localbeer: { key: "localbeer", name: "Local Beer Distributor", email: "orders@localbeer.example", channel: "email" },
  },
};

export const fixtureParLevels: ParLevel[] = [
  { item: "Tito's Vodka 1L", category: "liquor", unit: "bottle", par: 12, reorderPoint: 6, vendor: "breakthru" },
  { item: "Jameson 1L", category: "liquor", unit: "bottle", par: 8, reorderPoint: 4, vendor: "breakthru" },
  { item: "Bud Light 12oz", category: "beer", unit: "case", par: 10, reorderPoint: 4, vendor: "localbeer" },
  { item: "Cabernet House", category: "wine", unit: "bottle", par: 18, reorderPoint: 9, vendor: "breakthru" },
  { item: "Lime", category: "food", unit: "case", par: 2, reorderPoint: 1, vendor: "gfs" },
  { item: "Cocktail Napkins", category: "other", unit: "case", par: 4, reorderPoint: 2, vendor: "gfs" },
];

export const fixtureInventory: InventoryItem[] = [
  { item: "Tito's Vodka 1L", onHand: 10, lastCounted: "2026-06-09", location: "back bar" },
  { item: "Jameson 1L", onHand: 7, lastCounted: "2026-06-09", location: "back bar" },
  { item: "Bud Light 12oz", onHand: 8, lastCounted: "2026-06-09", location: "storage" },
  { item: "Cabernet House", onHand: 16, lastCounted: "2026-06-09", location: "back bar" },
  { item: "Lime", onHand: 2, lastCounted: "2026-06-09", location: "storage" },
  { item: "Cocktail Napkins", onHand: 4, lastCounted: "2026-06-09", location: "storage" },
];

export const fixtureCatalog: CatalogEntry[] = [
  { vendor: "breakthru", item: "Tito's Vodka 1L", sku: "BT-TITOS-1L", packSize: 6, lastPrice: 110.0 },
  { vendor: "breakthru", item: "Jameson 1L", sku: "BT-JAME-1L", packSize: 6, lastPrice: 156.0 },
  { vendor: "breakthru", item: "Cabernet House", sku: "BT-CABHSE", packSize: 12, lastPrice: 96.0 },
  { vendor: "localbeer", item: "Bud Light 12oz", sku: "LB-BUDLT-CS", packSize: 1, lastPrice: 24.5 },
  { vendor: "gfs", item: "Lime", sku: "GFS-LIME-CS", packSize: 1, lastPrice: 28.0 },
  { vendor: "gfs", item: "Cocktail Napkins", sku: "GFS-NAPKIN-CS", packSize: 1, lastPrice: 19.0 },
];

// Depletion since the last order: enough to pull several items at/under par.
export const fixtureDepletion: Depletion[] = [
  { item: "Tito's Vodka 1L", unitsUsed: 5 }, // 10 -> 5  (<= reorderPoint 6)
  { item: "Jameson 1L", unitsUsed: 4 }, //     7 -> 3  (<= 4)
  { item: "Bud Light 12oz", unitsUsed: 5 }, // 8 -> 3  (<= 4)
  { item: "Cabernet House", unitsUsed: 2 }, // 16 -> 14 (> 9, no reorder)
  { item: "Lime", unitsUsed: 1 }, //           2 -> 1  (<= 1)
  { item: "Cocktail Napkins", unitsUsed: 0 }, // 4 -> 4 (> 2, no reorder)
];
