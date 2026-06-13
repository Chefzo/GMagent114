export const ESCALATION_THRESHOLDS = {
  depositVariance: 50,
  financialImmediate: 100,
  reviewLowStars: 3,
  maintenanceHoursOpen: 48,
} as const

export function shouldEscalateFinancial(amount: number) {
  return amount > ESCALATION_THRESHOLDS.financialImmediate
}
