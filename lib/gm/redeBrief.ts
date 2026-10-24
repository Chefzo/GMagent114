// Renders the nightly RUNDOWN as an inline-styled HTML brief for RedE App.
// Rede messages accept content_type "text/html" (BoomBot uses the same), and app/
// email renderers need INLINE styles — no <style> blocks or external CSS.
//
// Palette: One Fourteen is a whiskey bar — warm amber on charcoal, not Boombozz red.

import type { DigestMetrics } from '@/lib/gm/digestWriter'

const INK = '#1b1a17'
const PAPER = '#ffffff'
const AMBER = '#c8963e'
const MUTED = '#6b675e'
const LINE = '#e7e3d9'

const money = (n?: number | null) =>
  n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const money2 = (n?: number | null) =>
  n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const int = (n?: number | null) => (n == null ? '—' : Math.round(Number(n)).toLocaleString('en-US'))
const pct = (n?: number | null) => (n == null ? '—' : Number(n).toFixed(1) + '%')

function metricCard(label: string, value: string, flag?: 'warn' | 'good'): string {
  const valColor = flag === 'warn' ? '#b3402f' : flag === 'good' ? '#2e7d5b' : INK
  return `<td style="padding:0 6px 12px 0;vertical-align:top;width:50%">
    <div style="border:1px solid ${LINE};border-radius:10px;padding:12px 14px">
      <div style="font:600 11px/1.2 -apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:${MUTED}">${label}</div>
      <div style="font:700 22px/1.2 -apple-system,Segoe UI,Roboto,sans-serif;color:${valColor};margin-top:4px">${value}</div>
    </div></td>`
}

/** Build the HTML body for a nightly RUNDOWN. */
export function renderRundownHtml(m: DigestMetrics, paragraph: string): string {
  const voidsFlag = (m.voidPct ?? 0) >= 4 ? 'warn' : undefined
  const laborFlag = (m.laborPct ?? 0) >= 30 ? 'warn' : undefined

  const pours = (m.topPours ?? []).slice(0, 5)
  const poursHtml = pours.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-top:6px">` +
      pours
        .map(
          (p, i) =>
            `<tr><td style="padding:7px 0;border-bottom:1px solid ${LINE};font:600 14px -apple-system,Segoe UI,Roboto,sans-serif;color:${INK}">${i + 1}. ${escapeHtml(p.name)}</td><td style="padding:7px 0;border-bottom:1px solid ${LINE};text-align:right;font:700 14px -apple-system,Segoe UI,Roboto,sans-serif;color:${MUTED}">${int(p.qty)}</td></tr>`,
        )
        .join('') +
      `</table>`
    : `<div style="color:${MUTED};font:14px -apple-system,Segoe UI,Roboto,sans-serif">No pour data.</div>`

  return `<div style="max-width:600px;margin:0 auto;background:${PAPER};font-family:-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="background:${INK};border-radius:12px 12px 0 0;padding:20px 22px">
    <div style="font:600 12px/1 -apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:${AMBER}">One Fourteen · Nightly Rundown</div>
    <div style="font:700 26px/1.1 -apple-system,Segoe UI,Roboto,sans-serif;color:#fff;margin-top:6px">${escapeHtml(m.businessDate)}</div>
  </div>

  <div style="border:1px solid ${LINE};border-top:none;border-radius:0 0 12px 12px;padding:20px 22px">
    <p style="font:400 16px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:${INK};margin:0 0 18px">${escapeHtml(paragraph)}</p>

    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">
      <tr>${metricCard('Net sales', money(m.netSales))}${metricCard('Guests', int(m.totalGuests))}</tr>
      <tr>${metricCard('Avg check', money2(m.aov))}${metricCard('Discounts', money(m.discountAmount))}</tr>
      <tr>${metricCard('Voids', `${money(m.voidAmount)} · ${pct(m.voidPct)}`, voidsFlag)}${metricCard('Labor', pct(m.laborPct), laborFlag)}</tr>
    </table>

    <div style="font:600 11px/1.2 -apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};margin:14px 0 2px">Top pours</div>
    ${poursHtml}

    <div style="margin-top:18px;padding-top:12px;border-top:1px solid ${LINE};font:400 12px -apple-system,Segoe UI,Roboto,sans-serif;color:${MUTED}">
      Source: Toast · One Fourteen Virtual GM · auto-generated
    </div>
  </div>
</div>`
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}
