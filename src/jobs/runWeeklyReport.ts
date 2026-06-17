// Scheduled entrypoint for the weekly GM report (GitHub Actions cron, or
// `npm run report:weekly` / `-- --dry-run`).
//
// Pulls the last 7 days of Toast sales, labor, and OrderHistory, computes the
// week's metrics, and emails the owner the digest. Read-only.

import { isDryRun } from "../lib/config.ts";
import { log } from "../lib/logger.ts";
import { runWeeklyReport } from "../modules/reporting.ts";
import { mockToolbox } from "../tools/mock.ts";
import { liveToolbox } from "../tools/factory.ts";

async function main(): Promise<void> {
  const dry = isDryRun();
  const tb = dry ? mockToolbox() : liveToolbox();
  log.info(`Weekly report starting (dryRun=${dry})`);

  const { metrics, email } = await runWeeklyReport(tb);
  log.info(
    `Done. Sales $${metrics.sales.toFixed(0)}, labor ${metrics.laborPct.toFixed(1)}%, ` +
      `pour ${metrics.pourCostPct.toFixed(1)}%. Owner emailed: "${email.subject}".`,
  );
}

main().catch((err) => {
  log.error("Weekly report failed", err);
  process.exitCode = 1;
});
