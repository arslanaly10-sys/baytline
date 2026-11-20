import {
  AI_CAPABILITIES,
  AUTONOMY_LEVELS,
  hasCapability,
  workspaceForOrgType,
  type AiCapability,
  type AiDependency,
  type Autonomy,
  type OrgType,
} from "@baytline/core";
import { withAppTx, type Client, type Db } from "@baytline/db";
import { IdentityError, requireContext, writeAudit, type Actor, type OrgContext } from "@baytline/identity";
import { fields } from "@baytline/identity";
import { isModelId, MODEL_IDS, type ModelId } from "./models";
import { PROVIDER_SECRET } from "./provider";

// ---------------------------------------------------------------- shared reads

export type PlatformAiSettings = {
  enabled: boolean;
  allowedModels: ModelId[];
  defaultModel: ModelId;
  orgBudgetCeilingMicro: number;
  platformMonthlyCapMicro: number;
  maxOutputTokensCeiling: number;
  logRetentionDays: number;
  updatedAt: Date;
};

export async function readPlatformSettings(c: Client): Promise<PlatformAiSettings> {
  const { rows } = await c.query("select * from app.ai_platform_settings where id");
  const r = rows[0];
  return {
    enabled: r.enabled,
    allowedModels: (r.allowed_models as string[]).filter(isModelId),
    defaultModel: r.default_model,
    orgBudgetCeilingMicro: Number(r.org_budget_ceiling_micro),
    platformMonthlyCapMicro: Number(r.platform_monthly_cap_micro),
    maxOutputTokensCeiling: r.max_output_tokens_ceiling,
    logRetentionDays: r.log_retention_days,
    updatedAt: r.updated_at,
  };
}

export type OrgAiPolicy = {
  enabled: boolean;
  allowedModels: ModelId[];
  defaultModel: ModelId | null;
  monthlyBudgetMicro: number;
  maxOutputTokens: number;
  autonomy: Record<string, Autonomy>;
  storeText: boolean;
  platformBlocked: boolean;
  platformNote: string | null;
  updatedAt: Date | null;
};

/** Defaults: everything off. An organization that never saved a policy has no AI. */
export const DEFAULT_ORG_POLICY: OrgAiPolicy = {
  enabled: false, allowedModels: [], defaultModel: null, monthlyBudgetMicro: 0, maxOutputTokens: 2000, autonomy: {},
  storeText: true, platformBlocked: false, platformNote: null, updatedAt: null,
};

export async function readOrgPolicy(c: Client, orgId: string, lock = false): Promise<OrgAiPolicy> {
  const { rows } = await c.query(`select * from app.ai_org_policies where org_id = $1 ${lock ? "for update" : ""}`, [orgId]);
  const r = rows[0];
  if (!r) return { ...DEFAULT_ORG_POLICY };
  return {
    enabled: r.enabled, allowedModels: (r.allowed_models as string[]).filter(isModelId), defaultModel: isModelId(r.default_model) ? r.default_model : null,
    monthlyBudgetMicro: Number(r.monthly_budget_micro), maxOutputTokens: r.max_output_tokens, autonomy: r.autonomy ?? {}, storeText: r.store_text,
    platformBlocked: r.platform_blocked, platformNote: r.platform_note, updatedAt: r.updated_at,
  };
}

/** Connectors the AI could depend on. None besides the AI provider has an adapter yet (milestone 11). */
export const READY_CONNECTORS: ReadonlySet<AiDependency> = new Set<AiDependency>(["ai_provider"]);

export function capabilitiesFor(orgType: OrgType): AiCapability[] {
  const ws = workspaceForOrgType(orgType).id;
  return (AI_CAPABILITIES as readonly AiCapability[]).filter((c) => (c.workspaces as readonly string[]).includes(ws));
}

const rank = (a: Autonomy) => AUTONOMY_LEVELS.indexOf(a);

/** A level the organization chose, never above what the capability allows. Unknown or missing: off. */
export function levelFor(policy: OrgAiPolicy, cap: AiCapability): Autonomy {
  const v = policy.autonomy[cap.id];
  if (!v || !(AUTONOMY_LEVELS as readonly string[]).includes(v)) return "off";
  return rank(v) > rank(cap.maxAutonomy) ? cap.maxAutonomy : v;
}

export async function orgSpendMtd(c: Client, orgId: string): Promise<number> {
  const { rows } = await c.query<{ n: string | null }>("select app.ai_org_spend_mtd($1)::text as n", [orgId]);
  return Number(rows[0]?.n ?? 0);
}

export async function providerSwitchedOn(c: Client): Promise<boolean> {
  const { rows } = await c.query<{ on: boolean }>("select app.integration_enabled('ai_gateway') as on");
  return rows[0]?.on ?? true;
}

