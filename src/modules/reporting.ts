// Module: weekly reporting. Each week, pull Toast sales + labor and OrderHistory,
// compute the metrics a GM would present (sales vs last week, labor %, pour cost,
// top/slow movers, what was ordered), and email the owner a short digest. All the
// metric math is pure; runWeeklyReport wires it to the live/mock toolbox.

import { log } from "../lib/logger.ts";
import type { Depletion, OrderRecord } from "../lib/types.ts";
import type { Toolbox } from "../tools/clients.ts";
import { computeLaborProjection } from "./scheduling.ts";

export interface WeeklyMetrics {
  sales: number;
  priorSales: number;
  laborCost: number;
  /** Labor as a % of sales. */
  laborPct: number;
  /** Cost of goods ordered / sales. */
  pourCostPct: number;
}

export function computeWeeklyMetrics(input: {
  sales: number;
  priorSales: number;
  laborCost: number;
  costOfGoods: number;
}): WeeklyMetrics {
  const { sales, priorSales, laborCost, costOfGoods } = input;
  return {
    sales,
    priorSales,
    laborCost,
    laborPct: sales > 0 ? (laborCost / sales) * 100 : 0,
    pourCostPct: sales > 0 ? (costOfGoods / sales) * 100 : 0,
  };
}

export interface Mover {
  item: string;
  unitsUsed: number;
}

/** Pure: depletion ranked most-used first. */
export function rankMovers(depletion: Depletion[]): Mover[] {
  return depletion
    .map((d) => ({ item: d.item, unitsUsed: d.unitsUsed }))
    .sort((a, b) => b.unitsUsed - a.unitsUsed);
}

export function formatWeeklyDigest(barName: string, m: WeeklyMetrics): string {
  const delta = m.priorSales > 0 ? ((m.sales - m.priorSales) / m.priorSales) * 100 : 0;
  return [
    `${barName} — weekly update`,
    `Sales: $${m.sales.toFixed(0)} (${delta >= 0 ? "+" : ""}${delta.toFixed(1)}% vs last week)`,
    `Labor: $${m.laborCost.toFixed(0)} (${m.laborPct.toFixed(1)}% of sales)`,
    `Pour cost: ${m.pourCostPct.toFixed(1)}% of sales`,
  ].join("\n");
}

/** Pure: the full weekly digest email (core metrics + movers + what was ordered). */
export function buildWeeklyReportEmail(
  barName: string,
  m: WeeklyMetrics,
  movers: Mover[],
  orders: OrderRecord[],
  topN = 3,
): { subject: string; body: string } {
  const delta = m.priorSales > 0 ? ((m.sales - m.priorSales) / m.priorSales) * 100 : 0;
  const top = movers.slice(0, topN);
  const slow = movers.filter((x) => x.unitsUsed === 0);

  const orderTotal = orders.reduce((s, o) => s + o.estTotal, 0);
  const orderLines =
    orders.length > 0
      ? orders.map((o) => `  • ${o.vendor}: ${o.items} ($${o.estTotal.toFixed(2)})`)
      : ["  • (none)"];

  const subject = `[${barName}] Weekly update — $${m.sales.toFixed(0)} sales (${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%)`;
  const body = [
    formatWeeklyDigest(barName, m),
    "",
    `Top sellers: ${top.map((t) => `${t.item} (${t.unitsUsed})`).join(", ") || "n/a"}`,
    slow.length > 0 ? `Didn't move: ${slow.map((s) => s.item).join(", ")}` : "Everything moved.",
    "",
    `Ordered this week (${orders.length}, est $${orderTotal.toFixed(2)}):`,
    ...orderLines,
  ].join("\n");
  return { subject, body };
}

export interface WeeklyReport {
  metrics: WeeklyMetrics;
  movers: Mover[];
  orders: OrderRecord[];
  email: { subject: string; body: string };
}

/**
 * Orchestrate the weekly report for the 7 days ending `now`:
 *  1) Toast revenue this week vs the prior week
 *  2) labor cost from the week's shifts × wages
 *  3) cost of goods from OrderHistory; depletion for top/slow movers
 *  4) email the owner the digest
 */
export async function runWeeklyReport(tb: Toolbox, now: Date = new Date()): Promise<WeeklyReport> {
  const thisWeekStart = new Date(now.getTime() - 7 * 86_400_000);
  const priorWeekStart = new Date(now.getTime() - 14 * 86_400_000);
  const sinceIso = thisWeekStart.toISOString();

  const config = await tb.data.getConfig();
  const [sales, priorSales, shifts, sched, orders, depletion] = await Promise.all([
    tb.sales.getRevenueSince(sinceIso, now.toISOString()),
    tb.sales.getRevenueSince(priorWeekStart.toISOString(), sinceIso),
    tb.schedule.getShifts(sinceIso, now.toISOString()),
    tb.data.getSchedulingConfig(),
    tb.data.getOrderHistory(sinceIso),
    tb.sales.getDepletionSince(sinceIso),
  ]);

  const laborCost = computeLaborProjection(shifts, sched).totalCost;
  const costOfGoods = orders.reduce((s, o) => s + o.estTotal, 0);
  const metrics = computeWeeklyMetrics({ sales, priorSales, laborCost, costOfGoods });
  const movers = rankMovers(depletion);

  log.info(
    `Weekly report: sales $${sales.toFixed(0)} (prior $${priorSales.toFixed(0)}), ` +
      `labor ${metrics.laborPct.toFixed(1)}%, pour ${metrics.pourCostPct.toFixed(1)}%.`,
  );

  const email = buildWeeklyReportEmail(config.barName, metrics, movers, orders);
  await tb.mailer.send(config.ownerEmail, email.subject, email.body);
  return { metrics, movers, orders, email };
}
