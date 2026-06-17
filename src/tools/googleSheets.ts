// Live Google Sheets backbone. Reads each tab via the Sheets v4 REST API and
// maps header rows to typed objects; writes via values:update / values:append.
// See config/sheets.schema.md for the expected tab + column layout.

import { googleAccessToken } from "../lib/auth.ts";
import { requireEnv } from "../lib/config.ts";
import { log } from "../lib/logger.ts";
import type {
  BarConfig,
  CatalogEntry,
  Category,
  CountEntry,
  CoverageRule,
  Depletion,
  InventoryItem,
  OrderRecord,
  ParLevel,
  SchedulingConfig,
  Vendor,
} from "../lib/types.ts";
import type { DataBackbone } from "./clients.ts";

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const API = "https://sheets.googleapis.com/v4/spreadsheets";

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
/** Parse a Coverage `day` cell: a number 0-6, or a name like "Mon"/"Friday". */
function parseDay(raw: string): number {
  const t = raw.trim().toLowerCase();
  if (/^\d+$/.test(t)) return Number(t);
  const i = DAY_NAMES.indexOf(t.slice(0, 3));
  return i === -1 ? 0 : i;
}

/** Map a sheet's first row to keys, returning the rest as keyed records. */
function rowsToObjects(values: string[][]): Record<string, string>[] {
  if (values.length === 0) return [];
  const header = values[0]!.map((h) => h.trim());
  return values.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    header.forEach((key, i) => (obj[key] = (row[i] ?? "").trim()));
    return obj;
  });
}

export class GoogleSheetsBackbone implements DataBackbone {
  private readonly id = requireEnv("GM_SPREADSHEET_ID");

  private async token(): Promise<string> {
    return googleAccessToken([SCOPE]);
  }

