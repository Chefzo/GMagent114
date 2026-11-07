// Mission Control — the operator control plane. Server component: reads the
// live job log, latest digest, approval queue, and upcoming permits/events
// straight from Supabase on each request. Laid out in the operator-dashboard
// shape (Today / Pulse / Open loops / This week / Approval queue).

import { loadMissionControl } from '@/lib/gm/missionControl'

export const dynamic = 'force-dynamic'

const LANES: Array<[string, string, string]> = [
  ['Nightly digest', '/api/gm/shift-digest', '2am EOD Toast read'],
  ['Pre-shift brief', '/api/gm/pre-shift', 'Lead-bartender SMS before doors'],
  ['Deposit recon', '/api/gm/deposit-recon', 'Counted drop vs Toast cash'],
  ['Weekly P&L', '/api/gm/pnl-snapshot', 'Sunday operator read'],
  ['Permits', '/api/gm/permits', '60 / 30 / 7-day renewals'],
  ['Event lifecycle', '/api/gm/event-lifecycle', '14-day / day-of / recap'],
]

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch {
    return iso
  }
}

export default async function MissionControl() {
  const data = await loadMissionControl()

  return (
    <main>
      <section className="hero">
        <div className="kicker">One Fourteen · Mission Control 🥃</div>
        <h1 className="title">Virtual GM — Phase 1</h1>
        <p className="copy">
          The GM-cadence engine: nightly digest, pre-shift brief, deposit recon, weekly P&amp;L, permits, and event
          lifecycle. Nothing public, financial, legal, or staff-sensitive ships without an approval gate.
        </p>
        <div className={`status ${data.connected ? 'ok' : 'warn'}`}>
          {data.connected ? 'Supabase connected · live' : 'Supabase not configured · preview mode'}
        </div>
      </section>

      {/* The Pulse — latest digest */}
      <section className="pulse">
        <div className="pulse-label">Last digest</div>
        {data.latestDigest ? (
          <>
            <p className="pulse-text">{data.latestDigest.summary_text}</p>
            <div className="pulse-meta">business date {data.latestDigest.business_date}</div>
          </>
        ) : (
          <p className="pulse-text muted">No digest logged yet. Fire one at <code>/api/gm/shift-digest</code>.</p>
        )}
      </section>

      <section className="grid">
        {/* Open loops — lanes */}
        <article className="card">
          <h2>Lanes</h2>
          <ul className="lanes">
            {LANES.map(([name, path, desc]) => (
              <li key={path}>
                <span className="lane-name">{name}</span>
                <span className="lane-desc">{desc}</span>
                <code className="lane-path">{path}</code>
              </li>
            ))}
          </ul>
        </article>

        {/* Approval queue */}
        <article className="card">
          <h2>Approval queue {data.pendingApprovals.length ? `(${data.pendingApprovals.length})` : ''}</h2>
          {data.pendingApprovals.length ? (
            <ul className="list">
              {data.pendingApprovals.map((a, i) => (
                <li key={i}>
                  <span className="tag">{a.action}</span> {a.summary}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Nothing waiting on your signoff.</p>
          )}
        </article>

        {/* This week — permits + events */}
        <article className="card">
          <h2>This week &amp; ahead</h2>
          <h3>Permits</h3>
          {data.upcomingPermits.length ? (
            <ul className="list">
              {data.upcomingPermits.map((p, i) => (
                <li key={i}>
                  {p.name} — <span className="muted">{fmtDate(p.renewal_date)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No upcoming renewals.</p>
          )}
          <h3>Events</h3>
          {data.upcomingEvents.length ? (
            <ul className="list">
              {data.upcomingEvents.map((e, i) => (
                <li key={i}>
                  {e.name} — <span className="muted">{fmtDate(e.event_date)}{e.headcount ? ` · ${e.headcount}` : ''}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No events on the books.</p>
          )}
        </article>

        {/* Recent job runs */}
        <article className="card">
          <h2>Recent runs</h2>
          {data.recentRuns.length ? (
            <ul className="runs">
              {data.recentRuns.map((r, i) => (
                <li key={i} className={r.escalated ? 'run escalated' : 'run'}>
                  <span className={`dot ${r.status}`} />
                  <span className="run-job">{r.job}</span>
                  <span className="run-summary">{r.summary}</span>
                  <span className="run-time">{fmtTime(r.created_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No runs logged yet.</p>
          )}
        </article>
      </section>

      <p className="footer">Built for One Fourteen. Operator cadence first. Fancy later.</p>
    </main>
  )
}
