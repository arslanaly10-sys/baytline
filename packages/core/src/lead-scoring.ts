/**
 * Lead scoring (milestone 12). Rule-based and explainable: each signal adds or removes a fixed number
 * of points, and every score comes with the list of signals that produced it. No AI, no hidden weights.
 * A person may override the band with a reason; the computed score and its reasons stay visible.
 */
export const LEAD_STATUSES = ["new", "contacted", "qualified", "viewing", "negotiating", "won", "lost", "archived"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_TIMELINES = ["now", "3_months", "6_months", "12_months", "unknown"] as const;
export type LeadTimeline = (typeof LEAD_TIMELINES)[number];
export const LEAD_FINANCING = ["cash", "mortgage", "unknown"] as const;
export type LeadFinancing = (typeof LEAD_FINANCING)[number];
export const SCORE_BANDS = ["hot", "warm", "cold"] as const;
export type ScoreBand = (typeof SCORE_BANDS)[number];

export type ScoreSignal =
  | "reachable_by_phone" | "budget_stated" | "timeline" | "financing" | "specific_requirements"
  | "requested_appointment" | "viewing_completed" | "viewing_upcoming" | "recent_activity" | "inactive";

/** The rules, in one place, so the screen can publish them. Points per signal. */
export const SCORE_RULES = {
  reachable_by_phone: 10,
  budget_stated: 15,
  timeline: { now: 20, "3_months": 15, "6_months": 8, "12_months": 3, unknown: 0 },
  financing: { cash: 10, mortgage: 5, unknown: 0 },
  specific_requirements: 5,
  requested_appointment: 10,
  viewing_completed: 20,
  viewing_upcoming: 5,
  recent_activity: 10, // last activity within 7 days
  inactive: -15, // no activity for more than 30 days
} as const;

export const BAND_THRESHOLDS = { hot: 60, warm: 30 } as const;

export type LeadFacts = {
  hasPhone: boolean;
  budgetStated: boolean;
  timeline: LeadTimeline;
  financing: LeadFinancing;
  specificRequirements: boolean;
  requestedAppointment: boolean;
  completedViewings: number;
  upcomingViewings: number;
  lastActivityAt: Date;
};

export type ScoreLine = { signal: ScoreSignal; points: number; value?: string };
export type LeadScore = {
  score: number;
  band: ScoreBand;
  computedBand: ScoreBand;
  lines: ScoreLine[];
  override: { band: ScoreBand; reason: string; byName: string | null; at: Date | null } | null;
};

export function bandFor(score: number): ScoreBand {
  return score >= BAND_THRESHOLDS.hot ? "hot" : score >= BAND_THRESHOLDS.warm ? "warm" : "cold";
}

export function scoreLead(f: LeadFacts, override: LeadScore["override"] = null, now = new Date()): LeadScore {
  const lines: ScoreLine[] = [];
  const add = (signal: ScoreSignal, points: number, value?: string) => { if (points !== 0) lines.push({ signal, points, value }); };
  if (f.hasPhone) add("reachable_by_phone", SCORE_RULES.reachable_by_phone);
  if (f.budgetStated) add("budget_stated", SCORE_RULES.budget_stated);
  add("timeline", SCORE_RULES.timeline[f.timeline], f.timeline);
  add("financing", SCORE_RULES.financing[f.financing], f.financing);
  if (f.specificRequirements) add("specific_requirements", SCORE_RULES.specific_requirements);
  if (f.requestedAppointment) add("requested_appointment", SCORE_RULES.requested_appointment);
  if (f.completedViewings > 0) add("viewing_completed", SCORE_RULES.viewing_completed);
  if (f.upcomingViewings > 0) add("viewing_upcoming", SCORE_RULES.viewing_upcoming);
  const days = (now.getTime() - f.lastActivityAt.getTime()) / 864e5;
  if (days <= 7) add("recent_activity", SCORE_RULES.recent_activity);
  else if (days > 30) add("inactive", SCORE_RULES.inactive, String(Math.floor(days)));
  const score = Math.max(0, Math.min(100, lines.reduce((s, l) => s + l.points, 0)));
  const computedBand = bandFor(score);
  return { score, computedBand, band: override?.band ?? computedBand, lines, override };
}
