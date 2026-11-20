import { withAppTx, type Db } from "@baytline/db";
import { IdentityError, writeAudit, type Actor } from "@baytline/identity";
import { requirePlatform } from "../guard";
import { PROVIDERS, providerByKey, type IntegrationKind } from "./catalog";
import { deriveStatus, type IntegrationStatus } from "./status";

/** Everything the browser receives about an integration. No secret values, ever. */
export type IntegrationView = {
  key: string;
  kind: IntegrationKind;
  milestone: number;
  status: IntegrationStatus;
  enabled: boolean;
  adapterAvailable: boolean;
  required: boolean;
  canCheck: boolean;
  secrets: { name: string; present: boolean }[];
  lastCheck: { ok: boolean; at: Date; summary: string; latencyMs: number | null; byName: string | null } | null;
  notes: string | null;
  updatedAt: Date | null;
  updatedByName: string | null;
};

export async function getIntegrationRegistry(db: Db, actor: Actor, env: NodeJS.ProcessEnv = process.env, now = new Date()): Promise<IntegrationView[]> {
  return withAppTx(db, actor, async (c) => {
    await requirePlatform(c, actor, "platform.integrations.view");
    const { rows: settings } = await c.query(
      "select s.provider_key, s.enabled, s.notes, s.updated_at, u.display_name from app.integration_settings s left join app.users u on u.id = s.updated_by",
    );
    const { rows: checks } = await c.query(
      `select distinct on (k.provider_key) k.provider_key, k.ok, k.checked_at, k.summary, k.latency_ms, u.display_name
         from app.integration_checks k left join app.users u on u.id = k.checked_by
        order by k.provider_key, k.checked_at desc`,
    );
    return PROVIDERS.map((p) => {
      const s = settings.find((r) => r.provider_key === p.key);
      const k = checks.find((r) => r.provider_key === p.key);
      // Presence only. The value itself is never read into a variable that leaves this function.
      const secrets = p.secrets.map((name) => ({ name, present: typeof env[name] === "string" && env[name] !== "" }));
      const enabled = p.required ? true : s ? s.enabled : true;
      const lastCheck = k ? { ok: k.ok, at: k.checked_at, summary: k.summary, latencyMs: k.latency_ms, byName: k.display_name } : null;
      const developmentOnly = p.developmentOnly?.(env) ?? false;
      const status = deriveStatus(
        { adapterAvailable: p.adapterAvailable, enabled, developmentOnly, missingSecrets: secrets.filter((x) => !x.present).length, lastCheck },
        now,
      );
      return {
        key: p.key,
        kind: p.kind,
        milestone: p.milestone,
        status,
        enabled,
        adapterAvailable: p.adapterAvailable,
        required: Boolean(p.required),
        canCheck: Boolean(p.check) && enabled && secrets.every((x) => x.present),
        secrets,
        lastCheck,
        notes: s?.notes ?? null,
        updatedAt: s?.updated_at ?? null,
        updatedByName: s?.display_name ?? null,
      };
    });
  });
}

/** Runs the provider's real connection test and records the outcome. */
export async function runIntegrationCheck(db: Db, actor: Actor, key: string, env: NodeJS.ProcessEnv = process.env): Promise<{ ok: boolean; summary: string }> {
  const p = providerByKey(key);
  if (!p) throw new IdentityError("not_found");
  // Permission first, in its own transaction, so a slow external check never holds a DB transaction open.
  await withAppTx(db, actor, (c) => requirePlatform(c, actor, "platform.integrations.manage"));
  if (!p.check) throw new IdentityError("invalid_input", "no_check_available");
  if (p.secrets.some((n) => !env[n])) throw new IdentityError("invalid_input", "not_configured");

  const result = await p.check({ db }).catch(() => ({ ok: false, latencyMs: 0, summary: "Check failed unexpectedly." }));
  await withAppTx(db, actor, async (c) => {
    // Re-check: permission could have been revoked while the external call ran.
    await requirePlatform(c, actor, "platform.integrations.manage");
    await c.query("insert into app.integration_checks (provider_key, checked_by, ok, latency_ms, summary) values ($1, $2, $3, $4, $5)", [
      key,
      actor.userId,
      result.ok,
      result.latencyMs,
      result.summary.slice(0, 200),
    ]);
    await writeAudit(c, {
      type: "integration.checked",
      outcome: result.ok ? "success" : "failure",
      actorUserId: actor.userId,
      orgId: actor.orgId,
      target: { type: "integration", id: key },
    });
  });
  return { ok: result.ok, summary: result.summary };
}

export async function setIntegrationEnabled(db: Db, actor: Actor, key: string, enabled: boolean, notes?: unknown): Promise<void> {
  const p = providerByKey(key);
  if (!p) throw new IdentityError("not_found");
  const note = typeof notes === "string" ? notes.trim().slice(0, 500) || null : null;
  await withAppTx(db, actor, async (c) => {
    await requirePlatform(c, actor, "platform.integrations.manage");
    // After the permission check, so people without access learn nothing about the provider.
    if (p.required) throw new IdentityError("invalid_input", "required_integration");
    await c.query(
      `insert into app.integration_settings (provider_key, enabled, notes, updated_at, updated_by) values ($1, $2, $3, now(), $4)
       on conflict (provider_key) do update set enabled = excluded.enabled, notes = coalesce(excluded.notes, app.integration_settings.notes),
         updated_at = now(), updated_by = excluded.updated_by`,
      [key, enabled, note, actor.userId],
    );
    await writeAudit(c, {
      type: enabled ? "integration.enabled" : "integration.disabled",
      outcome: "success",
      actorUserId: actor.userId,
      orgId: actor.orgId,
      target: { type: "integration", id: key },
    });
  });
}
