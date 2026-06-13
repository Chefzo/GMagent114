// Shared domain types for the GM Agent. These mirror the Google Sheets tabs
// documented in config/sheets.schema.md and are the contract between the
// data backbone, the modules, and the vendor clients.

export type Category = "liquor" | "beer" | "wine" | "food" | "other";

/** A row of the ParLevels tab: the target stock for one item and where to reorder it. */
export interface ParLevel {
  item: string;
  category: Category;
  /** Unit a count is expressed in, e.g. "bottle", "case", "lb". */
  unit: string;
  /** Desired on-hand quantity after an order is received. */
  par: number;
  /** When on-hand drops to/below this, reorder. */
  reorderPoint: number;
  /** Vendor key (matches Config.vendors and VendorCatalog.vendor). */
  vendor: string;
}

/** A row of the Inventory tab: the current count for one item. */
export interface InventoryItem {
  item: string;
  onHand: number;
  lastCounted: string; // ISO date
  location: string; // "back bar" | "storage" | ...
}

/** A row of the VendorCatalog tab: how an item is ordered from a vendor. */
export interface CatalogEntry {
  vendor: string;
  item: string;
  sku: string;
  /** How many `unit`s come in one orderable pack/case. */
  packSize: number;
  lastPrice: number; // per pack
}

/** A vendor we can place an order with. */
export interface Vendor {
  key: string;
  name: string;
  email: string;
  /** How the agent submits an order. GFS/liquor are email today (no single-store API). */
  channel: "email" | "gfs-orderguide";
}

/** One line on a drafted order. */
export interface OrderLine {
  item: string;
  sku: string;
  packs: number; // packs/cases to order
  unitsPerPack: number;
  estUnitPrice: number; // per pack
  estLineCost: number;
  reason: string; // human-readable "why"
}

/** A complete drafted order for one vendor, awaiting approval. */
export interface DraftOrder {
  vendor: Vendor;
  lines: OrderLine[];
  estTotal: number;
  /** ISO timestamp the draft was created. */
  createdAt: string;
}

/** A unit of sales/depletion pulled from Toast for the ordering math. */
export interface Depletion {
  item: string;
  /** Units consumed since the last order (already converted to ParLevel.unit). */
  unitsUsed: number;
}

export interface BarConfig {
  barName: string;
  ownerEmail: string;
  orderDays: string[];
  vendors: Record<string, Vendor>;
}
