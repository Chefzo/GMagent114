// Read-only Toast summary for one business day, printed as JSON.
//   npm run toast:summary                      last closed business day
//   npm run toast:summary -- --date 2026-11-05
// Credentials come from the environment, or from .env.local when present.
// They are never printed.
import { existsSync } from 'node:fs'

const envFile = new URL('../.env.local', import.meta.url)
if (existsSync(envFile)) process.loadEnvFile(envFile)

const dateIndex = process.argv.indexOf('--date')
const date = dateIndex === -1 ? undefined : process.argv[dateIndex + 1]

const { getToastSummary } = await import('../lib/integrations/toastSummary.ts')
try {
  console.log(JSON.stringify(await getToastSummary(date), null, 2))
} catch (error) {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  process.exit(1)
}
