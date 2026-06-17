// Client interfaces used by the modules. Coding to interfaces lets the ordering
// job run identically against live APIs or against fixtures (--dry-run), which
// is how we verify the reorder math without spending money or hitting Toast.

import type {
  BarConfig,
  CatalogEntry,
  CountEntry,
  Depletion,
  InventoryItem,
  OrderRecord,
  ParLevel,
  SchedulingConfig,
  Shift,
} from "../lib/types.ts";

export interface DataBackbone {
  getConfig(): Promise<BarConfig>;
  getParLevels(): Promise<ParLevel[]>;
  getInventory(): Promise<InventoryItem[]>;
  getCatalog(): Promise<CatalogEntry[]>;
  getSchedulingConfig(): Promise<SchedulingConfig>;
  /** Orders sent on/after `sinceIso` (newest filtering done by the backbone). */
  getOrderHistory(sinceIso: string): Promise<OrderRecord[]>;
  /** Apply depletion to on-hand counts and persist. */
  applyDepletion(depletion: Depletion[]): Promise<void>;
  /** Overwrite on-hand for physically counted items (upsert), stamping lastCounted=today. */
  applyCounts(counts: CountEntry[]): Promise<void>;
  /** Append a sent order to OrderHistory. */
  recordOrder(vendorKey: string, lines: { item: string; packs: number }[], estTotal: number): Promise<void>;
}

export interface SalesSource {
  /** Units consumed since `sinceIso`, already converted to ParLevel units. */
  getDepletionSince(sinceIso: string): Promise<Depletion[]>;
  /** Net sales (revenue $) over [fromIso, toIso]. */
  getRevenueSince(fromIso: string, toIso: string): Promise<number>;
}

export interface ScheduleSource {
  /** Published shifts overlapping [fromIso, toIso], normalized to `Shift`. */
  getShifts(fromIso: string, toIso: string): Promise<Shift[]>;
}

export interface Mailer {
  /** Send an email. In dry-run this only logs. */
  send(to: string, subject: string, body: string, attachments?: Attachment[]): Promise<void>;
}

export interface Attachment {
  filename: string;
  mimeType: string;
  content: string; // utf8 or base64
}

/** Everything a module needs, assembled once per run. */
export interface Toolbox {
  data: DataBackbone;
  sales: SalesSource;
  schedule: ScheduleSource;
  mailer: Mailer;
  dryRun: boolean;
}
