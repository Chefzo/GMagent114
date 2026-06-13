// Live Gmail mailer. Sends RFC-2822 messages (with optional attachments) via
// the Gmail API using the service account's domain-wide delegation to send as
// the bar's Google account.

import { googleAccessToken } from "../lib/auth.ts";
import { requireEnv } from "../lib/config.ts";
import { log } from "../lib/logger.ts";
import type { Attachment, Mailer } from "./clients.ts";

const SCOPE = "https://www.googleapis.com/auth/gmail.send";

function buildMime(from: string, to: string, subject: string, body: string, attachments: Attachment[]): string {
  const boundary = `gm114_${Date.now()}`;
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    body,
  ];
  for (const att of attachments) {
    const b64 = Buffer.from(att.content).toString("base64");
    lines.push(
      `--${boundary}`,
      `Content-Type: ${att.mimeType}; name="${att.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${att.filename}"`,
      "",
      b64,
    );
  }
  lines.push(`--${boundary}--`, "");
  return lines.join("\r\n");
}

export class GmailMailer implements Mailer {
  private readonly from = requireEnv("GOOGLE_IMPERSONATE_USER");

  async send(to: string, subject: string, body: string, attachments: Attachment[] = []): Promise<void> {
    const token = await googleAccessToken([SCOPE], this.from);
    const mime = buildMime(this.from, to, subject, body, attachments);
    const raw = Buffer.from(mime).toString("base64url");
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) throw new Error(`Gmail send failed: ${res.status} ${await res.text()}`);
    log.info(`Email sent to ${to}: "${subject}"`);
  }
}
