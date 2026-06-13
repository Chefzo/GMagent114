// Parses the owner's reply to an approval email into a set of approved vendor
// keys. The ordering job emails a summary with "APPROVE ALL" / "APPROVE <KEY>"
// instructions; a follow-up job (or the chat agent) reads the reply, calls
// parseApprovalReply, then sendApprovedOrders(). Keeping this pure makes the
// money-gate easy to unit-test.

import type { DraftOrder } from "./types.ts";

export interface ApprovalDecision {
  approveAll: boolean;
  vendorKeys: string[]; // explicit vendor keys approved (lower-cased)
  skip: boolean;
}

/** Interpret a free-text reply. Case-insensitive; tolerant of extra words. */
export function parseApprovalReply(reply: string): ApprovalDecision {
  const text = reply.toUpperCase();
  if (/\bSKIP\b/.test(text) || /\bHOLD\b/.test(text)) {
    return { approveAll: false, vendorKeys: [], skip: true };
  }
  if (/\bAPPROVE\s+ALL\b/.test(text)) {
    return { approveAll: true, vendorKeys: [], skip: false };
  }
  const keys: string[] = [];
  const re = /\bAPPROVE\s+([A-Z0-9_-]+)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1] && m[1] !== "ALL") keys.push(m[1].toLowerCase());
  }
  return { approveAll: false, vendorKeys: keys, skip: false };
}

/** Resolve a decision against the drafted orders into the vendor keys to send. */
export function resolveApprovedVendors(decision: ApprovalDecision, drafts: DraftOrder[]): string[] {
  if (decision.skip) return [];
  if (decision.approveAll) return drafts.map((d) => d.vendor.key);
  return drafts.filter((d) => decision.vendorKeys.includes(d.vendor.key)).map((d) => d.vendor.key);
}