  private async readTab(tab: string): Promise<Record<string, string>[]> {
    const token = await this.token();
    const url = `${API}/${this.id}/values/${encodeURIComponent(tab)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Sheets read ${tab} failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { values?: string[][] };
    return rowsToObjects(json.values ?? []);
  }

  private async appendRow(tab: string, row: (string | number)[]): Promise<void> {
    const token = await this.token();
    const url =
      `${API}/${this.id}/values/${encodeURIComponent(tab)}:append` +
      `?valueInputOption=USER_ENTERED`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [row] }),
    });
    if (!res.ok) throw new Error(`Sheets append ${tab} failed: ${res.status} ${await res.text()}`);
  }

  async getConfig(): Promise<BarConfig> {
    const rows = await this.readTab("Config");
    const kv: Record<string, string> = {};
    for (const r of rows) if (r.key) kv[r.key] = r.value ?? "";

    const vendors: Record<string, Vendor> = {};
    // Vendor rows are encoded as key="vendor:<key>", value="Name|email|channel".
    for (const r of rows) {
      if (!r.key?.startsWith("vendor:")) continue;
      const key = r.key.slice("vendor:".length);
      const [name = key, email = "", channel = "email"] = (r.value ?? "").split("|");
      vendors[key] = { key, name, email, channel: channel as Vendor["channel"] };
    }

    return {
      barName: kv.barName ?? "114",
      ownerEmail: kv.ownerEmail ?? requireEnv("OWNER_EMAIL"),
      orderDays: (kv.orderDays ?? "Mon,Thu").split(",").map((d) => d.trim()),
      vendors,
    };
  }

  async getParLevels(): Promise<ParLevel[]> {
    return (await this.readTab("ParLevels")).map((r) => ({
      item: r.item ?? "",
      category: (r.category ?? "other") as Category,
      unit: r.unit ?? "each",
      par: Number(r.par ?? 0),
      reorderPoint: Number(r.reorderPoint ?? 0),
      vendor: r.vendor ?? "",
    }));
  }

  async getInventory(): Promise<InventoryItem[]> {
    return (await this.readTab("Inventory")).map((r) => ({
      item: r.item ?? "",
      onHand: Number(r.onHand ?? 0),
      lastCounted: r.lastCounted ?? "",
      location: r.location ?? "",
    }));
  }

  async getCatalog(): Promise<CatalogEntry[]> {
    return (await this.readTab("VendorCatalog")).map((r) => ({
      vendor: r.vendor ?? "",
      item: r.item ?? "",
      sku: r.sku ?? "",
      packSize: Number(r.packSize ?? 1),
      lastPrice: Number(r.lastPrice ?? 0),
    }));
  }

  async getSchedulingConfig(): Promise<SchedulingConfig> {
    const rows = await this.readTab("Config");
    const kv: Record<string, string> = {};
    const wageByBartender: Record<string, number> = {};
    for (const r of rows) {
      if (!r.key) continue;
      if (r.key.startsWith("wage:")) wageByBartender[r.key.slice("wage:".length)] = Number(r.value ?? 0);
      else kv[r.key] = r.value ?? "";
    }

    // Coverage rules live in their own tab; absent tab => no rules (no gaps).
    let coverageRules: CoverageRule[] = [];
    try {
      coverageRules = (await this.readTab("Coverage")).map((r) => ({
        day: parseDay(r.day ?? ""),
        minBartenders: Number(r.minBartenders ?? 1),
        startHour: Number(r.startHour ?? 0),
        endHour: Number(r.endHour ?? 24),
      }));
    } catch {
      log.debug("No Coverage tab found — skipping coverage-gap checks.");
    }

    const budget = kv.weeklyLaborBudget ? Number(kv.weeklyLaborBudget) : undefined;
    return {
      coverageRules,
      overtimeThreshold: kv.overtimeThreshold ? Number(kv.overtimeThreshold) : 40,
      defaultHourlyWage: kv.defaultHourlyWage ? Number(kv.defaultHourlyWage) : 15,
      wageByBartender,
      weeklyLaborBudget: budget,
    };
  }

  async getOrderHistory(sinceIso: string): Promise<OrderRecord[]> {
    const rows = await this.readTab("OrderHistory");
    return rows
      .map((r) => ({
        timestamp: r.timestamp ?? "",
        vendor: r.vendor ?? "",
        items: r.items ?? "",
        estTotal: Number(r.estTotal ?? 0),
        status: r.status ?? "",
      }))
      .filter((o) => o.timestamp >= sinceIso); // ISO strings sort lexicographically
  }

  /** Overwrite the whole Inventory tab from a list of rows. */
  private async writeInventory(items: InventoryItem[]): Promise<void> {
    const token = await this.token();
    const header = ["item", "onHand", "lastCounted", "location"];
    const values: (string | number)[][] = [header];
    for (const inv of items) values.push([inv.item, inv.onHand, inv.lastCounted, inv.location]);
    const url =
      `${API}/${this.id}/values/${encodeURIComponent("Inventory")}` +
      `?valueInputOption=USER_ENTERED`;
    const res = await fetch(url, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    });
    if (!res.ok) throw new Error(`Sheets write Inventory failed: ${res.status} ${await res.text()}`);
  }

  async applyDepletion(depletion: Depletion[]): Promise<void> {
    // Read current inventory, subtract depletion, write the whole tab back.
    const current = await this.getInventory();
    const used = new Map(depletion.map((d) => [d.item, d.unitsUsed]));
    const today = new Date().toISOString().slice(0, 10);
    const next = current.map((inv) => ({
      ...inv,
      onHand: Math.max(0, inv.onHand - (used.get(inv.item) ?? 0)),
      lastCounted: used.has(inv.item) ? today : inv.lastCounted,
    }));
    await this.writeInventory(next);
    log.info(`Applied depletion to ${depletion.length} item(s) in Inventory`);
  }

  async applyCounts(counts: CountEntry[]): Promise<void> {
    // Physical counts are the source of truth: upsert each counted item's
    // on-hand and stamp today's date; preserve existing location unless given.
    const current = await this.getInventory();
    const today = new Date().toISOString().slice(0, 10);
    const byItem = new Map(current.map((i) => [i.item, { ...i }]));
    for (const c of counts) {
      const existing = byItem.get(c.item);
      byItem.set(c.item, {
        item: c.item,
        onHand: c.onHand,
        lastCounted: today,
        location: c.location ?? existing?.location ?? "",
      });
    }
    await this.writeInventory([...byItem.values()]);
    log.info(`Applied physical counts to ${counts.length} item(s) in Inventory`);
  }

  async recordOrder(
    vendorKey: string,
    lines: { item: string; packs: number }[],
    estTotal: number,
  ): Promise<void> {
    const summary = lines.map((l) => `${l.item} x${l.packs}`).join("; ");
    await this.appendRow("OrderHistory", [
      new Date().toISOString(),
      vendorKey,
      summary,
      estTotal.toFixed(2),
      "sent",
    ]);
  }
}
