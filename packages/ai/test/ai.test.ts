import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withAppTx, type Db } from "@baytline/db";
import { createOrganization, IdentityError, inviteMember, signUpFromInvitation } from "@baytline/identity";
import { ROLE_GRANTS } from "@baytline/core";
import { createBootstrapInvitation } from "../../identity/src/bootstrap";
import {
  AiBlockedError,
  costMicro,
  getOrgAiPolicy,
  getPlatformAi,
  listAiRequests,
  prepareGrounding,
  previewAi,
  ProviderError,
  redact,
  runAi,
  saveOrgAiPolicy,
  savePlatformAi,
  setOrgAiBlocked,
  type AiProvider,
  type AiTask,
  type GroundedFact,
  type ProviderRequest,
} from "../src";

let db: Db;
const PW = "a long test passphrase";
type A = { userId: string; orgId: string };
const u = {} as Record<"ops" | "support" | "admin" | "inv" | "other" | "brk", A>;
const ENV = { AI_PROVIDER_API_KEY: "test-key-not-real" };

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof IdentityError ? `${e.code}${e.detail ? `:${e.detail}` : ""}` : `other:${(e as Error).message}`;
  }
};
const raw = <T = Record<string, any>>(a: A, sql: string, args: unknown[] = []) =>
  withAppTx(db, { userId: a.userId, orgId: a.orgId }, async (c) => (await c.query(sql, args)).rows as T[]);
async function join(token: string, name: string, orgId: string): Promise<A> {
  return { userId: (await signUpFromInvitation(db, { token, password: PW, displayName: name, locale: "en" })).userId, orgId };
}

/** A provider that records what it was sent and answers with a fixed text. Nothing leaves the test. */
class FakeProvider implements AiProvider {
  readonly name = "fake";
  sent: ProviderRequest[] = [];
  constructor(private reply: string | (() => never) = "Draft listing text [1].", private stop = "end_turn") {}
  async complete(req: ProviderRequest) {
    this.sent.push(req);
    if (typeof this.reply === "function") this.reply();
    return { text: this.reply as string, stopReason: this.stop, servedModel: req.model, latencyMs: 12,
      usage: [{ model: req.model, input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 }] };
  }
  async check() { return { ok: true, summary: "fake" }; }
}

const FACTS: GroundedFact[] = [
  { kind: "unit", ref: { type: "unit", id: "u1" }, text: "Unit A-101: 2 bedrooms, 118 m², floor 1.", source: { kind: "structured_import", name: "Weekly sheet" }, availability: "recently_confirmed", status: "available", confirmedAt: "2026-11-20" },
  { kind: "unit", ref: { type: "unit", id: "u2" }, text: "Unit A-102: studio.", source: { kind: "partner_portal", name: "Workspace edits" }, availability: "stale", status: "available" },
  { kind: "unit", ref: { type: "unit", id: "u3" }, text: "Unit S-1.", source: { kind: "partner_portal", name: "Workspace edits" }, availability: "unverified", isSample: true },
  { kind: "price", ref: { type: "price_version", id: "p1" }, text: "A-101 AED 1,450,000.", source: { kind: "price_list", name: "Launch v2" }, approved: false },
  { kind: "project", ref: { type: "project", id: "x" }, text: "Handover 2028.", source: null },
];

beforeAll(async () => {
  db = createDb();
  const boot = await createBootstrapInvitation(process.env.DATABASE_OWNER_URL!, { email: "ai-ops@example.test" });
  u.ops = await join(boot.token, "AI ops", boot.orgId);
  const sup = await inviteMember(db, u.ops, { email: "ai-support@example.test", role: "platform_support" });
  u.support = await join(sup.token, "AI support", boot.orgId);
  const dev = await createOrganization(db, u.ops, { type: "developer", name: "AI Dev", market: "AE", adminEmail: "ai-admin@example.test" });
  u.admin = await join(dev.token, "AI admin", dev.orgId);
  const inv = await inviteMember(db, u.admin, { email: "ai-inv@example.test", role: "developer_inventory_manager" });
  u.inv = await join(inv.token, "AI inventory", dev.orgId);
  const other = await createOrganization(db, u.ops, { type: "developer", name: "Other AI Dev", market: "AE", adminEmail: "ai-other@example.test" });
  u.other = await join(other.token, "Other", other.orgId);
  const brk = await createOrganization(db, u.ops, { type: "brokerage", name: "AI Brokerage", market: "AE", adminEmail: "ai-brk@example.test" });
  u.brk = await join(brk.token, "Brk", brk.orgId);
});
afterAll(async () => {
  await db.app.end();
  await db.auth.end();
});

