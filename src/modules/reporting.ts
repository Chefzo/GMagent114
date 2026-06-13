// Module: weekly reporting (built after v1 ordering).
//
// Planned flow: each week, pull Toast sales + labor and OrderHistory, compute
// the metrics a GM would present (sales vs last week, labor %, pour cost, top /
// slow movers, what was ordered), and email the owner a short digest. The
// metric math is pure and already testable.

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

export function formatWeeklyDigest(barName: string, m: WeeklyMetrics): string {
  const delta = m.priorSales > 0 ? ((m.sales - m.priorSales) / m.priorSales) * 100 : 0;
  return [
    `${barName} — weekly update`,
    `Sales: $${m.sales.toFixed(0)} (${delta >= 0 ? "+" : ""}${delta.toFixed(1)}% vs last week)`,
    `Labor: $${m.laborCost.toFixed(0)} (${m.laborPct.toFixed(1)}% of sales)`,
    `Pour cost: ${m.pourCostPct.toFixed(1)}% of sales`,
  ].join("\n");
}