function requireAiAdmin(ctx: OrgContext) {
  if (ctx.org.type === "platform" || ctx.org.type === "individual") throw new IdentityError("not_found");
  if (!hasCapability(ctx.principal, "ai_policy.manage")) throw new IdentityError("forbidden", "ai_policy.manage");
}

function requirePlatformAi(ctx: OrgContext) {
  if (ctx.org.type !== "platform" || !hasCapability(ctx.principal, "platform.ai_policy.manage")) throw new IdentityError("forbidden", "platform.ai_policy.manage");
}

// ---------------------------------------------------------------- organization policy screen

export type CapabilityView = {
  id: string; category: string; level: Autonomy; maxAutonomy: Autonomy; defaultAutonomy: Autonomy; levels: Autonomy[];
  guardrails: readonly string[]; needs: readonly AiDependency[]; missing: AiDependency[]; bindingSteps: readonly string[]; milestone: number;
};

export type OrgAiView = {
  orgName: string;
  policy: OrgAiPolicy;
  platform: PlatformAiSettings;
  providerConfigured: boolean;
  providerSwitchedOn: boolean;
  spendMtdMicro: number;
  capabilities: CapabilityView[];
  /** Why requests would be blocked right now, in check order; empty means requests can run (subject to each capability's level). */
  blockers: string[];
};

export async function getOrgAiPolicy(db: Db, actor: Actor, env: NodeJS.ProcessEnv = process.env): Promise<OrgAiView> {
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireContext(c, actor);
    requireAiAdmin(ctx);
    const [policy, platform, spend, on] = await Promise.all([readOrgPolicy(c, ctx.org.id), readPlatformSettings(c), orgSpendMtd(c, ctx.org.id), providerSwitchedOn(c)]);
    const providerConfigured = Boolean(env[PROVIDER_SECRET]);
    const capabilities = capabilitiesFor(ctx.org.type).map((cap) => ({
      id: cap.id, category: cap.category, level: levelFor(policy, cap), maxAutonomy: cap.maxAutonomy, defaultAutonomy: cap.defaultAutonomy,
      levels: AUTONOMY_LEVELS.filter((l) => rank(l) <= rank(cap.maxAutonomy)), guardrails: cap.guardrails, needs: cap.needs,
      missing: cap.needs.filter((d) => !READY_CONNECTORS.has(d)), bindingSteps: cap.leadsTo, milestone: cap.milestone,
    }));
    const blockers = [
      !platform.enabled && "platform_disabled",
      !providerConfigured && "provider_not_configured",
      !on && "provider_switched_off",
      policy.platformBlocked && "org_blocked",
      !policy.enabled && "org_disabled",
      policy.enabled && policy.monthlyBudgetMicro <= 0 && "no_budget",
      policy.enabled && spend >= policy.monthlyBudgetMicro && policy.monthlyBudgetMicro > 0 && "budget_exceeded",
    ].filter((x): x is string => Boolean(x));
    return { orgName: ctx.org.name, policy, platform, providerConfigured, providerSwitchedOn: on, spendMtdMicro: spend, capabilities, blockers };
  });
}

export type OrgPolicyInput = {
  enabled: unknown; allowedModels: unknown[]; defaultModel: unknown; monthlyBudgetUsd: unknown; maxOutputTokens: unknown;
  storeText: unknown; autonomy: Record<string, unknown>;
};

const on = (v: unknown) => v === true || v === "on" || v === "yes";

function parseUsd(v: unknown, field: string): number {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
  if (!s) return 0;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) throw new IdentityError("invalid_input", field);
  return Math.round(Number(s) * 100) * 10_000; // cents -> micro-dollars, exactly
}