describe("redaction", () => {
  it("removes contact details and identifiers, and leaves prices and unit codes", () => {
    const r = redact("Call +971 50 123 4567 or 050-123-4567, mail sara.k@example.ae. Card 4111 1111 1111 1111, IBAN AE07 0331 2345 6789 0123 456, EID 784-1990-1234567-1, iqama 2123456789. Unit A-101 is AED 1,450,000 on floor 12.");
    expect(r.text).toBe("Call [PHONE] or [PHONE], mail [EMAIL]. Card [CARD], IBAN [IBAN], EID [NATIONAL_ID], iqama [NATIONAL_ID]. Unit A-101 is AED 1,450,000 on floor 12.");
    expect(r.counts).toEqual({ phone: 2, email: 1, card: 1, iban: 1, national_id: 2 });
  });
  it("doesn't treat a number that fails the card check as a card", () => {
    expect(redact("Ref 4111 1111 1111 1112").counts.card).toBeUndefined();
  });
});

describe("grounding", () => {
  it("keeps only sourced, approved, real records and labels availability in plain words", () => {
    const g = prepareGrounding(FACTS);
    expect(g.refs.map((r) => [r.id, r.label])).toEqual([["u1", "recently_confirmed"], ["u2", "stale"]]);
    expect(g.rejected).toEqual([
      { ref: { type: "unit", id: "u3" }, reason: "sample_record" },
      { ref: { type: "price_version", id: "p1" }, reason: "not_approved" },
      { ref: { type: "project", id: "x" }, reason: "no_source" },
    ]);
    expect(g.block).toContain("[1] (unit; source: Weekly sheet) Unit A-101");
    expect(g.block).toContain("confirmed available by the owner recently");
    expect(g.block).toContain("STALE: last confirmation is too old; do not say it is available");
  });
});

describe("pricing", () => {
  it("prices each attempt at the model that ran it, rounding up", () => {
    expect(costMicro([{ model: "claude-opus-5-5", input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 }])).toBe(14000); // $0.014
    expect(costMicro([{ model: "claude-haiku-5-5", input: 3, output: 0, cacheRead: 0, cacheWrite: 0 }])).toBe(1);
  });
  it("only organization admins hold the AI policy permission, matching the database roles", () => {
    const holders = Object.entries(ROLE_GRANTS).filter(([, g]) => g.some(([p]) => p === "ai_policy.manage")).map(([r]) => r).sort();
    expect(holders).toEqual(["brokerage_admin", "developer_admin", "pm_admin"]);
  });
});

