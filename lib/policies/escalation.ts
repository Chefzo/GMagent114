export const ESCALATION_THRESHOLDS = {
  depositVariance: 50,
  financialImmediate: 100,
  reviewLowStars: 3,
  maintenanceHoursOpen: 48,
  /** Weekly prime cost % above this triggers a same-evening escalation. */
  primeCostAlertPct: 65,
} as const

export function shouldEscalateFinancial(amount: number) {
  return amount > ESCALATION_THRESHOLDS.financialImmediate
}
