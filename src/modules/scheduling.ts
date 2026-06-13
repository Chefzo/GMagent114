// Module: scheduling (built after v1 ordering). Uses the Sling direct API.
//
// Planned flow: read published shifts + availability from Sling, cross-check
// labor cost against Toast sales (target labor %), flag coverage gaps and
// overtime, draft next week's bartender schedule, and push it back to Sling on
// approval. computeCoverageGaps is pure and already testable.

import type { SlingShift } from "../tools/sling.ts";

export interface CoverageRule {
  /** Day of week 0-6 (Sun..Sat). */
  day: number;
  /** Minimum bartenders required during the window. */
  minBartenders: number;
  startHour: number;
  endHour: number;
}

export interface CoverageGap {
  day: number;
  hour: number;
  have: number;
  need: number;
}

/** Pure: find hours where scheduled bartenders fall below the coverage rule. */
export function computeCoverageGaps(shifts: SlingShift[], rules: CoverageRule[]): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  for (const rule of rules) {
    for (let hour = rule.startHour; hour < rule.endHour; hour++) {
      const have = shifts.filter((s) => {
        const start = new Date(s.dtstart);
        const end = new Date(s.dtend);
        return start.getDay() === rule.day && start.getHours() <= hour && end.getHours() > hour;
      }).length;
      if (have < rule.minBartenders) gaps.push({ day: rule.day, hour, have, need: rule.minBartenders });
    }
  }
  return gaps;
}

export async function pushScheduleToSling(): Promise<void> {
  throw new Error("scheduling.pushScheduleToSling not implemented yet — scheduled after v1 ordering.");
}
