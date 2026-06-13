const endpoints = [
  ['/api/gm/shift-digest', 'Nightly Toast digest scaffold'],
  ['/api/gm/pre-shift', 'Pre-shift SMS brief scaffold'],
  ['/api/gm/deposit-recon', 'Deposit variance scaffold'],
  ['/api/gm/pnl-snapshot', 'Weekly P&L snapshot scaffold'],
  ['/api/gm/permits', 'Permit reminder scaffold'],
  ['/api/gm/event-lifecycle', 'Event lifecycle scaffold'],
]

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <div className="kicker">One Fourteen Virtual GM · Phase 1</div>
        <h1 className="title">GMagent114</h1>
        <p className="copy">
          Phase 1 scaffold for the Virtual GM cadence engine. This lane is about recurring bar ops: nightly digest, pre-shift brief, deposit recon, weekly P&amp;L, permits, and event reminders.
        </p>
        <div className="status ok">Scaffold live</div>
      </section>

      <section className="grid">
        <article className="card">
          <h2>Phase 1 lanes</h2>
          <ul className="list">
            <li>Toast end-of-shift digest</li>
            <li>Pre-shift bartender brief</li>
            <li>Deposit reconciliation</li>
            <li>Weekly P&amp;L snapshot</li>
            <li>Permit reminder engine</li>
            <li>Event lifecycle reminders</li>
          </ul>
        </article>

        <article className="card">
          <h2>API stubs</h2>
          <ul className="list">
            {endpoints.map(([path, label]) => (
              <li key={path}><code>{path}</code> — {label}</li>
            ))}
          </ul>
        </article>

        <article className="card">
          <h2>Integration contracts</h2>
          <p>All external systems are stubbed behind lib/integrations so we can wire real Toast, Supabase, Twilio, Slack, and Google Calendar later without rewriting the job logic.</p>
        </article>

        <article className="card">
          <h2>Next build move</h2>
          <p>Start with the nightly Toast digest job. It has the highest leverage and the cleanest operator output.</p>
        </article>
      </section>

      <p className="footer">Built for One Fourteen. Operator cadence first. Fancy later.</p>
    </main>
  )
}
