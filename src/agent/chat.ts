// On-demand chat entrypoint: `npm run chat`. Lets the owner/manager ask the GM
// agent things ("what would the GFS order look like?", "what's below par?").
//
// The Anthropic SDK is imported lazily so the rest of the project (and the
// dry-run ordering job) runs even before `npm install`. Tools are exposed to
// the model so it can actually read the backbone and draft orders.

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { isDryRun, requireEnv } from "../lib/config.ts";
import { log } from "../lib/logger.ts";
import { GM_SYSTEM_PROMPT } from "./persona.ts";
import { mockToolbox } from "../tools/mock.ts";
import { liveToolbox } from "../tools/factory.ts";
import { computeReorder, buildApprovalEmail } from "../modules/ordering.ts";
import { buildCountChecklist, runVarianceReview } from "../modules/inventory.ts";
import type { Toolbox } from "../tools/clients.ts";
import type { CountEntry } from "../lib/types.ts";

// --- tool implementations the model can call --------------------------------
async function toolPreviewOrder(tb: Toolbox): Promise<string> {
  const config = await tb.data.getConfig();
  const [par, inv, cat] = await Promise.all([
    tb.data.getParLevels(),
    tb.data.getInventory(),
    tb.data.getCatalog(),
  ]);
  const drafts = computeReorder(par, inv, cat, config);
  return JSON.stringify({ drafts, approval: buildApprovalEmail(drafts, config) }, null, 2);
}

async function toolBelowPar(tb: Toolbox): Promise<string> {
  const [par, inv] = await Promise.all([tb.data.getParLevels(), tb.data.getInventory()]);
  const onHand = new Map(inv.map((i) => [i.item, i.onHand]));
  const low = par
    .filter((p) => (onHand.get(p.item) ?? 0) <= p.reorderPoint)
    .map((p) => ({ item: p.item, onHand: onHand.get(p.item) ?? 0, reorderPoint: p.reorderPoint, par: p.par }));
  return JSON.stringify(low, null, 2);
}

async function toolCountChecklist(tb: Toolbox): Promise<string> {
  return JSON.stringify(buildCountChecklist(await tb.data.getParLevels()), null, 2);
}

async function toolRecordCount(tb: Toolbox, input: unknown): Promise<string> {
  const counts = ((input as { counts?: CountEntry[] })?.counts ?? []).filter(
    (c) => c && typeof c.item === "string" && typeof c.onHand === "number",
  );
  if (counts.length === 0) return `No valid counts provided. Expected {"counts":[{"item","onHand"}]}.`;
  const review = await runVarianceReview(tb, counts);
  return JSON.stringify({ recorded: counts.length, flagged: review.flagged, report: review.email }, null, 2);
}

const TOOLS = [
  {
    name: "preview_order",
    description: "Compute the proposed per-vendor reorder (and approval email) from current Sheet data.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "items_below_par",
    description: "List items currently at or below their reorder point.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "count_checklist",
    description: "List the items to physically count, grouped by category in counting order.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "record_count",
    description:
      "Record physical inventory counts (overwriting on-hand) and report variance vs. expected. Use after the user reports counted numbers.",
    input_schema: {
      type: "object" as const,
      properties: {
        counts: {
          type: "array",
          description: "One entry per counted item.",
          items: {
            type: "object",
            properties: {
              item: { type: "string" },
              onHand: { type: "number" },
              location: { type: "string" },
            },
            required: ["item", "onHand"],
          },
        },
      },
      required: ["counts"],
    },
  },
];

async function runTool(name: string, input: unknown, tb: Toolbox): Promise<string> {
  switch (name) {
    case "preview_order":
      return toolPreviewOrder(tb);
    case "items_below_par":
      return toolBelowPar(tb);
    case "count_checklist":
      return toolCountChecklist(tb);
    case "record_count":
      return toolRecordCount(tb, input);
    default:
      return `Unknown tool: ${name}`;
  }
}

async function main(): Promise<void> {
  const dry = isDryRun();
  const tb = dry ? mockToolbox() : liveToolbox();

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  const model = process.env.GM_MODEL ?? "claude-opus-4-8";

  const rl = createInterface({ input: stdin, output: stdout });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const history: any[] = [];
  log.info(`GM Agent chat (dryRun=${dry}, model=${model}). Type 'exit' to quit.`);

  for (;;) {
    const user = (await rl.question("\nyou › ")).trim();
    if (!user || user.toLowerCase() === "exit") break;
    history.push({ role: "user", content: user });

    // Tool-use loop until the model produces a final text turn.
    for (;;) {
      const resp = await client.messages.create({
        model,
        max_tokens: 1024,
        system: GM_SYSTEM_PROMPT,
        tools: TOOLS,
        messages: history,
      });
      history.push({ role: "assistant", content: resp.content });

      const toolUses = resp.content.filter((b) => b.type === "tool_use");
      if (toolUses.length === 0) {
        const text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("");
        console.log(`\ngm  › ${text}`);
        break;
      }
      const results = [];
      for (const tu of toolUses) {
        const out = await runTool(tu.name, tu.input, tb);
        results.push({ type: "tool_result", tool_use_id: tu.id, content: out });
      }
      history.push({ role: "user", content: results });
    }
  }
  rl.close();
}

main().catch((err) => {
  log.error("Chat failed", err);
  process.exitCode = 1;
});
