// Scheduled entrypoint for the inventory count reminder (run by GitHub Actions
// cron, or manually with `npm run inventory:reminder` / `-- --dry-run`).
//
// It emails a category-ordered count checklist to the owner so staff can do a
// quick physical count and reply with the numbers; the reply is recorded via
// the chat agent's record_count tool (or a future inbound-email handler), which
// runs the variance review. This job never writes data — it only nudges.

import { isDryRun } from "../lib/config.ts";
import { log } from "../lib/logger.ts";
import { buildCountChecklist, buildCountReminderEmail } from "../modules/inventory.ts";
import { mockToolbox } from "../tools/mock.ts";
import { liveToolbox } from "../tools/factory.ts";

async function main(): Promise<void> {
  const dry = isDryRun();
  const tb = dry ? mockToolbox() : liveToolbox();
  log.info(`Inventory reminder starting (dryRun=${dry})`);

  const config = await tb.data.getConfig();
  const parLevels = await tb.data.getParLevels();
  const checklist = buildCountChecklist(parLevels);
  const total = checklist.reduce((n, g) => n + g.items.length, 0);

  if (total === 0) {
    log.info("No items in ParLevels to count — no reminder sent.");
    return;
  }

  const { subject, body } = buildCountReminderEmail(checklist, config);
  await tb.mailer.send(config.ownerEmail, subject, body);
  log.info(`Inventory reminder sent for ${total} item(s) across ${checklist.length} category group(s).`);
}

main().catch((err) => {
  log.error("Inventory reminder failed", err);
  process.exitCode = 1;
});
