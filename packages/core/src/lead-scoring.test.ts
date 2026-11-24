import { describe, expect, it } from "vitest";
import { scoreLead, type LeadFacts } from "./lead-scoring";

const now = new Date("2026-11-24T12:00:00Z");
const base: LeadFacts = { hasPhone: false, budgetStated: false, timeline: "unknown", financing: "unknown", specificRequirements: false, requestedAppointment: false, completedViewings: 0, upcomingViewings: 0, lastActivityAt: new Date("2026-11-10T12:00:00Z") };

describe("lead scoring", () => {
  it("explains every point", () => {
    const s = scoreLead({ ...base, hasPhone: true, budgetStated: true, timeline: "3_months", financing: "cash", completedViewings: 1, lastActivityAt: now }, null, now);
    expect(s.lines.map((l) => [l.signal, l.points])).toEqual([["reachable_by_phone", 10], ["budget_stated", 15], ["timeline", 15], ["financing", 10], ["viewing_completed", 20], ["recent_activity", 10]]);
    expect(s).toMatchObject({ score: 80, band: "hot", computedBand: "hot" });
  });
  it("treats a quiet lead as cold, never below zero", () => {
    const s = scoreLead({ ...base, lastActivityAt: new Date("2026-09-01T00:00:00Z") }, null, now);
    expect(s).toMatchObject({ score: 0, band: "cold" });
    expect(s.lines).toEqual([{ signal: "inactive", points: -15, value: "84" }]);
  });
  it("lets a person override the band, keeping the computed score and reasons", () => {
    const s = scoreLead({ ...base, timeline: "now", lastActivityAt: now }, { band: "hot", reason: "Called back, ready to reserve", byName: "Sara", at: now }, now);
    expect(s).toMatchObject({ score: 30, computedBand: "warm", band: "hot" });
    expect(s.lines.length).toBe(2);
  });
});
