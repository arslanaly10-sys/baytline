import { AI_CAPABILITIES, hasCapability, type AiCapability, type Autonomy } from "@baytline/core";
import { withAppTx, type Client, type Db } from "@baytline/db";
import { IdentityError, requireContext, writeAudit, type Actor } from "@baytline/identity";
import { prepareGrounding, GROUNDING_RULES, type GroundedFact, type GroundingRef, type RejectedFact } from "./grounding";
import { costMicro, estimateCostMicro, isModelId, type ModelId } from "./models";
import { capabilitiesFor, levelFor, orgSpendMtd, providerSwitchedOn, readOrgPolicy, readPlatformSettings, readyDependencies } from "./policy";
import { providerFromEnv, ProviderError, type AiProvider } from "./provider";
import { redact, type Redacted } from "./redact";

/**
 * The AI gateway. Every model call in Baytline goes through `runAi`, which, in this order:
 *   1. checks the platform switch, the provider configuration, the organization's policy and block,
 *      the capability's autonomy level, its connector dependencies and the allowed models;
 *   2. keeps only approved, sourced facts and labels each one (grounding.ts);
 *   3. redacts personal data from everything it sends and stores;
 *   4. reserves the worst-case cost against the organization's monthly budget and the platform cap;
 *   5. calls the provider outside any database transaction;
 *   6. records the exact cost, tokens and the redacted response.
 * A blocked attempt is logged with its reason. The gateway never acts on anything: its output is a
 * suggestion or draft for a person, whatever the autonomy level.
 */
export type AiTask = {
  capability: string;
  /** What the person asked for, or the system task. Redacted before use. */
  instruction: string;
  /** Approved, sourced records the answer may use. Anything else is rejected. */
  facts?: readonly GroundedFact[];
  /** A model from the organization's allowed list; the organization's default otherwise. */
  model?: string;
  effort?: "low" | "medium" | "high";
};

export type GatewayDeps = { provider?: AiProvider | null; env?: NodeJS.ProcessEnv };

export type BlockReason =
  | "unknown_capability" | "capability_not_for_workspace" | "platform_disabled" | "provider_not_configured" | "provider_switched_off"
  | "org_blocked" | "org_disabled" | "capability_off" | "dependency_unavailable" | "model_not_allowed" | "empty_instruction"
  | "no_budget" | "budget_exceeded" | "platform_cap_exceeded";

/** Thrown when policy stops a request. The attempt is already in the log. */
export class AiBlockedError extends IdentityError {
  constructor(public reason: BlockReason, public requestId: string | null) {
    super("invalid_input", `ai_${reason}`);
  }
}

export type AiResult = {
  requestId: string;
  status: "succeeded" | "refused";
  text: string;
  autonomy: Autonomy;
  /** Always true in this milestone: a person reviews before anything is used. */
  requiresReview: true;
  model: ModelId;
  servedModel: string;
  costMicro: number;
  grounding: GroundingRef[];
  rejected: RejectedFact[];
  redactions: Redacted["counts"];
};

type Plan = {
  capability: AiCapability;
  autonomy: Autonomy;
  model: ModelId;
  maxTokens: number;
  system: string;
  prompt: Redacted;
  refs: GroundingRef[];
  rejected: RejectedFact[];
  estimate: number;
  storeText: boolean;
};

