// V1 module: ordering. Pure reorder math (computeReorder) plus the run
// orchestration that pulls sales from Toast, updates inventory in Sheets,
// drafts per-vendor orders, and emails them for one-tap approval.

import { log } from "../lib/logger.ts";
import type {
  BarConfig,
  CatalogEntry,
  DraftOrder,
  InventoryItem,
  OrderLine,
  ParLevel,
} from "../lib/types.ts";
import type { Toolbox } from "../tools/clients.ts";
import { buildOrderEmail, buildOrderGuideCsv } from "../tools/gfs.ts";

/**
 * Pure: given par levels, current on-hand inventory, and the vendor catalog,
 * produce one DraftOrder per vendor for every item at/below its reorder point,
 * ordering up to par and rounding up to whole packs/cases.
 */
export function computeReorder(
  parLevels: ParLevel[],
  inventory: InventoryItem[],
  catalog: CatalogEntry[],
  config: BarConfig,
): DraftOrder[] {
  const onHand = new Map(inventory.map((i) => [i.item, i.onHand]));
  const byVendorItem = new Map(catalog.map((c) => [`${c.vendor}::${c.item}`, c]));
  const createdAt = new Date().toISOString();

  const linesByVendor = new Map<string, OrderLine[]>();

  for (const par of parLevels) {
    const have = onHand.get(par.item) ?? 0;
    if (have > par.reorderPoint) continue; // still above the trigger

    const cat = byVendorItem.get(`${par.vendor}::${par.item}`);
    if (!cat) {
      log.warn(`No catalog entry for "${par.item}" @ vendor "${par.vendor}" — skipping reorder`);
      continue;
    }

    const neededUnits = Math.max(0, par.par - have);
    if (neededUnits <= 0) continue;
    const packs = Math.ceil(neededUnits / cat.packSize);
    const line: OrderLine = {
      item: par.item,
      sku: cat.sku,
      packs,
      unitsPerPack: cat.packSize,
      estUnitPrice: cat.lastPrice,
      estLineCost: packs * cat.lastPrice,
      reason: `on-hand ${have} ${par.unit} <= reorder ${par.reorderPoint}; up to par ${par.par}`,
    };
    const list = linesByVendor.get(par.vendor) ?? [];
    list.push(line);
    linesByVendor.set(par.vendor, list);
  }

  const drafts: DraftOrder[] = [];
  for (const [vendorKey, lines] of linesByVendor) {
    const vendor = config.vendors[vendorKey];
    if (!vendor) {
      log.warn(`Vendor "${vendorKey}" not in Config — skipping its order`);
      continue;
    }
    drafts.push({
      vendor,
      lines,
      estTotal: lines.reduce((s, l) => s + l.estLineCost, 0),
      createdAt,
    });
  }
  // Stable, predictable ordering of the drafts (by vendor name).
  drafts.sort((a, b) => a.vendor.name.localeCompare(b.vendor.name));
  return drafts;
}

/** Render the single approval email summarizing every drafted order. */
export function buildApprovalEmail(drafts: DraftOrder[], config: BarConfig): { subject: string; body: string } {
  const grandTotal = drafts.reduce((s, d) => s + d.estTotal, 0);
  const blocks = drafts.map((d) => {
    const items = d.lines
      .map((l) => `    • ${l.item}: ${l.packs} pack(s) — est $${l.estLineCost.toFixed(2)}  (${l.reason})`)
      .join("\n");
    return `  ${d.vendor.name}  [reply "APPROVE ${d.vendor.key.toUpperCase()}"]  est $${d.estTotal.toFixed(2)}\n${items}`;
  });
  const subject = `[${config.barName}] Order approval needed — ${drafts.length} vendor(s), est $${grandTotal.toFixed(2)}`;
  const body = [
    `Good morning — here are the proposed orders for ${config.barName} based on what sold and current back-bar counts.`,
    "",
    ...blocks,
    "",
    `Grand total (estimate): $${grandTotal.toFixed(2)}`,
    "",
    `Reply "APPROVE ALL" to send everything, or "APPROVE <VENDOR>" for one.`,
    `Reply "SKIP" to hold. Nothing is ordered until you approve.`,
  ].join("\n");
  return { subject, body };
}

export interface OrderingResult {
  drafts: DraftOrder[];
  approvalEmail: { subject: string; body: string };
}

/**
 * Orchestrate one ordering run:
 *  1) pull depletion from Toast since `sinceIso`
 *  2) apply it to Inventory in the data backbone
 *  3) compute per-vendor reorders
 *  4) email the owner one approval summary (sending the actual vendor orders is
 *     gated on approval — see runOrdering / approval.ts)
 */
export async function runOrderingPass(tb: Toolbox, sinceIso: string): Promise<OrderingResult> {
  const config = await tb.data.getConfig();

  const depletion = await tb.sales.getDepletionSince(sinceIso);
  await tb.data.applyDepletion(depletion);

  const [parLevels, inventory, catalog] = await Promise.all([
    tb.data.getParLevels(),
    tb.data.getInventory(),
    tb.data.getCatalog(),
  ]);

  const drafts = computeReorder(parLevels, inventory, catalog, config);
  log.info(`Drafted ${drafts.length} vendor order(s) totaling $${drafts.reduce((s, d) => s + d.estTotal, 0).toFixed(2)}`);

  const approvalEmail = buildApprovalEmail(drafts, config);
  if (drafts.length > 0) {
    await tb.mailer.send(config.ownerEmail, approvalEmail.subject, approvalEmail.body);
  } else {
    log.info("Nothing below reorder point — no approval email sent.");
  }

  return { drafts, approvalEmail };
}

/**
 * After the owner approves, send the actual vendor orders and log them.
 * `approvedVendorKeys` = the vendors to send (e.g. ["gfs","breakthru"] or all).
 */
export async function sendApprovedOrders(
  tb: Toolbox,
  drafts: DraftOrder[],
  approvedVendorKeys: string[],
  config: BarConfig,
): Promise<void> {
  for (const draft of drafts) {
    if (!approvedVendorKeys.includes(draft.vendor.key)) continue;
    const body = buildOrderEmail(draft, config.barName);
    const attachments =
      draft.vendor.channel === "gfs-orderguide"
        ? [{ filename: "order-guide.csv", mimeType: "text/csv", content: buildOrderGuideCsv(draft) }]
        : [];
    await tb.mailer.send(draft.vendor.email, `Order from ${config.barName}`, body, attachments);
    await tb.data.recordOrder(
      draft.vendor.key,
      draft.lines.map((l) => ({ item: l.item, packs: l.packs })),
      draft.estTotal,
    );
  }
}
