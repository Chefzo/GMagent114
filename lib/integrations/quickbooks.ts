// QuickBooks Online (QBO) integration — OAuth2 refresh + P&L Reports API.
//
// Auth: QBO tokens expire every 60 minutes. We exchange the long-lived
// refresh_token for a fresh access_token on each call (no caching to keep the
// surface stateless inside Vercel functions). The refresh_token itself is
// rotatable; if QBO returns a new one, we surface it for manual rotation.
//
// Reports API: GET /v3/company/{realmId}/reports/ProfitAndLoss
// Returns deeply nested JSON. We flatten by traversing Rows -> Row, matching
// account groups to category buckets (Revenue, COGS - Food, COGS - Bev, Labor,
// Operating Expense). This is intentionally permissive — if QBO categories
// aren't perfectly tagged in your chart of accounts, the digest writer still
// gets a reasonable aggregate.

const QBO_API_BASE = 'https://quickbooks.api.intuit.com/v3/company'
const QBO_API_BASE_SANDBOX = 'https://sandbox-quickbooks.api.intuit.com/v3/company'
const QBO_OAUTH = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer_token'

export interface WeeklyPnl {
  weekStart: string      // YYYY-MM-DD (inclusive)
  weekEnd: string        // YYYY-MM-DD (inclusive)
  revenue: number
  cogsFood: number | null
  cogsBev: number | null
  cogsTotal: number
  labor: number | null
  operatingExpense: number
  netIncome: number
  /** prime cost % = (cogs + labor) / revenue * 100 */
  primeCostPct: number | null
  /** food cost % of revenue, when food cogs is tagged */
  foodCostPct: number | null
  /** beverage cost % of revenue, when bev cogs is tagged */
  bevCostPct: number | null
  /** labor % of revenue, when labor is tagged in QBO */
  laborPct: number | null
  source: 'qbo_live' | 'qbo_stub'
  flags: string[]
  /** Comparison vs the prior 7 days, when available */
  prior?: Partial<WeeklyPnl>
}

interface QboConfig {
  clientId: string
  clientSecret: string
  refreshToken: string
  realmId: string
  environment: 'sandbox' | 'production'
}

function getQboConfig(): QboConfig | null {
  const clientId = process.env.QBO_CLIENT_ID
  const clientSecret = process.env.QBO_CLIENT_SECRET
  const refreshToken = process.env.QBO_REFRESH_TOKEN
  const realmId = process.env.QBO_REALM_ID
  const environment = (process.env.QBO_ENVIRONMENT ?? 'production').toLowerCase()
  if (!clientId || !clientSecret || !refreshToken || !realmId) return null
  return { clientId, clientSecret, refreshToken, realmId, environment: environment === 'sandbox' ? 'sandbox' : 'production' }
}

