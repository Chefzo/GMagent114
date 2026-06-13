// Assembles the live Toolbox from the real clients. In dry-run, callers use
// mockToolbox() instead so nothing touches the network.

import { GoogleSheetsBackbone } from "./googleSheets.ts";
import { ToastSalesSource } from "./toast.ts";
import { GmailMailer } from "./gmail.ts";
import type { Toolbox } from "./clients.ts";

export function liveToolbox(): Toolbox {
  return {
    data: new GoogleSheetsBackbone(),
    sales: new ToastSalesSource(),
    mailer: new GmailMailer(),
    dryRun: false,
  };
}