describe("policies", () => {
  it("starts with AI off everywhere", async () => {
    const v = await getOrgAiPolicy(db, u.admin, ENV);
    expect(v.policy).toMatchObject({ enabled: false, monthlyBudgetMicro: 0, autonomy: {} });
    expect(v.platform.enabled).toBe(false);
    expect(v.blockers).toEqual(["platform_disabled", "org_disabled"]);
    expect(v.capabilities.every((c) => c.level === "off")).toBe(true);
    expect(v.capabilities.find((c) => c.id === "instant_reply")!.missing).toEqual(["whatsapp", "web_chat", "sms", "email"]);
  });

  it("lets only the right people change policies", async () => {
    expect(await code(getOrgAiPolicy(db, u.inv))).toBe("forbidden:ai_policy.manage");
    expect(await code(saveOrgAiPolicy(db, u.inv, { enabled: true, allowedModels: [], defaultModel: "", monthlyBudgetUsd: "1", maxOutputTokens: "", storeText: "on", autonomy: {} }))).toBe("forbidden:ai_policy.manage");
    expect(await code(raw(u.inv, "update app.ai_org_policies set enabled = true"))).toBe("ok"); // RLS: matches no rows
    expect(await raw(u.inv, "select enabled from app.ai_org_policies")).toEqual([]);
    expect(await code(savePlatformAi(db, u.admin, { enabled: true, allowedModels: ["claude-opus-5-5"], defaultModel: "claude-opus-5-5", orgBudgetCeilingUsd: "50", platformMonthlyCapUsd: "500", maxOutputTokensCeiling: "16000", logRetentionDays: "90" }))).toBe("forbidden:platform.ai_policy.manage");
    expect(await code(savePlatformAi(db, u.support, { enabled: true, allowedModels: ["claude-opus-5-5"], defaultModel: "claude-opus-5-5", orgBudgetCeilingUsd: "50", platformMonthlyCapUsd: "500", maxOutputTokensCeiling: "16000", logRetentionDays: "90" }))).toBe("forbidden:platform.ai_policy.manage");
  });

  it("validates the organization policy against the platform and the catalogue", async () => {
    const base = { enabled: "on", allowedModels: ["claude-opus-5-5", "claude-haiku-5-5"], defaultModel: "claude-opus-5-5", monthlyBudgetUsd: "20", maxOutputTokens: "1500", storeText: "on", autonomy: { listing_copywriter: "draft" } };
    expect(await code(saveOrgAiPolicy(db, u.admin, { ...base, allowedModels: ["gpt-x"] }))).toBe("invalid_input:models");
    expect(await code(saveOrgAiPolicy(db, u.admin, { ...base, monthlyBudgetUsd: "51" }))).toBe("invalid_input:budget_over_ceiling");
    expect(await code(saveOrgAiPolicy(db, u.admin, { ...base, monthlyBudgetUsd: "0" }))).toBe("invalid_input:enable_needs_model_and_budget");
    expect(await code(saveOrgAiPolicy(db, u.admin, { ...base, autonomy: { listing_copywriter: "auto" } }))).toBe("invalid_input:autonomy_over_max");
    // Binding actions stop at draft: pricing suggestions can't approve or act.
    expect(await code(saveOrgAiPolicy(db, u.admin, { ...base, autonomy: { pricing_suggestions: "approve" } }))).toBe("invalid_input:autonomy_over_max");
    expect(await code(saveOrgAiPolicy(db, u.admin, { ...base, autonomy: { tenant_assistant: "suggest" } }))).toBe("invalid_input:capability"); // not a developer capability
    expect(await saveOrgAiPolicy(db, u.admin, base)).toEqual(expect.arrayContaining(["enabled", "monthlyBudgetMicro", "autonomy"]));
    const v = await getOrgAiPolicy(db, u.admin, ENV);
    expect(v.policy).toMatchObject({ enabled: true, monthlyBudgetMicro: 20_000_000, maxOutputTokens: 1500, autonomy: { listing_copywriter: "draft" } });
    expect(v.blockers).toEqual(["platform_disabled"]);
    const audit = await raw(u.admin, "select metadata from app.audit_events where event_type = 'ai_policy.updated' order by occurred_at desc limit 1");
    expect(audit[0]!.metadata).toMatchObject({ enabled: "true", budget_usd: "20" });
  });
});

