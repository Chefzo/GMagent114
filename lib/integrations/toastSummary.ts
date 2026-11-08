import { businessDayWindow, getToastConfig, httpsReq, toastLogin } from '@/lib/integrations/toast'

// Read-only summary of one business day: sales, labor, voids and comps, plus
// where every number came from. Besides the login, the only request this
// module sends to Toast is a GET. Field handling follows boombozz-toast's
// reports (sales.py, voids.py, labor.py), which run against live Toast data.

type Row = Record<string, unknown>

const TOAST_HOST = 'ws-api.toasttab.com'
const VENUE_TIME_ZONE = 'America/New_York'

function num(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function money(value: number) {
  return Number(value.toFixed(2))
}

function rows(value: unknown) {
  return Array.isArray(value) ? value as Row[] : []
}

function ref(value: unknown) {
  return value && typeof value === 'object' ? value as Row : null
}

// The last business day that has closed. The venue clock minus 5 hours gives
// the business day in progress; the one before it is the last full one.
export function lastClosedBusinessDate(now = new Date()) {
  const inProgress = new Intl.DateTimeFormat('en-CA', { timeZone: VENUE_TIME_ZONE })
    .format(new Date(now.getTime() - 5 * 60 * 60 * 1000))
  const d = new Date(`${inProgress}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

async function toastGet(token: string, path: string) {
  return httpsReq<unknown>({
    hostname: TOAST_HOST,
    path,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Toast-Restaurant-External-ID': getToastConfig().restaurantGuid,
    },
  })
}

async function getAllOrders(token: string, start: string, end: string) {
  const orders: Row[] = []
  let page = 1
  while (true) {
    const res = await toastGet(token, `/orders/v2/ordersBulk?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}&pageSize=100&page=${page}`)
    if (res.status !== 200 || !Array.isArray(res.body)) {
      throw new Error(`Toast orders request failed (HTTP ${res.status ?? 'no response'}, page ${page})`)
    }
    orders.push(...res.body as Row[])
    if (res.body.length < 100) return { orders, pages: page }
    page += 1
  }
}

export function summarizeSales(orders: Row[]) {
  let net = 0, gross = 0, tax = 0, tips = 0, checks = 0, covers = 0
  let voidedChecks = 0, voidedCheckTotal = 0, voidedItemTotal = 0
  const voidedItems: Array<{ item: string; amount: number; reason: string | null }> = []
  const discountsByName = new Map<string, { name: string; count: number; total: number }>()

  const addDiscounts = (applied: unknown) => {
    for (const discount of rows(applied)) {
      const name = String(discount.name || 'Unnamed discount')
      const entry = discountsByName.get(name) || { name, count: 0, total: 0 }
      entry.count += 1
      entry.total += num(discount.discountAmount)
      discountsByName.set(name, entry)
    }
  }

  for (const order of orders) {
    if (order.deleted) continue
    for (const check of rows(order.checks)) {
      if (check.deleted) continue
      if (order.voided || check.voided) {
        voidedChecks += 1
        voidedCheckTotal += num(check.totalAmount)
        continue
      }
      checks += 1
      net += num(check.amount)
      gross += num(check.totalAmount)
      tax += num(check.taxAmount)
      covers += num(check.numberOfGuests)
      for (const payment of rows(check.payments)) {
        if (payment.paymentStatus === 'VOIDED' || payment.voidInfo) continue
        tips += num(payment.tipAmount)
      }
      addDiscounts(check.appliedDiscounts)
      for (const selection of rows(check.selections)) {
        if (selection.voided) {
          const amount = num(selection.price)
          voidedItemTotal += amount
          voidedItems.push({
            item: String(selection.displayName || selection.itemName || 'Unknown item'),
            amount: money(amount),
            reason: (ref(selection.voidReason)?.name as string | undefined) ?? null,
          })
          continue
        }
        addDiscounts(selection.appliedDiscounts)
      }
    }
  }

  // Toast has no separate comp type here: comps are discounts named as comps.
  const discounts = [...discountsByName.values()]
    .map((d) => ({ ...d, total: money(d.total), isComp: /comp/i.test(d.name) }))
    .sort((a, b) => b.total - a.total)
  const comps = discounts.filter((d) => d.isComp)

  return {
    sales: {
      netSales: money(net),
      grossSales: money(gross),
      tax: money(tax),
      tips: money(tips),
      checks,
      covers,
      avgCheck: checks ? money(net / checks) : 0,
    },
    voids: {
      voidedChecks,
      voidedCheckTotal: money(voidedCheckTotal),
      voidedItems: voidedItems.length,
      voidedItemTotal: money(voidedItemTotal),
      total: money(voidedCheckTotal + voidedItemTotal),
      largest: voidedItems.sort((a, b) => b.amount - a.amount).slice(0, 10),
    },
    discounts: {
      count: discounts.reduce((sum, d) => sum + d.count, 0),
      total: money(discounts.reduce((sum, d) => sum + d.total, 0)),
      byName: discounts,
    },
    comps: {
      count: comps.reduce((sum, d) => sum + d.count, 0),
      total: money(comps.reduce((sum, d) => sum + d.total, 0)),
    },
  }
}

export function summarizeLabor(entries: Row[], netSales: number) {
  let hours = 0, cost = 0, openEntries = 0, missingWage = 0
  const employees = new Set<string>()

  for (const entry of entries) {
    if (entry.deleted) continue
    if (!entry.inDate || !entry.outDate) {
      openEntries += 1
      continue
    }
    const wage = num(entry.hourlyWage)
    const regular = num(entry.regularHours)
    const overtime = num(entry.overtimeHours)
    if (!wage) missingWage += 1
    hours += regular + overtime
    cost += regular * wage + overtime * wage * 1.5
    const employee = ref(entry.employeeReference)?.guid
    if (typeof employee === 'string') employees.add(employee)
  }

  return {
    available: true as const,
    hours: Number(hours.toFixed(2)),
    cost: money(cost),
    laborPct: netSales ? Number(((cost / netSales) * 100).toFixed(1)) : null,
    employees: employees.size,
    openEntries,
    entriesMissingWage: missingWage,
  }
}

export async function getToastSummary(businessDate = lastClosedBusinessDate()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    throw new Error(`Business date must look like 2026-11-05, got "${businessDate}"`)
  }
  const config = getToastConfig()
  if (!config.clientId || !config.clientSecret || !config.restaurantGuid) {
    throw new Error('Toast credentials are not set (TOAST_CLIENT_ID, TOAST_CLIENT_SECRET, TOAST_RESTAURANT_GUID)')
  }
  const login = await toastLogin()
  if (!login?.accessToken) {
    throw new Error(`Toast login failed (HTTP ${login?.status ?? 'no response'})`)
  }

  const { start, end } = businessDayWindow(businessDate)
  const warnings: string[] = []
  const { orders, pages } = await getAllOrders(login.accessToken, start, end)
  const { sales, voids, discounts, comps } = summarizeSales(orders)
  if (!orders.length) warnings.push('Toast returned no orders for this business day (closed, or wrong restaurant GUID).')

  const laborRes = await toastGet(login.accessToken, `/labor/v1/timeEntries?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`)
  const timeEntries = laborRes.status === 200 && Array.isArray(laborRes.body) ? laborRes.body as Row[] : null
  const labor = timeEntries
    ? summarizeLabor(timeEntries, sales.netSales)
    : { available: false as const, reason: `Toast time entries request failed (HTTP ${laborRes.status ?? 'no response'}); the credential may lack labor:read` }
  if (labor.available && labor.openEntries) warnings.push(`${labor.openEntries} time entries have no clock-out, so their hours are left out.`)
  if (labor.available && labor.entriesMissingWage) warnings.push(`${labor.entriesMissingWage} time entries have no hourly wage, so labor cost is understated.`)

  const scopes = login.scope ? login.scope.split(/\s+/) : null
  if (scopes?.some((scope) => scope.endsWith(':write'))) {
    warnings.push('This Toast credential has write scopes. This tool only reads, but the credential should be read-only.')
  }

  return {
    businessDate,
    sales,
    labor,
    voids,
    comps,
    discounts,
    warnings,
    provenance: {
      source: 'toast_live',
      fetchedAt: new Date().toISOString(),
      window: { start, end, timeZone: VENUE_TIME_ZONE, rule: '5am to 5am venue time' },
      requests: [
        `GET /orders/v2/ordersBulk (${pages} page${pages === 1 ? '' : 's'}, ${orders.length} orders)`,
        `GET /labor/v1/timeEntries (${timeEntries ? `${timeEntries.length} entries` : `HTTP ${laborRes.status ?? 'no response'}`})`,
      ],
      tokenScopes: scopes ?? 'not reported by Toast',
      readOnly: true,
    },
  }
}