/** Runs every check. Returns a plan, or the first reason the request may not run. Writes nothing. */
async function plan(c: Client, actor: Actor, task: AiTask, provider: AiProvider | null): Promise<{ ok: true; plan: Plan } | { ok: false; reason: BlockReason; capability: string; autonomy: Autonomy | null; model: string | null }> {
  const ctx = await requireContext(c, actor);
  const capability = (AI_CAPABILITIES as readonly AiCapability[]).find((x) => x.id === task.capability);
  const fail = (reason: BlockReason, autonomy: Autonomy | null = null, model: string | null = null) => ({ ok: false as const, reason, capability: String(task.capability).slice(0, 60), autonomy, model });
  if (!capability) return fail("unknown_capability");
  if (!capabilitiesFor(ctx.org.type).some((x) => x.id === capability.id)) return fail("capability_not_for_workspace");
  const platform = await readPlatformSettings(c);
  // Concurrent requests for one organization reserve budget one at a time. An advisory lock, because
  // row locks would need update rights on the policy that ordinary members (rightly) don't have.
  await c.query("select pg_advisory_xact_lock(hashtextextended('ai_budget:' || $1, 0))", [ctx.org.id]);
  const policy = await readOrgPolicy(c, ctx.org.id);
  if (!platform.enabled) return fail("platform_disabled");
  if (!provider) return fail("provider_not_configured");
  if (!(await providerSwitchedOn(c))) return fail("provider_switched_off");
  if (policy.platformBlocked) return fail("org_blocked");
  if (!policy.enabled) return fail("org_disabled");
  const autonomy = levelFor(policy, capability);
  if (autonomy === "off") return fail("capability_off");
  const ready = await readyDependencies(c);
  if (capability.needs.some((d) => !ready.has(d))) return fail("dependency_unavailable", autonomy);
  const allowed = policy.allowedModels.filter((m) => platform.allowedModels.includes(m));
  const requested = task.model ?? policy.defaultModel ?? allowed[0];
  if (!isModelId(requested) || !allowed.includes(requested)) return fail("model_not_allowed", autonomy, requested ?? null);
  const model = requested;
  const instruction = typeof task.instruction === "string" ? task.instruction.trim().slice(0, 20_000) : "";
  if (!instruction) return fail("empty_instruction", autonomy, model);

  const grounding = prepareGrounding(task.facts ?? []);
  const prompt = redact(`${grounding.block}\n\n<task>\n${instruction}\n</task>`);
  const maxTokens = Math.min(policy.maxOutputTokens, platform.maxOutputTokensCeiling);
  const system = GROUNDING_RULES;
  const estimate = estimateCostMicro(model, prompt.text.length + system.length, maxTokens);
  if (policy.monthlyBudgetMicro <= 0) return fail("no_budget", autonomy, model);
  const spent = await orgSpendMtd(c, ctx.org.id);
  if (spent + estimate > policy.monthlyBudgetMicro) return fail("budget_exceeded", autonomy, model);
  const { rows } = await c.query<{ n: string }>("select app.ai_platform_spend_mtd()::text as n");
  if (Number(rows[0]?.n ?? 0) + estimate > platform.platformMonthlyCapMicro) return fail("platform_cap_exceeded", autonomy, model);
  return { ok: true, plan: { capability, autonomy, model, maxTokens, system, prompt, refs: grounding.refs, rejected: grounding.rejected, estimate, storeText: policy.storeText } };
}

