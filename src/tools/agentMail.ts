// Live AgentMail mailer. Sends via the AgentMail REST API from the bar's agent
// inbox (onefourteen@agentmail.to). Chosen over Gmail because it needs only an
// API key — no Google service account / domain-wide delegation for sending.

import { requireEnv, env } from "../lib/config.ts";
import { log } from "../lib/logger.ts";
import type { Attachment, Mailer } from "./clients.ts";

interface AgentMailPayload {
  to: string;
  subject: string;
  text: string;
  attachments?: { filename: string; content: string; contentType: string }[];
}

/** Pure: build the JSON body for AgentMail's send endpoint (content base64). */
export function buildAgentMailPayload(
  to: string,
  subject: string,
  body: string,
  attachments: Attachment[],
): AgentMailPayload {
  const payload: AgentMailPayload = { to, subject, text: body };
  if (attachments.length > 0) {
    payload.attachments = attachments.map((a) => ({
      filename: a.filename,
      contentType: a.mimeType,
      content: Buffer.from(a.content).toString("base64"),
    }));
  }
  return payload;
}

export class AgentMailMailer implements Mailer {
  private readonly apiKey = requireEnv("AGENTMAIL_API_KEY");
  private readonly inbox = requireEnv("AGENTMAIL_INBOX");
  private readonly baseUrl = env("AGENTMAIL_BASE_URL") ?? "https://api.agentmail.to";

  async send(to: string, subject: string, body: string, attachments: Attachment[] = []): Promise<void> {
    const url = `${this.baseUrl}/v0/inboxes/${encodeURIComponent(this.inbox)}/messages/send`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildAgentMailPayload(to, subject, body, attachments)),
    });
    if (!res.ok) throw new Error(`AgentMail send failed: ${res.status} ${await res.text()}`);
    log.info(`Email sent to ${to} via AgentMail: "${subject}"`);
  }
}
