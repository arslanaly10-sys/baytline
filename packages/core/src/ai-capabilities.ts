import { PERMISSIONS, type Permission } from "./permissions";
import type { WorkspaceId } from "./workspaces";

/**
 * Catalogue of Baytline's AI capabilities: the single list the app, the AI-policy
 * admin screen and the marketing site read from.
 *
 * Autonomy ladder (an organization picks a level per capability, up to `maxAutonomy`):
 *   off      the capability doesn't run
 *   suggest  AI shows a recommendation inside the app; nothing is created
 *   draft    AI prepares something (a reply, a work order, a price draft); a person sends or saves it
 *   approve  AI acts after a person approves each item
 *   auto     AI acts on its own within configured limits; every action is logged and reversible
 *
 * Hard rules, enforced by `assertCatalogueSafe` and the tests:
 *   - Anything that can lead to a consequential permission (holds, prices, payment plans, leases,
 *     spend, commissions) is never above `draft`: the binding step stays a human approval.
 *   - Talking to customers (messages, calls) needs disclosure that it's an AI, consent where the
 *     market requires it, quiet hours and opt-out handling.
 *   - The AI only reads what the acting user may read (it runs as `ai_assistant`, read-only, see access.ts).
 */
export const AUTONOMY_LEVELS = ["off", "suggest", "draft", "approve", "auto"] as const;
export type Autonomy = (typeof AUTONOMY_LEVELS)[number];

export type AiDependency = "ai_provider" | "whatsapp" | "sms" | "email" | "telephony" | "document_storage" | "maps_places" | "ad_channels" | "web_chat";

export type AiGuardrail =
  | "discloses_ai" // says it's an AI assistant at the start of every conversation or call
  | "recording_consent" // asks before recording or transcribing a call
  | "quiet_hours" // no outbound contact outside the market's configured hours
  | "opt_out" // honours stop/unsubscribe and do-not-contact lists
  | "human_handoff" // a person can take over at any point; some topics always hand off
  | "approved_data_only" // quotes only published inventory, approved prices and plans
  | "no_legal_or_financial_advice" // explains recorded facts, never gives advice
  | "explainable" // shows why (signals and weights), staff can override with a reason
  | "estimate_labelled" // forecasts are marked as estimates with their basis
  | "staff_verifies" // extracted data is checked by a person before it's saved
  | "budget_capped"; // per-organization usage limits

export type AiCategory = "conversations" | "voice" | "leads" | "automation" | "inventory" | "property_management" | "insights" | "website";

export type AiCapability = {
  id: string;
  category: AiCategory;
  workspaces: readonly (WorkspaceId | "website")[];
  /** Highest level an organization may choose. */
  maxAutonomy: Autonomy;
  /** Level a new organization starts at. */
  defaultAutonomy: Autonomy;
  /** Binding actions this capability can lead to. These always end in a human approval. */
  leadsTo: readonly Permission[];
  needs: readonly AiDependency[];
  /** Whether it talks to people outside the organization: replying to them, or reaching out first. */
  contacts?: "inbound" | "outbound";
  guardrails: readonly AiGuardrail[];
  /** Roadmap milestone (docs/roadmap.md). */
  milestone: number;
};

const cap = (c: AiCapability) => c;

