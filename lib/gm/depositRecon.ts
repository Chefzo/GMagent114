import { ESCALATION_THRESHOLDS } from '@/lib/policies/escalation'

export async function runDepositRecon() {
  return {
    job: 'deposit-recon',
    status: 'stub',
    summary: `Deposit recon scaffold ready. Variance alert threshold locked at $${ESCALATION_THRESHOLDS.depositVariance}.`,
  }
}
