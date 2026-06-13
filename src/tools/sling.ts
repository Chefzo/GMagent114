// Live Sling client (used by the scheduling module, built after v1). Reads the
// current user's org, users, and published shifts. Sling's token is bound to
// the admin login, so an admin token sees all shifts.

import { slingAuth } from "../lib/auth.ts";
import { log } from "../lib/logger.ts";

export interface SlingShift {
  id: number;
  user?: { id: number };
  position?: { id: number; name?: string };
  dtstart: string;
  dtend: string;
}

export class SlingClient {
  private async headers(): Promise<{ Authorization: string }> {
    const { token } = await slingAuth();
    return { Authorization: token };
  }

  /** Published shifts overlapping [fromIso, toIso]. */
  async getShifts(fromIso: string, toIso: string): Promise<SlingShift[]> {
    const { baseUrl } = await slingAuth();
    const url = `${baseUrl}/v1/calendar?dates=${encodeURIComponent(fromIso)}/${encodeURIComponent(toIso)}`;
    const res = await fetch(url, { headers: await this.headers() });
    if (!res.ok) throw new Error(`Sling shifts failed: ${res.status} ${await res.text()}`);
    const shifts = (await res.json()) as SlingShift[];
    log.info(`Sling: ${shifts.length} shift(s) for ${fromIso}..${toIso}`);
    return shifts;
  }
}