export const AI_CAPABILITIES = [
  // ---------------------------------------------------------------- conversations
  cap({ id: "instant_reply", contacts: "inbound", category: "conversations", workspaces: ["developer", "brokerage", "management"], maxAutonomy: "auto", defaultAutonomy: "draft",
    leadsTo: [], needs: ["ai_provider", "whatsapp", "web_chat", "sms", "email"], guardrails: ["discloses_ai", "approved_data_only", "quiet_hours", "opt_out", "human_handoff"], milestone: 10 }),
  cap({ id: "multilingual_translation", category: "conversations", workspaces: ["developer", "brokerage", "management", "personal"], maxAutonomy: "auto", defaultAutonomy: "auto",
    leadsTo: [], needs: ["ai_provider"], guardrails: ["human_handoff"], milestone: 7 }),
  cap({ id: "voice_note_transcription", category: "conversations", workspaces: ["developer", "brokerage", "management"], maxAutonomy: "auto", defaultAutonomy: "auto",
    leadsTo: [], needs: ["ai_provider", "whatsapp"], guardrails: ["staff_verifies"], milestone: 8 }),
  cap({ id: "conversation_summary", category: "conversations", workspaces: ["developer", "brokerage", "management"], maxAutonomy: "auto", defaultAutonomy: "auto",
    leadsTo: [], needs: ["ai_provider"], guardrails: [], milestone: 7 }),
  cap({ id: "follow_up_sequences", contacts: "outbound", category: "conversations", workspaces: ["developer", "brokerage"], maxAutonomy: "auto", defaultAutonomy: "approve",
    leadsTo: [], needs: ["ai_provider", "whatsapp", "sms", "email"], guardrails: ["discloses_ai", "quiet_hours", "opt_out", "human_handoff", "approved_data_only"], milestone: 10 }),

  // ---------------------------------------------------------------- voice
  cap({ id: "ai_voice_agent", contacts: "outbound", category: "voice", workspaces: ["developer", "brokerage", "management"], maxAutonomy: "auto", defaultAutonomy: "approve",
    leadsTo: [], needs: ["ai_provider", "telephony"], guardrails: ["discloses_ai", "recording_consent", "quiet_hours", "opt_out", "human_handoff", "approved_data_only", "no_legal_or_financial_advice"], milestone: 10 }),
  cap({ id: "live_call_assist", category: "voice", workspaces: ["developer", "brokerage", "management"], maxAutonomy: "suggest", defaultAutonomy: "suggest",
    leadsTo: [], needs: ["ai_provider", "telephony"], guardrails: ["recording_consent"], milestone: 10 }),
  cap({ id: "call_summary", category: "voice", workspaces: ["developer", "brokerage", "management"], maxAutonomy: "auto", defaultAutonomy: "auto",
    leadsTo: [], needs: ["ai_provider", "telephony"], guardrails: ["recording_consent", "staff_verifies"], milestone: 10 }),

  // ---------------------------------------------------------------- leads
  cap({ id: "intent_extraction", category: "leads", workspaces: ["developer", "brokerage"], maxAutonomy: "auto", defaultAutonomy: "auto",
    leadsTo: [], needs: ["ai_provider"], guardrails: ["explainable", "staff_verifies"], milestone: 9 }),
  cap({ id: "lead_scoring", category: "leads", workspaces: ["developer", "brokerage"], maxAutonomy: "auto", defaultAutonomy: "auto",
    leadsTo: [], needs: [], guardrails: ["explainable"], milestone: 9 }),
  cap({ id: "property_matching", category: "leads", workspaces: ["developer", "brokerage", "personal"], maxAutonomy: "auto", defaultAutonomy: "suggest",
    leadsTo: [], needs: [], guardrails: ["approved_data_only", "explainable"], milestone: 9 }),
  cap({ id: "next_best_action", category: "leads", workspaces: ["developer", "brokerage"], maxAutonomy: "suggest", defaultAutonomy: "suggest",
    leadsTo: [], needs: ["ai_provider"], guardrails: ["explainable"], milestone: 9 }),
  cap({ id: "vip_routing", category: "leads", workspaces: ["developer", "brokerage"], maxAutonomy: "auto", defaultAutonomy: "approve",
    leadsTo: [], needs: [], guardrails: ["explainable", "human_handoff"], milestone: 9 }),
  cap({ id: "launch_surge_triage", category: "leads", workspaces: ["developer"], maxAutonomy: "auto", defaultAutonomy: "approve",
    leadsTo: [], needs: ["ai_provider"], guardrails: ["explainable", "human_handoff", "budget_capped"], milestone: 9 }),
  cap({ id: "viewing_scheduler", contacts: "outbound", category: "leads", workspaces: ["developer", "brokerage", "management"], maxAutonomy: "approve", defaultAutonomy: "draft",
    leadsTo: [], needs: ["ai_provider"], guardrails: ["discloses_ai", "quiet_hours", "opt_out", "human_handoff"], milestone: 9 }),
  // Can prepare a unit-hold request; the hold itself is always a person's decision.
  cap({ id: "unit_hold_drafts", category: "leads", workspaces: ["developer", "brokerage"], maxAutonomy: "draft", defaultAutonomy: "draft",
    leadsTo: ["unit.hold.request"], needs: [], guardrails: ["approved_data_only"], milestone: 9 }),
  cap({ id: "client_registration_assistant", category: "leads", workspaces: ["brokerage"], maxAutonomy: "draft", defaultAutonomy: "draft",
    leadsTo: [], needs: [], guardrails: ["staff_verifies"], milestone: 9 }),

  // ---------------------------------------------------------------- automation
  cap({ id: "workflow_automations", category: "automation", workspaces: ["admin", "developer", "brokerage", "management"], maxAutonomy: "auto", defaultAutonomy: "approve",
    leadsTo: [], needs: [], guardrails: ["budget_capped", "human_handoff"], milestone: 7 }),
  cap({ id: "workspace_copilot", category: "automation", workspaces: ["admin", "developer", "brokerage", "management"], maxAutonomy: "suggest", defaultAutonomy: "suggest",
    leadsTo: [], needs: ["ai_provider"], guardrails: ["explainable", "budget_capped"], milestone: 7 }),
  cap({ id: "document_checklists", contacts: "outbound", category: "automation", workspaces: ["developer", "brokerage"], maxAutonomy: "auto", defaultAutonomy: "draft",
    leadsTo: [], needs: ["ai_provider"], guardrails: ["discloses_ai", "no_legal_or_financial_advice", "quiet_hours", "opt_out", "human_handoff"], milestone: 9 }),

  // ---------------------------------------------------------------- developer inventory
  cap({ id: "listing_copywriter", category: "inventory", workspaces: ["developer"], maxAutonomy: "draft", defaultAutonomy: "draft",
    leadsTo: [], needs: ["ai_provider"], guardrails: ["approved_data_only", "staff_verifies"], milestone: 7 }),
  cap({ id: "import_mapping_assistant", category: "inventory", workspaces: ["developer"], maxAutonomy: "draft", defaultAutonomy: "draft",
    leadsTo: [], needs: ["ai_provider"], guardrails: ["staff_verifies"], milestone: 8 }),
  // Suggests a price draft from stored demand signals; publishing still needs the two-person approval.
  cap({ id: "pricing_suggestions", category: "inventory", workspaces: ["developer"], maxAutonomy: "draft", defaultAutonomy: "suggest",
    leadsTo: ["price.change.request"], needs: ["ai_provider"], guardrails: ["explainable", "estimate_labelled"], milestone: 9 }),
  cap({ id: "payment_plan_explainer", contacts: "inbound", category: "inventory", workspaces: ["developer", "brokerage", "personal"], maxAutonomy: "auto", defaultAutonomy: "draft",
    leadsTo: [], needs: ["ai_provider"], guardrails: ["discloses_ai", "approved_data_only", "no_legal_or_financial_advice", "human_handoff"], milestone: 7 }),

  // ---------------------------------------------------------------- property management
  cap({ id: "request_triage", category: "property_management", workspaces: ["management"], maxAutonomy: "auto", defaultAutonomy: "suggest",
    leadsTo: [], needs: ["ai_provider"], guardrails: ["explainable", "human_handoff"], milestone: 7 }),
  cap({ id: "tenant_assistant", contacts: "inbound", category: "property_management", workspaces: ["management", "personal"], maxAutonomy: "auto", defaultAutonomy: "draft",
    leadsTo: [], needs: ["ai_provider", "whatsapp", "web_chat"], guardrails: ["discloses_ai", "approved_data_only", "quiet_hours", "opt_out", "human_handoff", "no_legal_or_financial_advice"], milestone: 10 }),
  cap({ id: "work_order_drafts", category: "property_management", workspaces: ["management"], maxAutonomy: "draft", defaultAutonomy: "draft",
    leadsTo: [], needs: ["ai_provider"], guardrails: ["staff_verifies"], milestone: 7 }),
  cap({ id: "preventive_maintenance_planner", category: "property_management", workspaces: ["management"], maxAutonomy: "draft", defaultAutonomy: "suggest",
    leadsTo: [], needs: ["ai_provider"], guardrails: ["estimate_labelled", "staff_verifies"], milestone: 7 }),
  // Summarizes vendor quotes; choosing and approving spend is always a person.
  cap({ id: "vendor_quote_comparison", category: "property_management", workspaces: ["management"], maxAutonomy: "suggest", defaultAutonomy: "suggest",
    leadsTo: ["maintenance.spend.approve"], needs: ["ai_provider", "document_storage"], guardrails: ["explainable"], milestone: 8 }),
  cap({ id: "renewal_assistant", category: "property_management", workspaces: ["management"], maxAutonomy: "draft", defaultAutonomy: "draft",
    leadsTo: ["lease.sign.request"], needs: ["ai_provider"], guardrails: ["no_legal_or_financial_advice", "approved_data_only"], milestone: 7 }),
  cap({ id: "lease_abstraction", category: "property_management", workspaces: ["management"], maxAutonomy: "draft", defaultAutonomy: "draft",
    leadsTo: [], needs: ["ai_provider", "document_storage"], guardrails: ["staff_verifies"], milestone: 8 }),
  cap({ id: "rent_reminders", contacts: "outbound", category: "property_management", workspaces: ["management"], maxAutonomy: "approve", defaultAutonomy: "draft",
    leadsTo: [], needs: ["ai_provider", "whatsapp", "sms", "email"], guardrails: ["discloses_ai", "quiet_hours", "opt_out", "human_handoff", "no_legal_or_financial_advice"], milestone: 10 }),
  cap({ id: "inspection_reports", category: "property_management", workspaces: ["management"], maxAutonomy: "draft", defaultAutonomy: "draft",
    leadsTo: [], needs: ["ai_provider", "document_storage"], guardrails: ["staff_verifies"], milestone: 8 }),

  // ---------------------------------------------------------------- insights
  cap({ id: "occupancy_renewal_forecast", category: "insights", workspaces: ["management"], maxAutonomy: "suggest", defaultAutonomy: "suggest",
    leadsTo: [], needs: [], guardrails: ["estimate_labelled", "explainable"], milestone: 11 }),
  cap({ id: "demand_insights", category: "insights", workspaces: ["developer", "brokerage"], maxAutonomy: "suggest", defaultAutonomy: "suggest",
    leadsTo: [], needs: ["ai_provider"], guardrails: ["estimate_labelled", "explainable"], milestone: 11 }),
  cap({ id: "area_profile_writer", category: "insights", workspaces: ["developer"], maxAutonomy: "draft", defaultAutonomy: "draft",
    leadsTo: [], needs: ["ai_provider", "maps_places"], guardrails: ["approved_data_only", "staff_verifies"], milestone: 9 }),
  cap({ id: "channel_attribution", category: "insights", workspaces: ["developer", "brokerage"], maxAutonomy: "suggest", defaultAutonomy: "suggest",
    leadsTo: [], needs: ["ad_channels"], guardrails: ["explainable"], milestone: 11 }),

  // ---------------------------------------------------------------- website
  cap({ id: "website_concierge", contacts: "inbound", category: "website", workspaces: ["website"], maxAutonomy: "auto", defaultAutonomy: "auto",
    leadsTo: [], needs: ["ai_provider", "web_chat"], guardrails: ["discloses_ai", "human_handoff", "budget_capped", "no_legal_or_financial_advice"], milestone: 7 }),
  cap({ id: "home_search_assistant", contacts: "inbound", category: "website", workspaces: ["website", "personal"], maxAutonomy: "auto", defaultAutonomy: "auto",
    leadsTo: [], needs: ["ai_provider"], guardrails: ["discloses_ai", "approved_data_only", "human_handoff", "budget_capped"], milestone: 11 }),
] as const satisfies readonly AiCapability[];

