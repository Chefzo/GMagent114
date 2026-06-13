// Module: events (built after v1 ordering).
//
// Planned flow: intake an event request (email/form) -> place a Google Calendar
// hold -> generate a staffing + stock-prep checklist into the Events tab ->
// remind assigned bartenders as the date approaches. The checklist generator is
// pure and already usable.

import type { Category } from "../lib/types.ts";

export interface EventRequest {
  name: string;
  date: string; // ISO
  headcount: number;
  contact: string;
  notes?: string;
}

export interface PrepChecklist {
  staffingBartenders: number;
  stockPrep: { category: Category; note: string }[];
}

/** Pure: rough staffing + stock prep from headcount (tune ratios per your venue). */
export function buildPrepChecklist(req: EventRequest): PrepChecklist {
  const staffingBartenders = Math.max(1, Math.ceil(req.headcount / 50));
  return {
    staffingBartenders,
    stockPrep: [
      { category: "liquor", note: `Top off well + check rail for ~${req.headcount} guests` },
      { category: "beer", note: `Stock ~${Math.ceil(req.headcount / 4)} servings of expected beers` },
      { category: "wine", note: `Chill ~${Math.ceil(req.headcount / 6)} bottles` },
      { category: "other", note: "Napkins, garnish, ice — confirm 2x normal" },
    ],
  };
}

export async function createCalendarHold(): Promise<void> {
  throw new Error("events.createCalendarHold not implemented yet — scheduled after v1 ordering.");
}