/** Saves the organization's policy. Every value is checked against the platform's ceilings and the catalogue. */
export async function saveOrgAiPolicy(db: Db, actor: Actor, input: OrgPolicyInput): Promise<string[]> {
  const enabled = on(input.enabled);
  const models = [...new Set(input.allowedModels.map(String))];
  if (models.some((m) => !isModelId(m))) throw new IdentityError("invalid_input", "models");
  const defaultModel = input.defaultModel ? String(input.defaultModel) : models[0] ?? null;
  const budget = parseUsd(input.monthlyBudgetUsd, "monthly_budget");
  const maxOut = fields.optInt(input.maxOutputTokens, 256, 64000, "max_output_tokens") ?? 2000;
  const storeText = on(input.storeText);
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireContext(c, actor);
    requireAiAdmin(ctx);
    const platform = await readPlatformSettings(c);
    const before = await readOrgPolicy(c, ctx.org.id, true);
    if (models.some((m) => !platform.allowedModels.includes(m as ModelId))) throw new IdentityError("invalid_input", "models");
    if (defaultModel && !models.includes(defaultModel)) throw new IdentityError("invalid_input", "default_model");
    if (budget > platform.orgBudgetCeilingMicro) throw new IdentityError("invalid_input", "budget_over_ceiling");
    if (maxOut > platform.maxOutputTokensCeiling) throw new IdentityError("invalid_input", "max_output_tokens");
    if (enabled && before.platformBlocked) throw new IdentityError("invalid_input", "org_blocked");
    if (enabled && (!models.length || budget <= 0)) throw new IdentityError("invalid_input", "enable_needs_model_and_budget");
    const caps = capabilitiesFor(ctx.org.type);
    const autonomy: Record<string, Autonomy> = {};
    for (const [id, raw] of Object.entries(input.autonomy ?? {})) {
      const cap = caps.find((x) => x.id === id);
      if (!cap) throw new IdentityError("invalid_input", "capability");
      const level = String(raw ?? "off");
      if (!(AUTONOMY_LEVELS as readonly string[]).includes(level)) throw new IdentityError("invalid_input", "autonomy");
      // Refuse rather than clamp: the administrator should see that the level isn't allowed.
      if (rank(level as Autonomy) > rank(cap.maxAutonomy)) throw new IdentityError("invalid_input", "autonomy_over_max");
      if (level !== "off") autonomy[id] = level as Autonomy;
    }
    const next = { enabled, allowedModels: models, defaultModel, monthlyBudgetMicro: budget, maxOutputTokens: maxOut, storeText, autonomy };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(before[k]));
    if (!changed.length) return [];
    await c.query(
      `insert into app.ai_org_policies (org_id, enabled, allowed_models, default_model, monthly_budget_micro, max_output_tokens, store_text, autonomy, updated_at, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9)
       on conflict (org_id) do update set enabled = excluded.enabled, allowed_models = excluded.allowed_models, default_model = excluded.default_model,
         monthly_budget_micro = excluded.monthly_budget_micro, max_output_tokens = excluded.max_output_tokens, store_text = excluded.store_text,
         autonomy = excluded.autonomy, updated_at = now(), updated_by = excluded.updated_by`,
      [ctx.org.id, enabled, models, defaultModel, budget, maxOut, storeText, JSON.stringify(autonomy), actor.userId],
    );
    await writeAudit(c, {
      type: "ai_policy.updated", outcome: "success", actorUserId: actor.userId, orgId: ctx.org.id, target: { type: "ai_policy", id: ctx.org.id },
      metadata: { fields: changed.join(","), enabled: String(enabled), budget_usd: String(budget / 1_000_000) },
    });
    return changed;
  });
}

// ---------------------------------------------------------------- request log

export type AiRequestRow = {
  id: string; createdAt: Date; userName: string | null; capability: string; autonomy: string | null; model: string | null; servedModel: string | null;
  status: string; blockReason: string | null; costMicro: number; estimatedCostMicro: number; inputTokens: number | null; outputTokens: number | null;
  latencyMs: number | null; stopReason: string | null; prompt: string | null; response: string | null; redactions: Record<string, number>;
  grounding: { type: string; id: string; kind: string; source: string; label: string }[]; rejectedFacts: number;
};

export async function listAiRequests(db: Db, actor: Actor, f: { status?: string; capability?: string; before?: string } = {}): Promise<AiRequestRow[]> {
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireContext(c, actor);
    requireAiAdmin(ctx);
    const args: unknown[] = [ctx.org.id];
    const cond = ["r.org_id = $1"];
    if (f.status && ["reserved", "succeeded", "refused", "failed", "blocked"].includes(f.status)) cond.push(`r.status = $${args.push(f.status)}`);
    if (f.capability && /^[a-z_]{1,60}$/.test(f.capability)) cond.push(`r.capability = $${args.push(f.capability)}`);
    if (f.before && !Number.isNaN(Date.parse(f.before))) cond.push(`r.created_at < $${args.push(new Date(f.before))}`);
    const { rows } = await c.query(
      `select r.*, u.display_name from app.ai_requests r left join app.users u on u.id = r.user_id where ${cond.join(" and ")} order by r.created_at desc limit 100`,
      args,
    );
    return rows.map((r) => ({
      id: r.id, createdAt: r.created_at, userName: r.display_name, capability: r.capability, autonomy: r.autonomy, model: r.model, servedModel: r.served_model,
      status: r.status, blockReason: r.block_reason, costMicro: Number(r.cost_micro), estimatedCostMicro: Number(r.estimated_cost_micro),
      inputTokens: r.input_tokens, outputTokens: r.output_tokens, latencyMs: r.latency_ms, stopReason: r.stop_reason,
      prompt: r.prompt_redacted, response: r.response_redacted, redactions: r.redactions ?? {}, grounding: r.grounding ?? [], rejectedFacts: r.rejected_facts,
    }));
  });
}

