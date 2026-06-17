// Fixture-backed implementations of the client interfaces, used for --dry-run
// and tests. No network, no side effects: writes mutate in-memory copies and
// emails are logged, so the full ordering flow can be exercised safely.

import { log } from "../lib/logger.ts";
import type {
  BarConfig,
  CatalogEntry,
  CountEntry,
  Depletion,
  InventoryItem,
  ParLevel,
  SchedulingConfig,
  Shift,
} from "../lib/types.ts";
import type { Attachment, DataBackbone, Mailer, SalesSource, ScheduleSource, Toolbox } from "./clients.ts";
import {
  fixtureCatalog,
  fixtureConfig,
  fixtureDepletion,
  fixtureInventory,
  fixtureParLevels,
  fixtureScheduling,
  fixtureShifts,
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
  async getSchedulingConfig(): Promise<SchedulingConfig> {
    return { ...fixtureScheduling, coverageRules: fixtureScheduling.coverageRules.map((r) => ({ ...r })) };
  }
  async applyDepletion(depletion: Depletion[]): Promise<void> {
    const used = new Map(depletion.map((d) => [d.item, d.unitsUsed]));
    for (const inv of this.inventory) {
      inv.onHand = Math.max(0, inv.onHand - (used.get(inv.item) ?? 0));
    }
    log.info(`[dry-run] applied depletion to ${depletion.length} item(s)`);
  }
  async applyCounts(counts: CountEntry[]): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    for (const c of counts) {
      const existing = this.inventory.find((i) => i.item === c.item);
      if (existing) {
        existing.onHand = c.onHand;
        existing.lastCounted = today;
        if (c.location) existing.location = c.location;
      } else {
        this.inventory.push({ item: c.item, onHand: c.onHand, lastCounted: today, location: c.location ?? "" });
      }
    }
    log.info(`[dry-run] applied physical counts to ${counts.length} item(s)`);
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

export class MockSchedule implements ScheduleSource {
  async getShifts(_fromIso: string, _toIso: string): Promise<Shift[]> {
    return fixtureShifts.map((s) => ({ ...s }));
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
  return {
    data: new MockBackbone(),
    sales: new MockSales(),
    schedule: new MockSchedule(),
    mailer: new MockMailer(),
    dryRun: true,
  };
}
