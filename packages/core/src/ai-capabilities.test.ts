import { describe, expect, it } from "vitest";
import { AI_CAPABILITIES, assertCatalogueSafe, effectiveAutonomy, type AiCapability } from "./ai-capabilities";
import { PERMISSIONS } from "./permissions";

describe("AI capability catalogue", () => {
  it("passes every hard rule", () => {
    expect(() => assertCatalogueSafe()).not.toThrow();
  });

  it("has unique ids", () => {
    const ids = AI_CAPABILITIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never lets AI take a binding action on its own", () => {
    for (const c of AI_CAPABILITIES as readonly AiCapability[]) {
      if (c.leadsTo.some((p) => PERMISSIONS[p].effect === "consequential")) expect(["off", "suggest", "draft"]).toContain(c.maxAutonomy);
    }
    expect(effectiveAutonomy("pricing_suggestions", "auto")).toBe("draft");
    expect(effectiveAutonomy("renewal_assistant", "auto")).toBe("draft");
  });

  it("rejects an unsafe entry", () => {
    const unsafe = { ...AI_CAPABILITIES[0], id: "x", guardrails: [] } as AiCapability;
    expect(() => assertCatalogueSafe([unsafe])).toThrow(/discloses_ai/);
    const binding = { id: "y", category: "leads", workspaces: [], maxAutonomy: "auto", defaultAutonomy: "auto", leadsTo: ["unit.hold.approve"], needs: [], guardrails: [], milestone: 7 } as AiCapability;
    expect(() => assertCatalogueSafe([binding])).toThrow(/binding/);
  });

  it("calls always ask for recording consent", () => {
    const voice = AI_CAPABILITIES.find((c) => c.id === "ai_voice_agent")!;
    expect(voice.guardrails).toEqual(expect.arrayContaining(["discloses_ai", "recording_consent", "human_handoff", "quiet_hours", "opt_out"]));
  });
});