// ---------------------------------------------------------------- platform

export async function getPlatformAi(db: Db, actor: Actor, env: NodeJS.ProcessEnv = process.env, month = new Date()) {
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireContext(c, actor);
    requirePlatformAi(ctx);
    const settings = await readPlatformSettings(c);
    const { rows } = await c.query("select * from app.ai_usage_by_org($1)", [month.toISOString().slice(0, 10)]);
    const { rows: total } = await c.query<{ n: string }>("select app.ai_platform_spend_mtd()::text as n");
    return {
      settings,
      providerConfigured: Boolean(env[PROVIDER_SECRET]),
      providerSwitchedOn: await providerSwitchedOn(c),
      spendMtdMicro: Number(total[0]?.n ?? 0),
      orgs: rows.map((r) => ({
        orgId: r.org_id as string, orgName: r.org_name as string, orgType: r.org_type as OrgType, enabled: r.enabled as boolean, platformBlocked: r.platform_blocked as boolean,
        monthlyBudgetMicro: Number(r.monthly_budget_micro), requests: Number(r.requests), blocked: Number(r.blocked), costMicro: Number(r.cost_micro),
      })),
    };
  });
}

export type PlatformInput = {
  enabled: unknown; allowedModels: unknown[]; defaultModel: unknown; orgBudgetCeilingUsd: unknown; platformMonthlyCapUsd: unknown;
  maxOutputTokensCeiling: unknown; logRetentionDays: unknown;
};

export async function savePlatformAi(db: Db, actor: Actor, input: PlatformInput): Promise<string[]> {
  const models = [...new Set(input.allowedModels.map(String))];
  if (!models.length || models.some((m) => !isModelId(m))) throw new IdentityError("invalid_input", "models");
  const def = String(input.defaultModel ?? "");
  if (!models.includes(def)) throw new IdentityError("invalid_input", "default_model");
  const ceiling = parseUsd(input.orgBudgetCeilingUsd, "org_budget_ceiling");
  const cap = parseUsd(input.platformMonthlyCapUsd, "platform_cap");
  const maxOut = fields.optInt(input.maxOutputTokensCeiling, 256, 64000, "max_output_tokens") ?? 16000;
  const retention = fields.optInt(input.logRetentionDays, 1, 730, "log_retention_days") ?? 90;
  const enabled = on(input.enabled);
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireContext(c, actor);
    requirePlatformAi(ctx);
    const before = await readPlatformSettings(c);
    await c.query(
      `update app.ai_platform_settings set enabled = $1, allowed_models = $2, default_model = $3, org_budget_ceiling_micro = $4, platform_monthly_cap_micro = $5,
              max_output_tokens_ceiling = $6, log_retention_days = $7, updated_at = now(), updated_by = $8 where id`,
      [enabled, models, def, ceiling, cap, maxOut, retention, actor.userId],
    );
    const after = await readPlatformSettings(c);
    const changed = (["enabled", "allowedModels", "defaultModel", "orgBudgetCeilingMicro", "platformMonthlyCapMicro", "maxOutputTokensCeiling", "logRetentionDays"] as const)
      .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    if (changed.length) {
      await writeAudit(c, { type: "ai_platform.updated", outcome: "success", actorUserId: actor.userId, orgId: actor.orgId, target: { type: "ai_platform", id: "settings" }, metadata: { fields: changed.join(","), enabled: String(enabled) } });
    }
    return changed;
  });
}

export async function setOrgAiBlocked(db: Db, actor: Actor, orgId: string, blocked: boolean, note?: unknown): Promise<void> {
  const oid = fields.id(orgId);
  const n = fields.opt(note, 500, "note", true);
  if (blocked && !n) throw new IdentityError("invalid_input", "note_required");
  await withAppTx(db, actor, async (c) => {
    const ctx = await requireContext(c, actor);
    requirePlatformAi(ctx);
    try {
      await c.query("savepoint s");
      await c.query("select app.set_ai_org_blocked($1, $2, $3)", [oid, blocked, n]);
    } catch (e) {
      await c.query("rollback to savepoint s");
      if ((e as { message?: string }).message === "not_found") throw new IdentityError("not_found");
      throw e;
    }
    await writeAudit(c, { type: blocked ? "ai_org.blocked" : "ai_org.unblocked", outcome: "success", actorUserId: actor.userId, orgId: actor.orgId, target: { type: "organization", id: oid } });
  });
}

export { MODEL_IDS };
