import https from 'node:https'

type Json = Record<string, unknown>

type ToastConfig = {
  clientId: string
  clientSecret: string | null
  restaurantGuid: string
}

type DailySnapshot = {
  date?: string
  weekday?: string
  netSales?: number
  totalOrders?: number
  totalGuests?: number
  aov?: number
  cashSales?: number
  cardSales?: number
  cashPct?: number
  voidAmount?: number
  voidPct?: number
  discountAmount?: number
  dayparts?: {
    before10pm?: number
    tenTo12am?: number
    after12am?: number
  }
  flags?: string[]
}

function pickFirst(...values: Array<string | undefined | null>) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

export function getToastConfig(): ToastConfig {
  // Env vars only. Never hardcode credentials — every secret comes from Vercel
  // env config (TOAST_CLIENT_ID, TOAST_CLIENT_SECRET, TOAST_RESTAURANT_GUID).
  const clientId = pickFirst(process.env.TOAST_CLIENT_ID)
  const clientSecret = pickFirst(process.env.TOAST_CLIENT_SECRET)
  const restaurantGuid = pickFirst(process.env.TOAST_RESTAURANT_GUID)

  return {
    clientId: clientId ?? '',
    clientSecret,
    restaurantGuid: restaurantGuid ?? '',
  }
}

