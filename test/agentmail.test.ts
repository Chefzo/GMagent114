// Tests for the AgentMail payload builder (the network send is integration-only).
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAgentMailPayload } from "../src/tools/agentMail.ts";

test("buildAgentMailPayload: maps to/subject/body, omits attachments when none", () => {
  const p = buildAgentMailPayload("owner@114.example", "Hi", "body text", []);
  assert.deepEqual(p, { to: "owner@114.example", subject: "Hi", text: "body text" });
  assert.equal("attachments" in p, false);
});

test("buildAgentMailPayload: base64-encodes attachment content with its mime type", () => {
  const p = buildAgentMailPayload("o@x", "Order", "see attached", [
    { filename: "order-guide.csv", mimeType: "text/csv", content: "sku,qty\nABC,2\n" },
  ]);
  assert.equal(p.attachments!.length, 1);
  const att = p.attachments![0]!;
  assert.equal(att.filename, "order-guide.csv");
  assert.equal(att.contentType, "text/csv");
  assert.equal(Buffer.from(att.content, "base64").toString("utf8"), "sku,qty\nABC,2\n");
});
