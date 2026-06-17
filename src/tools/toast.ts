// Live Toast POS sales source. Pulls orders since a timestamp and aggregates
// menu-item sales into per-item depletion. A menu item maps to a ParLevel item
// via an optional name match (override in the MenuMap tab if names differ).
//
// NOTE: Toast's Orders API returns rich check/selection data; here we aggregate
// quantities by menu item display name. Converting "drinks sold" -> "bottles
// used" precisely needs recipe/pour data; v1 uses a 1:1 unit assumption and is
// designed to be refined once recipes live in the VendorCatalog/MenuMap tabs.

import { toastAuth } from "../lib/auth.ts";
import { log } from "../lib/logger.ts";
import type { Depletion } from "../lib/types.ts";
import type { SalesSource } from "./clients.ts";

interface ToastSelection {
  displayName?: string;
  quantity?: number;
}
interface ToastCheck {
  selections?: ToastSelection[];
  totalAmount?: number;
}
interface ToastOrder {
  checks?: ToastCheck[];
}

/** Walk the paged ordersBulk API for [startIso, endIso], calling `onOrder` per order. */
async function eachOrder(startIso: string, endIso: string, onOrder: (o: ToastOrder) => void): Promise<void> {
  const { token, restaurantGuid, baseUrl } = await toastAuth();
  const start = encodeURIComponent(startIso);
  const end = encodeURIComponent(endIso);
  for (let page = 1; ; page++) {
    const url =
      `${baseUrl}/orders/v2/ordersBulk` +
      `?startDate=${start}&endDate=${end}&pageSize=100&page=${page}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Toast-Restaurant-External-ID": restaurantGuid,
      },
    });
    if (!res.ok) throw new Error(`Toast orders failed: ${res.status} ${await res.text()}`);
    const orders = (await res.json()) as ToastOrder[];
    if (orders.length === 0) break;
    for (const o of orders) onOrder(o);
    if (orders.length < 100) break;
  }
}

export class ToastSalesSource implements SalesSource {
  async getDepletionSince(sinceIso: string): Promise<Depletion[]> {
    const counts = new Map<string, number>();
    await eachOrder(sinceIso, new Date().toISOString(), (o) => {
      for (const c of o.checks ?? []) {
        for (const s of c.selections ?? []) {
          if (!s.displayName) continue;
          counts.set(s.displayName, (counts.get(s.displayName) ?? 0) + (s.quantity ?? 1));
        }
      }
    });
    const depletion = [...counts].map(([item, unitsUsed]) => ({ item, unitsUsed }));
    log.info(`Toast: aggregated depletion for ${depletion.length} item(s) since ${sinceIso}`);
    return depletion;
  }

  async getRevenueSince(fromIso: string, toIso: string): Promise<number> {
    let total = 0;
    await eachOrder(fromIso, toIso, (o) => {
      for (const c of o.checks ?? []) total += c.totalAmount ?? 0;
    });
    log.info(`Toast: $${total.toFixed(2)} revenue ${fromIso}..${toIso}`);
    return total;
  }
}
