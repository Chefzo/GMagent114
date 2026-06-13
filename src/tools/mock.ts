// Fixture-backed implementations of the client interfaces, used for --dry-run
// and tests. No network, no side effects: writes mutate in-memory copies and
// emails are logged, so the full ordering flow can be exercised safely.

import { log } from "../lib/logger.ts";
import type { BarConfig, CatalogEntry, Depletion, InventoryItem, ParLevel } from "../lib/types.ts";
import type { Attachment, DataBackbone, Mailer, SalesSource, Toolbox } from "./clients.ts";
import {
  fixtureCatalog,
  fixtureConfig,
  fixtureDepletion,
  fixtureInventory,
  fixtureParLevels,
} from "../../test/fixtures.ts";

export class MockBackbone implements DataBackbone {
  inventory: InventoryItem[] = fixtureInventory.map((i) => ({ ...i }));
  orders: { vendorKey: string; lines: { item: string; packs: number }[]; estTotal: number }[] = [];

  async getConfig(): Promise<BarConfig> {
    return fixtureConfig;
  }
  async getParLevels(): Promise<ParLevel[]> {
    return fixtureParLevels.map((p) => ({ ...p }));
  }
  async getInventory(): Promise<InventoryItem[]> {
    return this.inventory.map((i) => ({ ...i }));
  }
  async getCatalog(): Promise<CatalogEntry[]> {
    return fixtureCatalog.map((c) => ({ ...c }));
  }
  async applyDepletion(depletion: Depletion[]): Promise<void> {
    const used = new Map(depletion.map((d) => [d.item, d.unitsUsed]));
    for (const inv of this.inventory) {
      inv.onHand = Math.max(0, inv.onHand - (used.get(inv.item) ?? 0));
    }
    log.info(`[dry-run] applied depletion to ${depletion.length} item(s)`);
  }
  async recordOrder(vendorKey: string, lines: { item: string; packs: number }[], estTotal: number): Promise<void> {
    this.orders.push({ vendorKey, lines, estTotal });
    log.info(`[dry-run] recorded order to ${vendorKey} ($${estTotal.toFixed(2)})`);
  }
}

export class MockSales implements SalesSource {
  async getDepletionSince(_sinceIso: string): Promise<Depletion[]> {
    return fixtureDepletion.map((d) => ({ ...d }));
  }
}

export class MockMailer implements Mailer {
  sent: { to: string; subject: string; body: string; attachments: Attachment[] }[] = [];
  async send(to: string, subject: string, body: string, attachments: Attachment[] = []): Promise<void> {
    this.sent.push({ to, subject, body, attachments });
    log.info(`[dry-run] would email ${to}: "${subject}"`);
    log.debug(`[dry-run] body:\n${body}`);
  }
}

export function mockToolbox(): Toolbox {
  return { data: new MockBackbone(), sales: new MockSales(), mailer: new MockMailer(), dryRun: true };
}
