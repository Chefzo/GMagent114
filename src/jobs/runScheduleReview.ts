// Scheduled entrypoint for the weekly schedule review (GitHub Actions cron, or
// `npm run schedule:review` / `-- --dry-run`).
//
// Reviews next week's published Sling schedule against coverage rules, overtime
// thresholds, and the labor budget, and emails the owner if anything needs
// attention. Read-only — it never writes a schedule (that stays approval-gated).

import { isDryRun } from "../lib/config.ts";
import { log } from "../lib/logger.ts";
import { runScheduleReview } from "../modules/scheduling.ts";
import { mockToolbox } from "../tools/mock.ts";
import { liveToolbox } from "../tools/factory.ts";

/** Start of "next week" (next Sunday 00:00 local) through 7 days later. */
function nextWeekWindow(now = new Date()): { fromIso: string; toIso: string } {
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() + ((7 - from.getDay()) % 7 || 7)); // upcoming Sunday
  const to = new Date(from);
  to.setDate(to.getDate() + 7);
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

async function main(): Promise<void> {
  const dry = isDryRun();
  const tb = dry ? mockToolbox() : liveToolbox();
  const { fromIso, toIso } = nextWeekWindow();
  log.info(`Schedule review starting (dryRun=${dry}) for ${fromIso}..${toIso}`);

  const { windows, overtime, labor, email } = await runScheduleReview(tb, fromIso, toIso);
  log.info(
    `Done. ${windows.length} coverage gap(s), ${overtime.length} overtime risk(s), ` +
      `projected labor $${labor.totalCost.toFixed(2)}. ${email ? "Owner emailed." : "Nothing to flag."}`,
  );
}

main().catch((err) => {
  log.error("Schedule review failed", err);
  process.exitCode = 1;
});