describe("gateway", () => {
  it("blocks, in order, and logs why, without calling the provider", async () => {
    const p = new FakeProvider();
    const task: AiTask = { capability: "listing_copywriter", instruction: "Write a short listing for A-101.", facts: FACTS };
    const blocked = async (a: A, t = task, provider: AiProvider | null = p) => {
      try { await runAi(db, a, t, { provider }); return "ran"; } catch (e) { return e instanceof AiBlockedError ? e.reason : `other:${(e as Error).message}`; }
    };
    expect(await blocked(u.inv)).toBe("platform_disabled");
    await savePlatformAi(db, u.ops, { enabled: "on", allowedModels: ["claude-opus-5-5", "claude-haiku-5-5"], defaultModel: "claude-opus-5-5", orgBudgetCeilingUsd: "50", platformMonthlyCapUsd: "500", maxOutputTokensCeiling: "16000", logRetentionDays: "90" });
    expect(await blocked(u.inv, task, null)).toBe("provider_not_configured");
    expect(await blocked(u.other)).toBe("org_disabled");
    expect(await blocked(u.inv, { ...task, capability: "conversation_summary" })).toBe("capability_off");
    expect(await blocked(u.inv, { ...task, capability: "tenant_assistant" })).toBe("capability_not_for_workspace");
    expect(await blocked(u.inv, { ...task, capability: "made_up" })).toBe("unknown_capability");
    expect(await blocked(u.inv, { ...task, model: "claude-sonnet-5-5" })).toBe("model_not_allowed");
    await saveOrgAiPolicy(db, u.admin, { enabled: "on", allowedModels: ["claude-opus-5-5", "claude-haiku-5-5"], defaultModel: "claude-opus-5-5", monthlyBudgetUsd: "20", maxOutputTokens: "1500", storeText: "on", autonomy: { listing_copywriter: "draft", instant_reply: "draft" } });
    expect(await blocked(u.inv, { ...task, capability: "instant_reply" })).toBe("dependency_unavailable");
    expect(p.sent).toEqual([]);
    const log = await listAiRequests(db, u.admin, { status: "blocked" });
    expect(log.map((r) => r.blockReason)).toEqual(expect.arrayContaining(["platform_disabled", "provider_not_configured", "capability_off", "dependency_unavailable"]));
    expect(log.every((r) => r.prompt === null && r.costMicro === 0)).toBe(true);
  });

  it("sends only redacted, grounded data, records the exact cost and returns a draft for review", async () => {
    const p = new FakeProvider("Bright 2-bed A-101 [1]. Call [PHONE].");
    const r = await runAi(db, u.inv, { capability: "listing_copywriter", instruction: "Write a listing for A-101. Owner contact: +971 50 123 4567, owner@example.ae.", facts: FACTS }, { provider: p });
    expect(r).toMatchObject({ status: "succeeded", autonomy: "draft", requiresReview: true, model: "claude-opus-5-5", costMicro: 14000, redactions: { phone: 1, email: 1 } });
    expect(r.grounding.map((g) => g.id)).toEqual(["u1", "u2"]);
    expect(r.rejected).toHaveLength(3);
    const sent = p.sent[0]!;
    expect(sent.prompt).not.toMatch(/971|owner@example/);
    expect(sent.prompt).toContain("[PHONE]");
    expect(sent.prompt).not.toContain("Unit S-1"); // sample record never reaches the model
    expect(sent.prompt).not.toContain("1,450,000"); // unapproved price never reaches the model
    expect(sent.system).toContain("Only describe a unit as available when its availability line says it was confirmed available");
    expect(sent.maxTokens).toBe(1500);
    const [row] = await listAiRequests(db, u.admin, { status: "succeeded" });
    expect(row).toMatchObject({ capability: "listing_copywriter", userName: "AI inventory", costMicro: 14000, inputTokens: 1000, outputTokens: 500, rejectedFacts: 3 });
    expect(row!.prompt).toContain("[EMAIL]");
    expect(row!.response).toBe("Bright 2-bed A-101 [1]. Call [PHONE].");
    // The request row can't be rewritten afterwards, even by the person who made it.
    expect(await code(raw(u.inv, "update app.ai_requests set cost_micro = 0 where id = $1", [r.requestId]))).toBe("ok"); // RLS: no longer 'reserved', matches nothing
    expect((await listAiRequests(db, u.admin, { status: "succeeded" }))[0]!.costMicro).toBe(14000);
    expect(await code(raw(u.admin, "delete from app.ai_requests"))).toMatch(/permission denied|append-only/);
  });

  it("keeps metadata only when the organization turns stored text off", async () => {
    await saveOrgAiPolicy(db, u.admin, { enabled: "on", allowedModels: ["claude-opus-5-5", "claude-haiku-5-5"], defaultModel: "claude-opus-5-5", monthlyBudgetUsd: "20", maxOutputTokens: "1500", storeText: "", autonomy: { listing_copywriter: "draft" } });
    const r = await runAi(db, u.inv, { capability: "listing_copywriter", instruction: "Another listing." }, { provider: new FakeProvider() });
    const row = (await listAiRequests(db, u.admin)).find((x) => x.id === r.requestId)!;
    expect([row.prompt, row.response]).toEqual([null, null]);
    expect(row.costMicro).toBe(14000);
  });

  it("enforces the monthly budget with worst-case reservations, and releases them on failure", async () => {
    // Budget $0.05; each request reserves its full output allowance (1,500 tokens x $20/M = $0.03 plus input).
    await saveOrgAiPolicy(db, u.admin, { enabled: "on", allowedModels: ["claude-opus-5-5", "claude-haiku-5-5"], defaultModel: "claude-opus-5-5", monthlyBudgetUsd: "0.10", maxOutputTokens: "1500", storeText: "on", autonomy: { listing_copywriter: "draft" } });
    const v = await getOrgAiPolicy(db, u.admin, ENV);
    expect(v.spendMtdMicro).toBe(28000); // two requests so far
    const failing = new FakeProvider(() => { throw new ProviderError("overloaded"); });
    expect(await code(runAi(db, u.inv, { capability: "listing_copywriter", instruction: "x" }, { provider: failing }))).toBe("invalid_input:ai_provider_overloaded");
    const failed = (await listAiRequests(db, u.admin, { status: "failed" }))[0]!;
    expect(failed).toMatchObject({ costMicro: 0, blockReason: "provider_overloaded" });
    expect((await getOrgAiPolicy(db, u.admin, ENV)).spendMtdMicro).toBe(28000);
    await runAi(db, u.inv, { capability: "listing_copywriter", instruction: "x" }, { provider: new FakeProvider() });
    await runAi(db, u.inv, { capability: "listing_copywriter", instruction: "x" }, { provider: new FakeProvider() });
    // 56,000 spent; the next reservation (~31,000) would pass $0.10... a cheaper model still fits, opus doesn't.
    let reason = "";
    try { await runAi(db, u.inv, { capability: "listing_copywriter", instruction: "x" }, { provider: new FakeProvider() }); await runAi(db, u.inv, { capability: "listing_copywriter", instruction: "x" }, { provider: new FakeProvider() }); }
    catch (e) { reason = (e as AiBlockedError).reason; }
    expect(reason).toBe("budget_exceeded");
    expect(await runAi(db, u.inv, { capability: "listing_copywriter", instruction: "x", model: "claude-haiku-5-5" }, { provider: new FakeProvider() })).toMatchObject({ status: "succeeded", model: "claude-haiku-5-5" });
  });

  it("reserves budget atomically: two requests at once can't both spend the last of it", async () => {
    const brkAdmin = u.brk;
    // Brokerage: budget $0.04 fits one worst-case reservation (~$0.031), not two.
    await saveOrgAiPolicy(db, brkAdmin, { enabled: "on", allowedModels: ["claude-opus-5-5"], defaultModel: "claude-opus-5-5", monthlyBudgetUsd: "0.04", maxOutputTokens: "1500", storeText: "on", autonomy: { conversation_summary: "auto" } });
    const slow: AiProvider = { name: "slow", check: async () => ({ ok: true, summary: "" }),
      complete: async (req) => { await new Promise((r) => setTimeout(r, 300)); return { text: "ok", stopReason: "end_turn", servedModel: req.model, latencyMs: 300, usage: [{ model: req.model, input: 10, output: 10, cacheRead: 0, cacheWrite: 0 }] }; } };
    const results = await Promise.allSettled([1, 2].map(() => runAi(db, brkAdmin, { capability: "conversation_summary", instruction: "Summarize." }, { provider: slow })));
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.reason).toBe("budget_exceeded");
  });

  it("records a refusal without returning text", async () => {
    await saveOrgAiPolicy(db, u.admin, { enabled: "on", allowedModels: ["claude-opus-5-5"], defaultModel: "claude-opus-5-5", monthlyBudgetUsd: "50", maxOutputTokens: "1500", storeText: "on", autonomy: { listing_copywriter: "draft" } });
    const r = await runAi(db, u.inv, { capability: "listing_copywriter", instruction: "x" }, { provider: new FakeProvider("partial", "refusal") });
    expect(r).toMatchObject({ status: "refused", text: "" });
  });

  it("previews what would be sent without calling the provider or logging", async () => {
    const before = (await listAiRequests(db, u.admin)).length;
    const p = new FakeProvider();
    expect(await code(previewAi(db, u.inv, { capability: "listing_copywriter", instruction: "x" }, { provider: p }))).toBe("forbidden:ai_policy.manage");
    const pv = await previewAi(db, u.admin, { capability: "listing_copywriter", instruction: "Mail me at a@b.co", facts: FACTS }, { provider: p });
    expect(pv).toMatchObject({ ok: true, autonomy: "draft", model: "claude-opus-5-5", redactions: { email: 1 } });
    expect(p.sent).toEqual([]);
    expect((await listAiRequests(db, u.admin)).length).toBe(before);
  });

  it("lets the platform block an organization, and see usage but never text", async () => {
    expect(await code(setOrgAiBlocked(db, u.ops, u.admin.orgId, true))).toBe("invalid_input:note_required");
    await setOrgAiBlocked(db, u.ops, u.admin.orgId, true, "Unusual usage under review");
    expect(await code(runAi(db, u.inv, { capability: "listing_copywriter", instruction: "x" }, { provider: new FakeProvider() }))).toBe("invalid_input:ai_org_blocked");
    expect(await code(saveOrgAiPolicy(db, u.admin, { enabled: "on", allowedModels: ["claude-opus-5-5"], defaultModel: "claude-opus-5-5", monthlyBudgetUsd: "5", maxOutputTokens: "", storeText: "on", autonomy: {} }))).toBe("invalid_input:org_blocked");
    const pl = await getPlatformAi(db, u.ops, ENV);
    const mine = pl.orgs.find((o) => o.orgId === u.admin.orgId)!;
    expect(mine).toMatchObject({ orgName: "AI Dev", enabled: true, platformBlocked: true });
    expect(mine.costMicro).toBeGreaterThan(0);
    expect(pl.spendMtdMicro).toBeGreaterThanOrEqual(mine.costMicro);
    expect(JSON.stringify(pl)).not.toContain("Write a listing");
    expect(await raw(u.ops, "select id from app.ai_requests")).toEqual([]); // no direct access to the log
    expect(await code(getPlatformAi(db, u.admin))).toBe("forbidden:platform.ai_policy.manage");
    await setOrgAiBlocked(db, u.ops, u.admin.orgId, false);
  });

  it("keeps organizations apart", async () => {
    // The other developer sees only its own (blocked) attempt, never this organization's requests.
    expect((await listAiRequests(db, u.other)).map((r) => [r.status, r.blockReason])).toEqual([["blocked", "org_disabled"]]);
    expect((await raw(u.other, "select org_id from app.ai_requests")).every((r) => r.org_id === u.other.orgId)).toBe(true);
    expect(await raw(u.other, "select org_id from app.ai_org_policies")).toEqual([]);
    expect(await raw(u.brk, "select app.ai_org_spend_mtd($1) as n", [u.admin.orgId])).toEqual([{ n: null }]);
  });
});
