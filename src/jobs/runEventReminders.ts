// Scheduled entrypoint for event reminders (GitHub Actions cron, or
// `npm run events:remind` / `-- --dry-run`).
//
// Reads upcoming bookings from Google Calendar (the source of truth), builds a
// prep/staffing checklist per event, and emails the owner the digest. Read-only.

import { isDryRun, env } from "../lib/config.ts";
import { log } from "../lib/logger.ts";
import { runEventReminders } from "../modules/events.ts";
import { mockToolbox } from "../tools/mock.ts";
import { liveToolbox } from "../tools/factory.ts";

async function main(): Promise<void> {
  const dry = isDryRun();
  const tb = dry ? mockToolbox() : liveToolbox();
  const withinDays = Number(env("EVENT_REMINDER_DAYS") ?? 7);
  log.info(`Event reminders starting (dryRun=${dry}, withinDays=${withinDays})`);

  const { events, email } = await runEventReminders(tb, { withinDays });
  log.info(`Done. ${events.length} upcoming event(s). ${email ? "Owner emailed." : "Nothing to remind."}`);
}

main().catch((err) => {
  log.error("Event reminders failed", err);
  process.exitCode = 1;
});
