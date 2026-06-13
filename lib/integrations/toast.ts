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

function getToastConfig(): ToastConfig {
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

function httpsReq<T = unknown>(opts: https.RequestOptions, body?: string): Promise<{ status: number | undefined; body: T }> {
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

async function toastAuth() {
  const config = getToastConfig()
  if (!config.clientSecret) return null

  const body = JSON.stringify({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    userAccessType: 'TOAST_MACHINE_CLIENT',
  })

  const res = await httpsReq<{ token?: { accessToken?: string } }>({
    hostname: 'ws-api.toasttab.com',
    path: '/authentication/v1/authentication/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body)

  return res.body?.token?.accessToken || null
}

async function getOrdersForDate(token: string, date: string) {
  const config = getToastConfig()
  const start = `${date}T05:00:00.000-0400`
  const nextDate = new Date(`${date}T12:00:00Z`)
  nextDate.setUTCDate(nextDate.getUTCDate() + 1)
  const nextDateIso = nextDate.toISOString().slice(0, 10)
  const end = `${nextDateIso}T05:00:00.000-0400`

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

function summarizeOrders(orders: Array<Record<string, unknown>>) {
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
    if (order.voided || order.deleted) continue
    const checks = Array.isArray(order.checks) ? order.checks as Array<Record<string, unknown>> : []
    for (const check of checks) {
      if (check.voided || check.deleted) continue
      totalOrders += 1
      netSales += numberOrZero(check.amount)
      totalGuests += Math.max(1, numberOrZero(check.customerCount))
      voidAmount += numberOrZero(check.voidAmount)
      discountAmount += numberOrZero(check.appliedDiscountsAmount)

      const payments = Array.isArray(check.payments) ? check.payments as Array<Record<string, unknown>> : []
      for (const payment of payments) {
        const amount = numberOrZero(payment.amount)
        const tender = (payment.tender && typeof payment.tender === 'object') ? payment.tender as Record<string, unknown> : null
        const type = String(payment.type || tender?.type || '').toUpperCase()
        if (type.includes('CASH')) cashSales += amount
        else cardSales += amount
      }

      const openedAt = String(check.openedDate || order.openedDate || '')
      if (openedAt) {
        const hour = new Date(openedAt).getHours()
        const amount = numberOrZero(check.amount)
        if (hour < 22) hourlyBuckets.before10pm += amount
        else if (hour < 24) hourlyBuckets.tenTo12am += amount
        else hourlyBuckets.after12am += amount
      }

      const selections = Array.isArray(check.selections) ? check.selections as Array<Record<string, unknown>> : []
      for (const selection of selections) {
        if (selection.voided) continue
        const name = String(selection.displayName || selection.name || 'Unknown item')
        const qty = numberOrZero(selection.quantity) || 1
        const sales = (numberOrZero(selection.price) * qty)
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

export async function getLastNightToastDigest() {
  const date = getPreviousBusinessDateISO()
  const fallbackDaily = readFallbackDailySnapshot()
  const fallbackLabor = readFallbackWeeklyLabor()

  try {
    const token = await toastAuth()
    if (!token) throw new Error('Toast auth not configured')
    const orders = await getOrdersForDate(token, date)
    if (!orders.length) throw new Error('No Toast orders returned')
    const summary = summarizeOrders(orders)
    return {
      businessDate: date,
      source: 'toast_live',
      ...summary,
      laborPct: fallbackLabor.laborPct,
      laborCost: fallbackLabor.laborCost,
      flags: [],
    }
  } catch {
    return {
      businessDate: fallbackDaily?.date || date,
      source: 'toast_fallback_file',
      netSales: fallbackDaily?.netSales ?? null,
      totalOrders: fallbackDaily?.totalOrders ?? null,
      totalGuests: fallbackDaily?.totalGuests ?? null,
      aov: fallbackDaily?.aov ?? null,
      cashSales: fallbackDaily?.cashSales ?? null,
      cardSales: fallbackDaily?.cardSales ?? null,
      cashPct: fallbackDaily?.cashPct ?? null,
      voidAmount: fallbackDaily?.voidAmount ?? null,
      voidPct: fallbackDaily?.voidPct ?? null,
      discountAmount: fallbackDaily?.discountAmount ?? null,
      dayparts: fallbackDaily?.dayparts || null,
      topPours: [],
      laborPct: fallbackLabor.laborPct,
      laborCost: fallbackLabor.laborCost,
      flags: fallbackDaily?.flags || ['Using fallback daily Toast file'],
    }
  }
}
