// GFS / liquor order rendering. Because GFS has no single-store public order
// API, the agent submits orders as (a) a human-readable email to your rep and
// (b) an attached order-guide CSV that matches Gordon Ordering's import format
// (item SKU, description, quantity). Liquor distributors get the email body only.

import type { DraftOrder } from "../lib/types.ts";

/** Build the GFS order-guide CSV (SKU, Description, OrderQty) for one draft. */
export function buildOrderGuideCsv(order: DraftOrder): string {
  const header = "SKU,Description,OrderQty";
  const rows = order.lines.map((l) => `${l.sku},"${l.item.replace(/"/g, '""')}",${l.packs}`);
  return [header, ...rows].join("\n");
}

/** Build the plain-text email body a vendor (or your GFS rep) reads. */
export function buildOrderEmail(order: DraftOrder, barName: string): string {
  const lines = order.lines.map(
    (l) =>
      `  - ${l.item} (SKU ${l.sku}): ${l.packs} x ${l.unitsPerPack} ` +
      `= ${l.packs * l.unitsPerPack} units  [${l.reason}]`,
  );
  return [
    `Order from ${barName}`,
    `Vendor: ${order.vendor.name}`,
    `Drafted: ${order.createdAt}`,
    "",
    "Items:",
    ...lines,
    "",
    `Estimated total: $${order.estTotal.toFixed(2)}`,
    "",
    order.vendor.channel === "gfs-orderguide"
      ? "An order-guide CSV is attached for Gordon Ordering import."
      : "Please confirm availability and delivery date.",
  ].join("\n");
}
