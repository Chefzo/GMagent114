// Assembles the live Toolbox from the real clients. In dry-run, callers use
// mockToolbox() instead so nothing touches the network.

import { GoogleSheetsBackbone } from "./googleSheets.ts";
import { ToastSalesSource } from "./toast.ts";
import { GmailMailer } from "./gmail.ts";
import { SlingClient } from "./sling.ts";
import { GoogleCalendarSource } from "./googleCalendar.ts";
import type { ScheduleSource, Toolbox } from "./clients.ts";
import type { Shift } from "../lib/types.ts";

/**
 * Adapts the raw Sling API (SlingShift with ISO timestamps + a numeric user id)
 * to the normalized `Shift` the scheduling module reasons over. Bartender names
 * come from the position label when present; otherwise we fall back to the user
 * id (a Sling users lookup can replace this once we need real names live).
 */
class SlingScheduleSource implements ScheduleSource {
  private readonly client = new SlingClient();
  async getShifts(fromIso: string, toIso: string): Promise<Shift[]> {
    const raw = await this.client.getShifts(fromIso, toIso);
    return raw.map((s) => {
      const start = new Date(s.dtstart);
      const end = new Date(s.dtend);
      // A shift ending past midnight rolls into 24+ so the duration stays positive.
      const endHour = end.getDate() === start.getDate() ? end.getHours() : end.getHours() + 24;
      return {
        bartender: s.position?.name ?? `user-${s.user?.id ?? "?"}`,
        day: start.getDay(),
        startHour: start.getHours(),
        endHour,
      };
    });
  }
}

export function liveToolbox(): Toolbox {
  return {
    data: new GoogleSheetsBackbone(),
    sales: new ToastSalesSource(),
    schedule: new SlingScheduleSource(),
    calendar: new GoogleCalendarSource(),
    mailer: new GmailMailer(),
    dryRun: false,
  };
}
