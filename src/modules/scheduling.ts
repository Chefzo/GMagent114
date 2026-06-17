// Module: scheduling. Reads published shifts (Sling, normalized to `Shift`),
// cross-checks them against coverage rules, overtime thresholds, and a labor
// budget, and emails the owner a weekly review. Drafting/pushing a schedule
// back to Sling is the approval-gated write (pushScheduleToSling) and stays off
// until a human says go — same money/staffing safety model as ordering.

import { log } from "../lib/logger.ts";
import type { BarConfig, CoverageRule, SchedulingConfig, Shift } from "../lib/types.ts";
import type { Toolbox } from "../tools/clients.ts";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayName = (d: number) => DAYS[d] ?? `Day${d}`;
const hhmm = (h: number) => `${String(Math.floor(h) % 24).padStart(2, "0")}:00`;

export interface CoverageGap {
  day: number;
  hour: number;
  have: number;
  need: number;
}

/** Pure: hours where scheduled bartenders fall below the coverage rule. */
export function computeCoverageGaps(shifts: Shift[], rules: CoverageRule[]): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  for (const rule of rules) {
    for (let hour = rule.startHour; hour < rule.endHour; hour++) {
      const have = shifts.filter(
        (s) => s.day === rule.day && s.startHour <= hour && s.endHour > hour,
      ).length;
      if (have < rule.minBartenders) gaps.push({ day: rule.day, hour, have, need: rule.minBartenders });
    }
  }
  return gaps;
}

export interface GapWindow {
  day: number;
  startHour: number;
  endHour: number;
  have: number;
  need: number;
}

/** Pure: collapse consecutive single-hour gaps into readable windows. */
export function summarizeGaps(gaps: CoverageGap[]): GapWindow[] {
  const sorted = [...gaps].sort((a, b) => a.day - b.day || a.hour - b.hour);
  const windows: GapWindow[] = [];
  for (const g of sorted) {
    const last = windows[windows.length - 1];
    if (last && last.day === g.day && last.endHour === g.hour && last.have === g.have && last.need === g.need) {
      last.endHour = g.hour + 1;
    } else {
      windows.push({ day: g.day, startHour: g.hour, endHour: g.hour + 1, have: g.have, need: g.need });
    }
  }
  return windows;
}

export interface OvertimeRisk {
  bartender: string;
  hours: number;
  threshold: number;
}

/** Pure: bartenders whose total scheduled hours exceed the overtime threshold. */
export function computeOvertimeRisk(shifts: Shift[], threshold: number): OvertimeRisk[] {
  const hoursByPerson = new Map<string, number>();
  for (const s of shifts) {
    hoursByPerson.set(s.bartender, (hoursByPerson.get(s.bartender) ?? 0) + (s.endHour - s.startHour));
  }
  return [...hoursByPerson]
    .filter(([, hours]) => hours > threshold)
    .map(([bartender, hours]) => ({ bartender, hours, threshold }))
    .sort((a, b) => b.hours - a.hours);
}

export interface LaborProjection {
  totalHours: number;
  totalCost: number;
  budget?: number;
  overBudget: boolean;
}

/** Pure: projected labor hours and cost for the week, vs. an optional budget. */
export function computeLaborProjection(shifts: Shift[], config: SchedulingConfig): LaborProjection {
  let totalHours = 0;
  let totalCost = 0;
  for (const s of shifts) {
    const hours = s.endHour - s.startHour;
    const wage = config.wageByBartender[s.bartender] ?? config.defaultHourlyWage;
    totalHours += hours;
    totalCost += hours * wage;
  }
  const budget = config.weeklyLaborBudget;
  return {
    totalHours,
    totalCost,
    budget,
    overBudget: budget !== undefined && totalCost > budget,
  };
}

export interface ScheduleReview {
  windows: GapWindow[];
  overtime: OvertimeRisk[];
  labor: LaborProjection;
  email: { subject: string; body: string } | null;
}

/** Pure: render the weekly review email; null when nothing needs attention. */
export function buildScheduleReviewEmail(
  windows: GapWindow[],
  overtime: OvertimeRisk[],
  labor: LaborProjection,
  config: BarConfig,
): { subject: string; body: string } | null {
  const flags = windows.length + overtime.length + (labor.overBudget ? 1 : 0);
  if (flags === 0) return null;

  const sections: string[] = [];
  if (windows.length > 0) {
    sections.push("Coverage gaps (below minimum bartenders):");
    for (const w of windows) {
      sections.push(`  • ${dayName(w.day)} ${hhmm(w.startHour)}–${hhmm(w.endHour)}: have ${w.have}, need ${w.need}`);
    }
    sections.push("");
  }
  if (overtime.length > 0) {
    sections.push("Overtime risk:");
    for (const o of overtime) {
      sections.push(`  • ${o.bartender}: ${o.hours}h scheduled (over ${o.threshold}h)`);
    }
    sections.push("");
  }
  sections.push(
    `Projected labor: ${labor.totalHours}h, est $${labor.totalCost.toFixed(2)}` +
      (labor.budget !== undefined
        ? ` vs budget $${labor.budget.toFixed(2)}${labor.overBudget ? " — OVER" : " — ok"}`
        : ""),
  );

  const subject = `[${config.barName}] Schedule review — ${flags} item(s) to look at`;
  const body = [
    `Heads up on next week's published schedule for ${config.barName}:`,
    "",
    ...sections,
    "",
    `Fix coverage gaps and overtime in Sling, or reply and I'll draft adjustments for your approval.`,
  ].join("\n");
  return { subject, body };
}

/**
 * Orchestrate a schedule review for the window [fromIso, toIso]:
 *  1) read coverage rules / wages (Sheet) and published shifts (Sling)
 *  2) compute coverage gaps, overtime risk, and projected labor cost
 *  3) email the owner if anything needs attention (read-only — no writes)
 */
export async function runScheduleReview(tb: Toolbox, fromIso: string, toIso: string): Promise<ScheduleReview> {
  const [config, sched, shifts] = await Promise.all([
    tb.data.getConfig(),
    tb.data.getSchedulingConfig(),
    tb.schedule.getShifts(fromIso, toIso),
  ]);

  const windows = summarizeGaps(computeCoverageGaps(shifts, sched.coverageRules));
  const overtime = computeOvertimeRisk(shifts, sched.overtimeThreshold);
  const labor = computeLaborProjection(shifts, sched);
  log.info(
    `Schedule review: ${windows.length} gap window(s), ${overtime.length} OT risk(s), ` +
      `labor $${labor.totalCost.toFixed(2)}${labor.overBudget ? " (over budget)" : ""}.`,
  );

  const email = buildScheduleReviewEmail(windows, overtime, labor, config);
  if (email) {
    await tb.mailer.send(config.ownerEmail, email.subject, email.body);
  } else {
    log.info("Schedule looks clean — no review email sent.");
  }
  return { windows, overtime, labor, email };
}

/**
 * Draft and push next week's schedule to Sling. Gated on owner approval (same as
 * sending vendor orders) — not wired until the review flow is in daily use.
 */
export async function pushScheduleToSling(): Promise<void> {
  throw new Error(
    "scheduling.pushScheduleToSling not implemented yet — gated on approval, wired after review is in use.",
  );
}
