const endpoints = [
  '/api/health',
  '/api/gm/shift-digest',
  '/api/gm/pre-shift',
  '/api/gm/deposit-recon',
  '/api/gm/pnl-snapshot',
  '/api/gm/permits',
  '/api/gm/event-lifecycle',
]

console.log('Phase 1 scaffold endpoints:')
for (const endpoint of endpoints) console.log(`- ${endpoint}`)
