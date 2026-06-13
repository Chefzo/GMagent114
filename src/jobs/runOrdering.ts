// Scheduled entrypoint for the ordering job (run by GitHub Actions cron, or
// manually with `npm run ordering` / `npm run ordering -- --dry-run`).
//
//   --dry-run        use fixtures + mock clients; no network, no emails sent
//   --since=ISO      override the "depletion since" window (default: 4 days ago)
//
// The job drafts orders and emails ONE approval summary. Actually sending the
// vendor orders happens after approval (see src/lib/approval.ts), so a failed
// or noisy run never spends money.

import { isDryRun, env } from "../lib/config.ts";
import { log } from "../lib/logger.ts";
import { runOrderingPass } from "../modules/ordering.ts";
import { mockToolbox } from "../tools/mock.ts";
import { liveToolbox } from "../tools/factory.ts";

function sinceArg(argv: string[]): string {
  const flag = argv.find((a) => a.startsWith("--since="));
  if (flag) return flag.slice("--since=".length);
  const days = Number(env("ORDER_LOOKBACK_DAYS") ?? 4);
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

async function main(): Promise<void> {
  const dry = isDryRun();
  const since = sinceArg(process.argv);
  log.info(`Ordering job starting (dryRun=${dry}, since=${since})`);

  const tb = dry ? mockToolbox() : liveToolbox();
  const { drafts } = await runOrderingPass(tb, since);

  log.info("=== Ordering summary ===");
  for (const d of drafts) {
    log.info(`${d.vendor.name}: ${d.lines.length} line(s), est $${d.estTotal.toFixed(2)}`);
    for (const l of d.lines) log.info(`   ${l.item} x${l.packs} ($${l.estLineCost.toFixed(2)}) — ${l.reason}`);
  }
  if (drafts.length === 0) log.info("Nothing to order.");
  log.info(`Ordering job done. ${drafts.length} draft(s) awaiting approval.`);
}

main().catch((err) => {
  log.error("Ordering job failed", err);
  process.exitCode = 1;
});