async function refreshAccessToken(cfg: QboConfig): Promise<{ accessToken: string; newRefreshToken?: string }> {
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')
  const res = await fetch(QBO_OAUTH, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: cfg.refreshToken }),
  })
  if (!res.ok) throw new Error(`QBO token refresh failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { access_token: string; refresh_token?: string }
  const out: { accessToken: string; newRefreshToken?: string } = { accessToken: data.access_token }
  if (data.refresh_token && data.refresh_token !== cfg.refreshToken) {
    out.newRefreshToken = data.refresh_token
    console.warn('[qbo] refresh_token rotated — update QBO_REFRESH_TOKEN in Vercel env')
  }
  return out
}

async function fetchPnLReport(cfg: QboConfig, accessToken: string, startDate: string, endDate: string): Promise<unknown> {
  const base = cfg.environment === 'sandbox' ? QBO_API_BASE_SANDBOX : QBO_API_BASE
  const url = `${base}/${cfg.realmId}/reports/ProfitAndLoss?start_date=${startDate}&end_date=${endDate}&minorversion=70`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`QBO P&L fetch failed: ${res.status} ${await res.text()}`)
  return res.json()
}

// ── Report parsing ────────────────────────────────────────────────────────

type QboRow = {
  group?: string
  type?: string
  Header?: { ColData?: Array<{ value?: string }> }
  ColData?: Array<{ value?: string }>
  Summary?: { ColData?: Array<{ value?: string }> }
  Rows?: { Row?: QboRow[] }
}

/** Recursively walk Row tree calling visitor on every leaf and summary row. */
function walkRows(rows: QboRow[] | undefined, visit: (label: string, amount: number, group: string | undefined) => void, group?: string): void {
  if (!rows) return
  for (const r of rows) {
    const g = r.group ?? group
    if (r.Summary?.ColData) {
      const label = r.Summary.ColData[0]?.value ?? ''
      const amt = parseAmt(r.Summary.ColData[r.Summary.ColData.length - 1]?.value)
      visit(label, amt, g)
    } else if (r.ColData) {
      const label = r.ColData[0]?.value ?? ''
      const amt = parseAmt(r.ColData[r.ColData.length - 1]?.value)
      if (label) visit(label, amt, g)
    }
    if (r.Rows?.Row?.length) walkRows(r.Rows.Row, visit, g)
  }
}

function parseAmt(v?: string): number {
  if (!v) return 0
  const n = Number(v.replace(/[,$]/g, ''))
  return Number.isFinite(n) ? n : 0
}

interface ParsedReport {
  revenue: number
  cogsFood: number | null
  cogsBev: number | null
  cogsTotal: number
  labor: number | null
  operatingExpense: number
  netIncome: number
}

function parseReport(reportJson: unknown): ParsedReport {
  const out: ParsedReport = {
    revenue: 0,
    cogsFood: null,
    cogsBev: null,
    cogsTotal: 0,
    labor: null,
    operatingExpense: 0,
    netIncome: 0,
  }
  // QBO P&L report shape: { Rows: { Row: [...] } } at top level
  const top = (reportJson as { Rows?: { Row?: QboRow[] } })?.Rows?.Row
  if (!top) return out

  // Group-level walking: QBO tags top-level groups as "Income", "COGS",
  // "Expenses", "OtherIncome", "OtherExpenses", "NetIncome" via the `group`
  // field on each section header.
  for (const section of top) {
    const g = section.group
    const sectionTotal = parseAmt(section.Summary?.ColData?.[section.Summary?.ColData.length - 1]?.value)
    if (g === 'Income') out.revenue += sectionTotal
    if (g === 'COGS') out.cogsTotal += sectionTotal
    if (g === 'Expenses') out.operatingExpense += sectionTotal
    if (g === 'NetIncome') out.netIncome += sectionTotal
  }

  // Second pass: walk all rows to extract specific buckets by account name.
  walkRows(top, (label, amt, group) => {
    const lower = label.toLowerCase()
    if (group === 'COGS') {
      if (/\bfood|kitchen|gfs\b/.test(lower)) {
        out.cogsFood = (out.cogsFood ?? 0) + amt
      } else if (/\bbev|liquor|wine|beer|spirit|alcohol\b/.test(lower)) {
        out.cogsBev = (out.cogsBev ?? 0) + amt
      }
    }
    if (group === 'Expenses' && /\b(labor|payroll|wages|salar|tip)\b/.test(lower)) {
      out.labor = (out.labor ?? 0) + amt
    }
  })

  return out
}

// ── Public API ────────────────────────────────────────────────────────────

export async function getWeeklyPnl(weekEndIso?: string): Promise<WeeklyPnl> {
  const cfg = getQboConfig()
  const today = weekEndIso ? new Date(weekEndIso) : new Date()
  const end = today.toISOString().slice(0, 10)
  const startD = new Date(today.getTime() - 6 * 86400_000)
  const start = startD.toISOString().slice(0, 10)
  const flags: string[] = []

  if (!cfg) {
    return {
      weekStart: start,
      weekEnd: end,
      revenue: 0,
      cogsFood: null,
      cogsBev: null,
      cogsTotal: 0,
      labor: null,
      operatingExpense: 0,
      netIncome: 0,
      primeCostPct: null,
      foodCostPct: null,
      bevCostPct: null,
      laborPct: null,
      source: 'qbo_stub',
      flags: ['Missing QBO env vars (QBO_CLIENT_ID / QBO_CLIENT_SECRET / QBO_REFRESH_TOKEN / QBO_REALM_ID)'],
    }
  }

  try {
    const { accessToken, newRefreshToken } = await refreshAccessToken(cfg)
    if (newRefreshToken) flags.push('QBO refresh_token rotated — update env')

    const [thisWeekRaw, priorWeekRaw] = await Promise.all([
      fetchPnLReport(cfg, accessToken, start, end),
      fetchPnLReport(cfg, accessToken,
        new Date(startD.getTime() - 7 * 86400_000).toISOString().slice(0, 10),
        new Date(today.getTime() - 7 * 86400_000).toISOString().slice(0, 10),
      ),
    ])
    const thisWeek = parseReport(thisWeekRaw)
    const priorWeek = parseReport(priorWeekRaw)

    const primeCost = thisWeek.cogsTotal + (thisWeek.labor ?? 0)
    const primeCostPct = thisWeek.revenue > 0 ? round2(primeCost / thisWeek.revenue * 100) : null

    const priorPrimeCost = priorWeek.cogsTotal + (priorWeek.labor ?? 0)
    const priorPrimePct = priorWeek.revenue > 0 ? round2(priorPrimeCost / priorWeek.revenue * 100) : null

    return {
      weekStart: start,
      weekEnd: end,
      revenue: round2(thisWeek.revenue),
      cogsFood: thisWeek.cogsFood !== null ? round2(thisWeek.cogsFood) : null,
      cogsBev: thisWeek.cogsBev !== null ? round2(thisWeek.cogsBev) : null,
      cogsTotal: round2(thisWeek.cogsTotal),
      labor: thisWeek.labor !== null ? round2(thisWeek.labor) : null,
      operatingExpense: round2(thisWeek.operatingExpense),
      netIncome: round2(thisWeek.netIncome),
      primeCostPct,
      foodCostPct: thisWeek.cogsFood !== null && thisWeek.revenue > 0 ? round2(thisWeek.cogsFood / thisWeek.revenue * 100) : null,
      bevCostPct: thisWeek.cogsBev !== null && thisWeek.revenue > 0 ? round2(thisWeek.cogsBev / thisWeek.revenue * 100) : null,
      laborPct: thisWeek.labor !== null && thisWeek.revenue > 0 ? round2(thisWeek.labor / thisWeek.revenue * 100) : null,
      source: 'qbo_live',
      flags,
      prior: {
        revenue: round2(priorWeek.revenue),
        cogsTotal: round2(priorWeek.cogsTotal),
        labor: priorWeek.labor !== null ? round2(priorWeek.labor) : null,
        netIncome: round2(priorWeek.netIncome),
        primeCostPct: priorPrimePct,
      },
    }
  } catch (err) {
    console.error('[qbo] failed:', err)
    flags.push(`QBO fetch failed: ${(err as Error).message}`)
    return {
      weekStart: start,
      weekEnd: end,
      revenue: 0,
      cogsFood: null,
      cogsBev: null,
      cogsTotal: 0,
      labor: null,
      operatingExpense: 0,
      netIncome: 0,
      primeCostPct: null,
      foodCostPct: null,
      bevCostPct: null,
      laborPct: null,
      source: 'qbo_stub',
      flags,
    }
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