export function httpsReq<T = unknown>(opts: https.RequestOptions, body?: string): Promise<{ status: number | undefined; body: T }> {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (resp) => {
      let data = ''
      resp.on('data', (chunk) => { data += chunk })
      resp.on('end', () => {
        try {
          resolve({ status: resp.statusCode, body: JSON.parse(data) as T })
        } catch {
          resolve({ status: resp.statusCode, body: data as T })
        }
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

// Null when no secret is configured. Otherwise the token (null if Toast refused
// the login), the scopes Toast reports for it, and the HTTP status.
export async function toastLogin() {
  const config = getToastConfig()
  if (!config.clientSecret) return null

  const body = JSON.stringify({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    userAccessType: 'TOAST_MACHINE_CLIENT',
  })

  const res = await httpsReq<{ token?: { accessToken?: string; scope?: string | null } }>({
    hostname: 'ws-api.toasttab.com',
    path: '/authentication/v1/authentication/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body)

  return {
    accessToken: res.body?.token?.accessToken || null,
    scope: res.body?.token?.scope || null,
    status: res.status,
  }
}

async function toastAuth() {
  return (await toastLogin())?.accessToken || null
}

// The venue's UTC offset (Eastern time) on a calendar date: "-0400" in summer,
// "-0500" in winter. Taken at noon: the business day starts at 5am, always
// after the 2am daylight-saving switch.
function venueUtcOffset(date: string) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'longOffset' })
    .formatToParts(new Date(`${date}T12:00:00Z`))
    .find((part) => part.type === 'timeZoneName')?.value ?? ''
  const match = name.match(/GMT([+-])(\d{2}):(\d{2})/)
  return match ? `${match[1]}${match[2]}${match[3]}` : '-0500'
}

// Business day = 5am to 5am venue time, EDT or EST as the date requires.
export function businessDayWindow(date: string) {
  const start = `${date}T05:00:00.000${venueUtcOffset(date)}`
  const nextDate = new Date(`${date}T12:00:00Z`)
  nextDate.setUTCDate(nextDate.getUTCDate() + 1)
  const nextDateIso = nextDate.toISOString().slice(0, 10)
  const end = `${nextDateIso}T05:00:00.000${venueUtcOffset(nextDateIso)}`
  return { start, end }
}

async function getOrdersForDate(token: string, date: string) {
  const config = getToastConfig()
  const { start, end } = businessDayWindow(date)

  const all: Array<Record<string, unknown>> = []
  let page = 1

  while (true) {
    const res = await httpsReq<Array<Record<string, unknown>>>({
      hostname: 'ws-api.toasttab.com',
      path: `/orders/v2/ordersBulk?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}&pageSize=100&page=${page}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Toast-Restaurant-External-ID': config.restaurantGuid,
      },
    })

    if (res.status !== 200 || !Array.isArray(res.body) || res.body.length === 0) break
    all.push(...res.body)
    if (res.body.length < 100) break
    page += 1
  }

  return all
}

function numberOrZero(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function sumDiscounts(applied: unknown) {
  if (!Array.isArray(applied)) return 0
  return applied.reduce((sum: number, discount) => sum + numberOrZero((discount as Record<string, unknown> | null)?.discountAmount), 0)
}

// The venue runs on Eastern time; a business "night" spans 5am–5am. Toast
// timestamps are UTC/offset-aware, but the server runs UTC on Vercel, so a plain
// Date#getHours() buckets by UTC and misattributes late-night sales.
const VENUE_TZ = 'America/New_York'

/** Hour-of-day (0–23) for an ISO timestamp in the venue's timezone, or null. */
function venueHour(iso: string): number | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: VENUE_TZ, hour: 'numeric', hour12: false }).formatToParts(d)
  const h = parts.find((p) => p.type === 'hour')?.value
  if (h == null) return null
  const n = Number(h)
  if (!Number.isFinite(n)) return null
  return n === 24 ? 0 : n // some ICU builds render midnight as "24"
}

// Overtime is paid at 1.5× base wage. Toast carries the wage on each entry, so
// labor cost is computed straight from time entries — no employee/job lookup.
const OVERTIME_MULTIPLIER = 1.5

/** Pull all time entries for a single Toast business date (yyyy-mm-dd). */
async function getTimeEntriesForDate(token: string, date: string) {
  const config = getToastConfig()
  const businessDate = date.replaceAll('-', '') // Toast wants yyyymmdd
  const res = await httpsReq<Array<Record<string, unknown>>>({
    hostname: 'ws-api.toasttab.com',
    path: `/labor/v1/timeEntries?businessDate=${businessDate}`,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Toast-Restaurant-External-ID': config.restaurantGuid,
    },
  })
  if (res.status !== 200 || !Array.isArray(res.body)) return []
  return res.body
}

/** Roll time entries into labor cost + hours. Skips deleted entries. */
function summarizeLabor(entries: Array<Record<string, unknown>>) {
  let laborCost = 0
  let regularHours = 0
  let overtimeHours = 0

  for (const entry of entries) {
    if (entry.deleted) continue
    const wage = numberOrZero(entry.hourlyWage)
    const reg = numberOrZero(entry.regularHours)
    const ot = numberOrZero(entry.overtimeHours)
    regularHours += reg
    overtimeHours += ot
    laborCost += reg * wage + ot * wage * OVERTIME_MULTIPLIER
  }

  return {
    laborCost: Number(laborCost.toFixed(2)),
    laborHours: Number((regularHours + overtimeHours).toFixed(2)),
    regularHours: Number(regularHours.toFixed(2)),
    overtimeHours: Number(overtimeHours.toFixed(2)),
  }
}

export function summarizeOrders(orders: Array<Record<string, unknown>>) {
  let netSales = 0
  let totalOrders = 0
  let totalGuests = 0
  let voidAmount = 0
  let discountAmount = 0
  let cashSales = 0
  let cardSales = 0

  const itemMap = new Map<string, { name: string; qty: number; sales: number }>()
  const hourlyBuckets = { before10pm: 0, tenTo12am: 0, after12am: 0 }

  for (const order of orders) {
    if (order.deleted) continue
    const checks = Array.isArray(order.checks) ? order.checks as Array<Record<string, unknown>> : []
    for (const check of checks) {
      if (check.deleted) continue
      // A voided check counts toward voids, not sales.
      if (order.voided || check.voided) {
        voidAmount += numberOrZero(check.totalAmount)
        continue
      }
      totalOrders += 1
      netSales += numberOrZero(check.amount)
      totalGuests += Math.max(1, numberOrZero(check.numberOfGuests))
      discountAmount += sumDiscounts(check.appliedDiscounts)

      const payments = Array.isArray(check.payments) ? check.payments as Array<Record<string, unknown>> : []
      for (const payment of payments) {
        // A voided payment (declined card, cash refunded at the register) took no money.
        if (payment.paymentStatus === 'VOIDED' || payment.voidInfo) continue
        const amount = numberOrZero(payment.amount)
        const tender = (payment.tender && typeof payment.tender === 'object') ? payment.tender as Record<string, unknown> : null
        const type = String(payment.type || tender?.type || '').toUpperCase()
        if (type.includes('CASH')) cashSales += amount
        else cardSales += amount
      }

      const openedAt = String(check.openedDate || order.openedDate || '')
      if (openedAt) {
        const hour = venueHour(openedAt)
        const amount = numberOrZero(check.amount)
        if (hour != null) {
          if (hour >= 22) hourlyBuckets.tenTo12am += amount // 10pm–midnight
          else if (hour < 5) hourlyBuckets.after12am += amount // midnight–5am (same business night)
          else hourlyBuckets.before10pm += amount // 5am–10pm
        }
      }

      const selections = Array.isArray(check.selections) ? check.selections as Array<Record<string, unknown>> : []
      for (const selection of selections) {
        if (selection.voided) {
          voidAmount += numberOrZero(selection.price)
          continue
        }
        discountAmount += sumDiscounts(selection.appliedDiscounts)
        const name = String(selection.displayName || selection.name || 'Unknown item')
        const qty = numberOrZero(selection.quantity) || 1
        // price is already the line total, quantity included.
        const sales = numberOrZero(selection.price)
        const existing = itemMap.get(name) || { name, qty: 0, sales: 0 }
        existing.qty += qty
        existing.sales += sales
        itemMap.set(name, existing)
      }
    }
  }

  const topPours = [...itemMap.values()]
    .sort((a, b) => b.qty - a.qty || b.sales - a.sales)
    .slice(0, 5)
    .map((item) => ({ name: item.name, qty: item.qty, sales: Number(item.sales.toFixed(2)) }))

  const aov = totalOrders ? netSales / totalOrders : 0
  const cashPct = netSales ? (cashSales / netSales) * 100 : 0
  const voidPct = netSales ? (voidAmount / netSales) * 100 : 0

  return {
    netSales: Number(netSales.toFixed(2)),
    totalOrders,
    totalGuests,
    aov: Number(aov.toFixed(2)),
    cashSales: Number(cashSales.toFixed(2)),
    cardSales: Number(cardSales.toFixed(2)),
    cashPct: Number(cashPct.toFixed(1)),
    voidAmount: Number(voidAmount.toFixed(2)),
    voidPct: Number(voidPct.toFixed(1)),
    discountAmount: Number(discountAmount.toFixed(2)),
    dayparts: {
      before10pm: Number(hourlyBuckets.before10pm.toFixed(2)),
      tenTo12am: Number(hourlyBuckets.tenTo12am.toFixed(2)),
      after12am: Number(hourlyBuckets.after12am.toFixed(2)),
    },
    topPours,
  }
}

function readFallbackDailySnapshot(): DailySnapshot | null {
  // No filesystem fallback in production. Live Toast pull is the only path.
  return null
}

function readFallbackWeeklyLabor() {
  return { laborPct: null as number | null, laborCost: null as number | null }
}

function getPreviousBusinessDateISO() {
  const now = new Date()
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export type ToastRollup = ReturnType<typeof summarizeOrders> & {
  businessDate: string
  source: 'toast_live' | 'toast_fallback_file'
  laborPct: number | null
  laborCost: number | null
  laborHours: number | null
  flags: string[]
}

/** ISO date for "yesterday" (the digest's business date). */
export function previousBusinessDateISO() {
  return getPreviousBusinessDateISO()
}

/**
 * Live Toast roll-up for a single business date — the reusable core. The digest
 * asks for yesterday, deposit recon asks for the same close, and the weekly P&L
 * loops this over seven days. On any failure it returns a zero-filled fallback
 * so a lane can still run and report "data missing" rather than throw.
 */
export async function getToastRollupForDate(date: string): Promise<ToastRollup> {
  const fallbackLabor = readFallbackWeeklyLabor()
  try {
    const token = await toastAuth()
    if (!token) throw new Error('Toast auth not configured')
    const orders = await getOrdersForDate(token, date)
    if (!orders.length) throw new Error('No Toast orders returned')
    const sales = summarizeOrders(orders)

    // Labor is best-effort: sales already succeeded, so a labor failure leaves
    // the day live with labor null rather than dropping it to the fallback.
    let laborCost: number | null = fallbackLabor.laborCost
    let laborHours: number | null = null
    const flags: string[] = []
    try {
      const entries = await getTimeEntriesForDate(token, date)
      const labor = summarizeLabor(entries)
      laborCost = labor.laborCost
      laborHours = labor.laborHours
    } catch {
      flags.push('Labor pull failed')
    }
    const laborPct = laborCost != null && sales.netSales > 0
      ? Number(((laborCost / sales.netSales) * 100).toFixed(1))
      : null

    return {
      businessDate: date,
      source: 'toast_live',
      ...sales,
      laborPct,
      laborCost,
      laborHours,
      flags,
    }
  } catch {
    const fallbackDaily = readFallbackDailySnapshot()
    return {
      businessDate: fallbackDaily?.date || date,
      source: 'toast_fallback_file',
      netSales: fallbackDaily?.netSales ?? 0,
      totalOrders: fallbackDaily?.totalOrders ?? 0,
      totalGuests: fallbackDaily?.totalGuests ?? 0,
      aov: fallbackDaily?.aov ?? 0,
      cashSales: fallbackDaily?.cashSales ?? 0,
      cardSales: fallbackDaily?.cardSales ?? 0,
      cashPct: fallbackDaily?.cashPct ?? 0,
      voidAmount: fallbackDaily?.voidAmount ?? 0,
      voidPct: fallbackDaily?.voidPct ?? 0,
      discountAmount: fallbackDaily?.discountAmount ?? 0,
      dayparts: {
        before10pm: fallbackDaily?.dayparts?.before10pm ?? 0,
        tenTo12am: fallbackDaily?.dayparts?.tenTo12am ?? 0,
        after12am: fallbackDaily?.dayparts?.after12am ?? 0,
      },
      topPours: [],
      laborPct: fallbackLabor.laborPct,
      laborCost: fallbackLabor.laborCost,
      laborHours: null,
      flags: fallbackDaily?.flags || ['Using fallback daily Toast file'],
    }
  }
}

export async function getLastNightToastDigest(): Promise<ToastRollup> {
  return getToastRollupForDate(getPreviousBusinessDateISO())
}

/** Sum N consecutive days ending on `endDate` (inclusive) into a week roll-up. */
export async function getToastWeekRollup(endDate: string, days = 7) {
  const dates: string[] = []
  const end = new Date(`${endDate}T12:00:00Z`)
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end)
    d.setUTCDate(d.getUTCDate() - i)
    dates.push(d.toISOString().slice(0, 10))
  }

  const daily = await Promise.all(dates.map((d) => getToastRollupForDate(d)))
  const live = daily.filter((d) => d.source === 'toast_live')

  const netSales = Number(daily.reduce((s, d) => s + (d.netSales ?? 0), 0).toFixed(2))
  const totalGuests = daily.reduce((s, d) => s + (d.totalGuests ?? 0), 0)

  // Labor across the week — sum only the days that actually returned labor, so a
  // single missing day gives a partial cost rather than a null week.
  const laborDays = daily.filter((d) => d.laborCost != null)
  const laborCost = laborDays.length
    ? Number(laborDays.reduce((s, d) => s + (d.laborCost ?? 0), 0).toFixed(2))
    : null
  const laborHours = laborDays.length
    ? Number(laborDays.reduce((s, d) => s + (d.laborHours ?? 0), 0).toFixed(2))
    : null
  const laborPct = laborCost != null && netSales > 0
    ? Number(((laborCost / netSales) * 100).toFixed(1))
    : null

  // Top movers across the week by quantity.
  const itemMap = new Map<string, number>()
  for (const d of daily) {
    for (const p of d.topPours ?? []) itemMap.set(p.name, (itemMap.get(p.name) ?? 0) + p.qty)
  }
  const topMovers = [...itemMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, qty]) => ({ name, qty }))

  return {
    weekEnding: endDate,
    days: dates.length,
    daysWithData: live.length,
    source: live.length ? ('toast_live' as const) : ('toast_fallback_file' as const),
    netSales,
    totalGuests,
    avgDailyNet: Number((netSales / dates.length).toFixed(2)),
    laborCost,
    laborHours,
    laborPct,
    daysWithLabor: laborDays.length,
    topMovers,
    daily: daily.map((d) => ({ businessDate: d.businessDate, netSales: d.netSales, totalGuests: d.totalGuests, laborCost: d.laborCost })),
  }
}