export type AiCapabilityId = (typeof AI_CAPABILITIES)[number]["id"];

const rank = (a: Autonomy) => AUTONOMY_LEVELS.indexOf(a);

/** Throws if any catalogue entry breaks the hard rules. Called by tests and at policy-save time. */
export function assertCatalogueSafe(list: readonly AiCapability[] = AI_CAPABILITIES): void {
  const need = (c: AiCapability, g: AiGuardrail) => {
    if (!c.guardrails.includes(g)) throw new Error(`${c.id}: missing guardrail ${g}`);
  };
  for (const c of list) {
    if (rank(c.defaultAutonomy) > rank(c.maxAutonomy)) throw new Error(`${c.id}: default above max`);
    // Anything that can lead to a binding action stops at a draft: a person makes the decision.
    const binding = c.leadsTo.some((p) => PERMISSIONS[p].effect === "consequential");
    if (binding && rank(c.maxAutonomy) > rank("draft")) throw new Error(`${c.id}: leads to a binding action but allows ${c.maxAutonomy}`);
    // Talking to people: always say it's an AI and let a person take over.
    if (c.contacts) {
      need(c, "discloses_ai");
      need(c, "human_handoff");
    }
    // Reaching out first: respect quiet hours and opt-outs.
    if (c.contacts === "outbound") {
      need(c, "quiet_hours");
      need(c, "opt_out");
    }
    if (c.needs.includes("telephony") && c.contacts) need(c, "recording_consent");
  }
}

/** Clamp an organization's requested level to what the capability allows. */
export function effectiveAutonomy(id: AiCapabilityId, requested: Autonomy): Autonomy {
  const c = AI_CAPABILITIES.find((x) => x.id === id);
  if (!c) return "off";
  return rank(requested) > rank(c.maxAutonomy) ? c.maxAutonomy : requested;
}