export async function runAi(db: Db, actor: Actor, task: AiTask, deps: GatewayDeps = {}): Promise<AiResult> {
  const provider = deps.provider !== undefined ? deps.provider : providerFromEnv(deps.env);
  const first = await withAppTx(db, actor, async (c) => {
    const p = await plan(c, actor, task, provider);
    if (!p.ok) {
      const { rows } = await c.query<{ id: string }>(
        `insert into app.ai_requests (org_id, user_id, capability, autonomy, model, status, block_reason, finished_at)
         values (app.current_org_id(), $1, $2, $3, $4, 'blocked', $5, now()) returning id`,
        [actor.userId, p.capability, p.autonomy, p.model, p.reason],
      );
      await writeAudit(c, { type: "ai.blocked", outcome: "denied", actorUserId: actor.userId, orgId: actor.orgId, target: { type: "ai_request", id: rows[0]!.id }, metadata: { capability: p.capability, reason: p.reason } });
      return { blocked: p.reason, id: rows[0]!.id } as const;
    }
    const x = p.plan;
    const { rows } = await c.query<{ id: string }>(
      `insert into app.ai_requests (org_id, user_id, capability, autonomy, model, status, estimated_cost_micro, prompt_redacted, redactions, grounding, rejected_facts)
       values (app.current_org_id(), $1, $2, $3, $4, 'reserved', $5, $6, $7, $8, $9) returning id`,
      [actor.userId, x.capability.id, x.autonomy, x.model, x.estimate, x.storeText ? x.prompt.text : null, JSON.stringify(x.prompt.counts), JSON.stringify(x.refs), x.rejected.length],
    );
    return { plan: x, id: rows[0]!.id } as const;
  });
  if ("blocked" in first) throw new AiBlockedError(first.blocked!, first.id);

  const { plan: x, id } = first;
  let outcome: { status: "succeeded" | "refused" | "failed"; text: string; servedModel: string | null; cost: number; usage: { input: number; output: number; cacheRead: number; cacheWrite: number } | null; stop: string | null; latency: number | null; error?: ProviderError };
  try {
    const r = await provider!.complete({ model: x.model, system: x.system, prompt: x.prompt.text, maxTokens: x.maxTokens, effort: task.effort ?? "medium" });
    const sum = r.usage.reduce((s, u) => ({ input: s.input + u.input, output: s.output + u.output, cacheRead: s.cacheRead + u.cacheRead, cacheWrite: s.cacheWrite + u.cacheWrite }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    outcome = { status: r.stopReason === "refusal" ? "refused" : "succeeded", text: r.stopReason === "refusal" ? "" : r.text, servedModel: r.servedModel, cost: costMicro(r.usage), usage: sum, stop: r.stopReason, latency: r.latencyMs };
  } catch (e) {
    // Unknown usage on failure: nothing is charged against the budget, the reservation is released.
    outcome = { status: "failed", text: "", servedModel: null, cost: 0, usage: null, stop: null, latency: null, error: e instanceof ProviderError ? e : new ProviderError("unknown") };
  }
  const response = redact(outcome.text);
  await withAppTx(db, actor, async (c) => {
    await c.query(
      `update app.ai_requests set status = $2, cost_micro = $3, input_tokens = $4, output_tokens = $5, cache_read_tokens = $6, cache_write_tokens = $7,
              served_model = $8, stop_reason = $9, latency_ms = $10, response_redacted = $11, block_reason = $12,
              redactions = redactions || jsonb_build_object('response', $13::jsonb), finished_at = now()
        where id = $1`,
      [id, outcome.status, outcome.cost, outcome.usage?.input ?? null, outcome.usage?.output ?? null, outcome.usage?.cacheRead ?? null, outcome.usage?.cacheWrite ?? null,
        outcome.servedModel, outcome.stop, outcome.latency, x.storeText && outcome.text ? response.text : null, outcome.error ? `provider_${outcome.error.code}` : null,
        JSON.stringify(response.counts)],
    );
    await writeAudit(c, {
      type: "ai.requested", outcome: outcome.status === "failed" ? "failure" : "success", actorUserId: actor.userId, orgId: actor.orgId, target: { type: "ai_request", id },
      metadata: { capability: x.capability.id, model: x.model, status: outcome.status, cost_micro: String(outcome.cost) },
    });
  });
  if (outcome.error) throw new IdentityError("invalid_input", `ai_provider_${outcome.error.code}`);
  // The caller gets the model's own text; only stored copies are redacted (it may name placeholders).
  return {
    requestId: id, status: outcome.status as "succeeded" | "refused", text: outcome.text, autonomy: x.autonomy, requiresReview: true, model: x.model,
    servedModel: outcome.servedModel ?? x.model, costMicro: outcome.cost, grounding: x.refs, rejected: x.rejected, redactions: x.prompt.counts,
  };
}

export type AiPreview =
  | { ok: false; reason: BlockReason }
  | { ok: true; autonomy: Autonomy; model: ModelId; maxTokens: number; estimateMicro: number; system: string; prompt: string; redactions: Redacted["counts"]; grounding: GroundingRef[]; rejected: RejectedFact[] };

/**
 * What the gateway would do with a request, without calling the model or logging anything. For AI
 * administrators checking their policy and redaction. Nothing leaves Baytline.
 */
export async function previewAi(db: Db, actor: Actor, task: AiTask, deps: GatewayDeps = {}): Promise<AiPreview> {
  const provider = deps.provider !== undefined ? deps.provider : providerFromEnv(deps.env);
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireContext(c, actor);
    if (!hasCapability(ctx.principal, "ai_policy.manage")) throw new IdentityError("forbidden", "ai_policy.manage");
    const p = await plan(c, actor, task, provider);
    if (!p.ok) return { ok: false, reason: p.reason };
    const x = p.plan;
    return { ok: true, autonomy: x.autonomy, model: x.model, maxTokens: x.maxTokens, estimateMicro: x.estimate, system: x.system, prompt: x.prompt.text, redactions: x.prompt.counts, grounding: x.refs, rejected: x.rejected };
  });
}
