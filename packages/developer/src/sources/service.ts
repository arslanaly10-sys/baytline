import {
  ADDABLE_SOURCE_TYPES,
  NEEDS_PLATFORM_APPROVAL,
  SECRET_NAME_PATTERN,
  defaultFreshnessHours,
  deriveSourceHealth,
  type AuthorizationStatus,
  type ImportRecordType,
  type SourceHealth,
  type SourceType,
} from "@baytline/core";
import { withAppTx, type Client, type Db } from "@baytline/db";
import type { Actor } from "@baytline/identity";
import { audit, can, IdentityError, requireDeveloper } from "../guard";
import { id, oneOf, optInt, req } from "../validation";
import { adapterByKey, adaptersFor, defaultDeps, FeedError, type AdapterDeps } from "./adapters";

export type SourceView = {
  id: string;
  name: string;
  type: SourceType;
  adapterKey: string | null;
  adapterAvailable: boolean;
  partner: { id: string; name: string } | null;
  allProjects: boolean;
  projects: { id: string; name: string }[];
  authorization: AuthorizationStatus;
  authorizationRef: string | null;
  authorizedAt: Date | null;
  authorizedByName: string | null;
  decisionNote: string | null;
  decidedAt: Date | null;
  trusted: boolean;
  freshnessHours: number;
  /** Non-secret adapter settings. */
  config: Record<string, string>;
  /** Names only, with whether the server has a value. Never the value. */
  secrets: { name: string; present: boolean }[];
  health: SourceHealth;
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
  lastError: string | null;
  lastBatch: { id: string; status: string; createdAt: Date } | null;
  pendingBatches: number;
  createdAt: Date;
  createdByName: string | null;
};

const SOURCE_SELECT = `
  select s.*, po.name as partner_name, au.display_name as authorized_by_name, cu.display_name as created_by_name,
         (select ok from app.inventory_sync_runs r where r.source_id = s.id order by r.id desc limit 1) as last_attempt_ok,
         (select json_build_object('id', b.id, 'status', b.status, 'createdAt', b.created_at) from app.import_batches b
           where b.source_id = s.id order by b.created_at desc limit 1) as last_batch,
         (select count(*)::int from app.import_batches b where b.source_id = s.id and b.status in ('submitted','uploaded','validated')) as pending_batches,
         coalesce((select json_agg(json_build_object('id', p.id, 'name', p.name) order by p.name)
                     from app.inventory_source_projects sp join app.projects p on p.id = sp.project_id where sp.source_id = s.id), '[]') as projects
    from app.inventory_sources s
    left join app.brokerage_directory() po on po.id = s.partner_org_id
    left join app.users au on au.id = s.authorized_by
    left join app.users cu on cu.id = s.created_by`;

async function platformFeedsEnabled(c: Client): Promise<boolean> {
  // The platform's kill switch for every feed (Integrations → developer_feeds). Read through a definer function.
  const { rows } = await c.query<{ enabled: boolean }>("select app.feeds_enabled() as enabled");
  return rows[0]?.enabled ?? true;
}

function secretPresence(names: string[], env: NodeJS.ProcessEnv) {
  return names.map((name) => ({ name, present: typeof env[name] === "string" && env[name] !== "" }));
}

function mapSource(r: Record<string, any>, feedsOn: boolean, env: NodeJS.ProcessEnv, now: Date): SourceView {
  const adapter = adapterByKey(r.adapter_key);
  const secrets = secretPresence(r.secret_names ?? [], env);
  // Every secret a source names must be present; a slot the adapter needs must be named.
  const required = adapter?.secretSlots.filter((x) => !x.optional).length ?? 0;
  const configured = Boolean(adapter) && secrets.every((s) => s.present) && secrets.length >= required && adapter!.configFields.every((f) => !f.required || r.config?.[f.key]);
  const lastBatch = r.last_batch ? { id: r.last_batch.id, status: r.last_batch.status, createdAt: new Date(r.last_batch.createdAt) } : null;
  return {
    id: r.id,
    name: r.name,
    type: r.source_type,
    adapterKey: r.adapter_key,
    adapterAvailable: Boolean(adapter),
    partner: r.partner_org_id ? { id: r.partner_org_id, name: r.partner_name } : null,
    allProjects: r.all_projects,
    projects: r.projects,
    authorization: r.authorization_status,
    authorizationRef: r.authorization_ref,
    authorizedAt: r.authorized_at,
    authorizedByName: r.authorized_by_name,
    decisionNote: r.decision_note,
    decidedAt: r.decided_at,
    trusted: r.trusted,
    freshnessHours: r.freshness_hours,
    config: r.config ?? {},
    secrets,
    health: deriveSourceHealth(
      {
        sourceType: r.source_type, adapterAvailable: Boolean(adapter), authorization: r.authorization_status, platformEnabled: feedsOn, configured,
        lastSuccessAt: r.last_success_at, lastAttemptOk: r.last_attempt_ok, freshnessHours: r.freshness_hours,
      },
      now,
    ),
    lastSuccessAt: r.last_success_at,
    lastAttemptAt: r.last_attempt_at,
    lastError: r.last_error,
    lastBatch,
    pendingBatches: r.pending_batches,
    createdAt: r.created_at,
    createdByName: r.created_by_name,
  };
}

export async function listSources(db: Db, actor: Actor, env: NodeJS.ProcessEnv = process.env, now = new Date()): Promise<SourceView[]> {
  return withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "inventory.view");
    const feedsOn = await platformFeedsEnabled(c);
    const { rows } = await c.query(`${SOURCE_SELECT} where s.org_id = app.current_org_id()
      order by (s.source_type = 'workspace') desc, (s.authorization_status = 'revoked'), s.name`);
    return rows.map((r) => mapSource(r, feedsOn, env, now));
  });
}

export type SyncRun = { id: string; startedAt: Date; ok: boolean; rowsReceived: number | null; summary: string; batchId: string | null; runByName: string | null };

export type SourceDetail = SourceView & {
  syncRuns: SyncRun[];
  batches: { id: string; recordType: ImportRecordType; status: string; rowCount: number; createdAt: Date; createdByName: string | null; summary: Record<string, number> | null; fileName: string | null }[];
  canManage: boolean;
  canSync: boolean;
};

export async function getSource(db: Db, actor: Actor, sourceId: string, env: NodeJS.ProcessEnv = process.env, now = new Date()): Promise<SourceDetail> {
  const sid = id(sourceId);
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireDeveloper(c, actor, "inventory.view");
    const feedsOn = await platformFeedsEnabled(c);
    const { rows } = await c.query(`${SOURCE_SELECT} where s.id = $1 and s.org_id = app.current_org_id()`, [sid]);
    if (!rows[0]) throw new IdentityError("not_found");
    const view = mapSource(rows[0], feedsOn, env, now);
    const { rows: runs } = await c.query(
      `select r.id::text, r.started_at, r.ok, r.rows_received, r.summary, r.batch_id, u.display_name
         from app.inventory_sync_runs r left join app.users u on u.id = r.run_by where r.source_id = $1 order by r.id desc limit 20`,
      [sid],
    );
    const { rows: batches } = await c.query(
      `select b.id, b.record_type, b.status, b.row_count, b.created_at, b.summary, b.file_name, u.display_name
         from app.import_batches b left join app.users u on u.id = b.created_by where b.source_id = $1 order by b.created_at desc limit 30`,
      [sid],
    );
    return {
      ...view,
      syncRuns: runs.map((r) => ({ id: r.id, startedAt: r.started_at, ok: r.ok, rowsReceived: r.rows_received, summary: r.summary, batchId: r.batch_id, runByName: r.display_name })),
      batches: batches.map((b) => ({ id: b.id, recordType: b.record_type, status: b.status, rowCount: b.row_count, createdAt: b.created_at, createdByName: b.display_name, summary: b.summary, fileName: b.file_name })),
      canManage: can(ctx, "inventory.import") && view.type !== "workspace",
      canSync: can(ctx, "inventory.import") && view.adapterAvailable && view.health !== "not_authorized" && view.health !== "platform_disabled" && view.health !== "not_configured",
    };
  });
}

// ---------------------------------------------------------------- create and edit

export type SourceInput = {
  type: unknown;
  name: unknown;
  authorizationRef: unknown;
  allProjects?: unknown;
  projectIds?: unknown[];
  freshnessHours?: unknown;
  partnerOrgId?: unknown;
  adapterKey?: unknown;
  config?: Record<string, unknown>;
  secretNames?: unknown[];
  trusted?: unknown;
};

function validateSecretNames(v: unknown[] | undefined): string[] {
  const names = (v ?? []).map((x) => String(x ?? "").trim()).filter(Boolean);
  if (names.length > 5 || names.some((n) => !SECRET_NAME_PATTERN.test(n))) throw new IdentityError("invalid_input", "secret_name");
  return [...new Set(names)];
}

async function setProjects(c: Client, sourceId: string, all: boolean, projectIds: string[]) {
  await c.query("delete from app.inventory_source_projects where source_id = $1", [sourceId]);
  if (all) return;
  if (!projectIds.length) throw new IdentityError("invalid_input", "projects");
  const { rows } = await c.query<{ id: string }>("select id from app.projects where id = any($1::uuid[]) and org_id = app.current_org_id()", [projectIds]);
  if (rows.length !== projectIds.length) throw new IdentityError("invalid_input", "projects");
  for (const p of projectIds) {
    await c.query("insert into app.inventory_source_projects (source_id, project_id, org_id) values ($1, $2, app.current_org_id())", [sourceId, p]);
  }
}

/**
 * File and partner sources are authorized by the developer when created (by someone allowed to import,
 * and for partners also to manage partners). Feeds and direct integrations start as drafts and need
 * platform approval before they can sync.
 */
export async function createSource(db: Db, actor: Actor, input: SourceInput): Promise<string> {
  const type = oneOf(input.type, ADDABLE_SOURCE_TYPES, "type");
  const name = req(input.name, 120, "name");
  const authRef = req(input.authorizationRef, 300, "authorization_ref");
  const all = input.allProjects === true || input.allProjects === "on" || input.allProjects === "yes";
  const projectIds = (input.projectIds ?? []).map((x) => id(x));
  const freshness = optInt(input.freshnessHours, 1, 168, "freshness_hours") ?? defaultFreshnessHours(type);
  let adapterKey: string | null = null;
  let config: Record<string, string> = {};
  let secretNames: string[] = [];
  let partnerOrg: string | null = null;
  const trusted = NEEDS_PLATFORM_APPROVAL.includes(type) && (input.trusted === true || input.trusted === "on");
  if (type === "data_feed" || type === "direct_integration") {
    const adapter = adapterByKey(String(input.adapterKey ?? "")) ?? (adaptersFor(type).length === 1 ? adaptersFor(type)[0] : undefined);
    // Never register a connection the code can't make.
    if (!adapter || adapter.sourceType !== type) throw new IdentityError("invalid_input", "no_adapter");
    adapterKey = adapter.key;
    config = adapter.validateConfig(input.config ?? {});
    secretNames = validateSecretNames(input.secretNames);
  }
  if (type === "partner") partnerOrg = id(input.partnerOrgId);

  return withAppTx(db, actor, async (c) => {
    const ctx = await requireDeveloper(c, actor, "inventory.import");
    if (type === "partner" && !can(ctx, "partner.manage")) throw new IdentityError("forbidden", "partner.manage");
    if (partnerOrg) {
      // The partner must already have an active share for every project the source covers.
      const { rows } = await c.query<{ n: number }>(
        `select count(distinct project_id)::int as n from app.project_shares where brokerage_org_id = $1 and status = 'active' and project_id = any($2::uuid[])`,
        [partnerOrg, projectIds],
      );
      if (all || !projectIds.length || rows[0]!.n !== projectIds.length) throw new IdentityError("invalid_input", "partner_projects");
    }
    const authorized = !NEEDS_PLATFORM_APPROVAL.includes(type);
    try {
      await c.query("savepoint s");
      const { rows } = await c.query<{ id: string }>(
        `insert into app.inventory_sources (org_id, name, source_type, adapter_key, partner_org_id, all_projects, authorization_status, authorization_ref,
                                            authorized_at, authorized_by, trusted, freshness_hours, config, secret_names, created_by)
         values (app.current_org_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id`,
        [name, type, adapterKey, partnerOrg, all, authorized ? "authorized" : "draft", authRef, authorized ? new Date() : null, authorized ? actor.userId : null,
          trusted, freshness, JSON.stringify(config), secretNames, actor.userId],
      );
      const sid = rows[0]!.id;
      await setProjects(c, sid, all, projectIds);
      await audit(c, actor, { type: "source.created", target: { type: "inventory_source", id: sid }, metadata: { type, authorized: String(authorized) } });
      return sid;
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err.code === "23505") { await c.query("rollback to savepoint s"); throw new IdentityError("conflict", "source_name_taken"); }
      if (err.message === "partner_not_brokerage") { await c.query("rollback to savepoint s"); throw new IdentityError("invalid_input", "partner_projects"); }
      throw e;
    }
  });
}

/** Edits settings. Changing what a feed connects to sends it back for platform approval. */
export async function updateSource(db: Db, actor: Actor, sourceId: string, input: Omit<SourceInput, "type" | "partnerOrgId" | "adapterKey">): Promise<string[]> {
  const sid = id(sourceId);
  return withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "inventory.import");
    const { rows } = await c.query("select * from app.inventory_sources where id = $1 for update", [sid]);
    const s = rows[0];
    if (!s) throw new IdentityError("not_found");
    if (s.source_type === "workspace" || s.authorization_status === "revoked") throw new IdentityError("invalid_input", "source_locked");
    const name = req(input.name, 120, "name");
    const authRef = req(input.authorizationRef, 300, "authorization_ref");
    const freshness = optInt(input.freshnessHours, 1, 168, "freshness_hours") ?? s.freshness_hours;
    const all = s.source_type !== "partner" && (input.allProjects === true || input.allProjects === "on" || input.allProjects === "yes");
    const projectIds = (input.projectIds ?? []).map((x) => id(x));
    let config = s.config ?? {};
    let secretNames: string[] = s.secret_names ?? [];
    let trusted = s.trusted;
    const changed: string[] = [];
    if (s.source_type === "data_feed" || s.source_type === "direct_integration") {
      const adapter = adapterByKey(s.adapter_key);
      if (!adapter) throw new IdentityError("invalid_input", "no_adapter");
      config = adapter.validateConfig(input.config ?? {});
      secretNames = validateSecretNames(input.secretNames);
      trusted = input.trusted === true || input.trusted === "on";
      if (JSON.stringify(config) !== JSON.stringify(s.config) || trusted !== s.trusted) changed.push("connection");
      if (secretNames.join() !== (s.secret_names ?? []).join()) changed.push("secrets");
    }
    if (s.source_type === "partner") {
      const { rows: shared } = await c.query<{ n: number }>(
        "select count(distinct project_id)::int as n from app.project_shares where brokerage_org_id = $1 and status = 'active' and project_id = any($2::uuid[])",
        [s.partner_org_id, projectIds],
      );
      if (!projectIds.length || shared[0]!.n !== projectIds.length) throw new IdentityError("invalid_input", "partner_projects");
    }
    // Reconnecting a feed somewhere else, or trusting it, is a new authorization.
    const reapprove = changed.includes("connection") && ["authorized", "suspended", "rejected"].includes(s.authorization_status);
    try {
      await c.query("savepoint s");
      await c.query(
        `update app.inventory_sources set name = $2, authorization_ref = $3, freshness_hours = $4, all_projects = $5, config = $6, secret_names = $7, trusted = $8,
                authorization_status = case when $9 then 'draft' else authorization_status end,
                authorized_at = case when $9 then null else authorized_at end, authorized_by = case when $9 then null else authorized_by end,
                updated_at = now(), updated_by = $10 where id = $1`,
        [sid, name, authRef, freshness, all, JSON.stringify(config), secretNames, trusted, reapprove, actor.userId],
      );
      await setProjects(c, sid, all, projectIds);
    } catch (e) {
      if ((e as { code?: string }).code === "23505") { await c.query("rollback to savepoint s"); throw new IdentityError("conflict", "source_name_taken"); }
      throw e;
    }
    await audit(c, actor, { type: "source.updated", target: { type: "inventory_source", id: sid }, metadata: { reapproval: String(reapprove), fields: changed.join(",") } });
    return reapprove ? [...changed, "needs_approval"] : changed;
  });
}

async function transition(db: Db, actor: Actor, sourceId: string, permission: "inventory.import" | "org.settings.manage",
  fn: (s: Record<string, any>) => { to: AuthorizationStatus; event: "source.submitted" | "source.suspended" | "source.resumed" | "source.revoked" } | null) {
  const sid = id(sourceId);
  await withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, permission);
    const { rows } = await c.query("select * from app.inventory_sources where id = $1 for update", [sid]);
    const s = rows[0];
    if (!s) throw new IdentityError("not_found");
    if (s.source_type === "workspace") throw new IdentityError("invalid_input", "source_locked");
    const t = fn(s);
    if (!t) throw new IdentityError("invalid_input", "invalid_transition");
    const authorizing = t.to === "authorized";
    await c.query(
      `update app.inventory_sources set authorization_status = $2, updated_at = now(), updated_by = $3,
              authorized_at = case when $4 then now() else authorized_at end, authorized_by = case when $4 then $3 else authorized_by end where id = $1`,
      [sid, t.to, actor.userId, authorizing],
    );
    await audit(c, actor, { type: t.event, target: { type: "inventory_source", id: sid }, metadata: { to: t.to } });
  });
}

/** A feed or direct integration goes to the platform for approval. */
export function submitSourceForApproval(db: Db, actor: Actor, sourceId: string) {
  return transition(db, actor, sourceId, "inventory.import", (s) =>
    NEEDS_PLATFORM_APPROVAL.includes(s.source_type) && ["draft", "rejected"].includes(s.authorization_status) ? { to: "pending_approval", event: "source.submitted" } : null);
}

/** Stops a source from delivering updates. Its earlier confirmations stop counting as verified. */
export function suspendSource(db: Db, actor: Actor, sourceId: string) {
  return transition(db, actor, sourceId, "inventory.import", (s) => (s.authorization_status === "authorized" ? { to: "suspended", event: "source.suspended" } : null));
}

/** Resuming a feed needs platform approval again; a file or partner source is re-authorized by the developer. */
export function resumeSource(db: Db, actor: Actor, sourceId: string) {
  return transition(db, actor, sourceId, "inventory.import", (s) =>
    s.authorization_status !== "suspended" ? null
      : NEEDS_PLATFORM_APPROVAL.includes(s.source_type) ? { to: "pending_approval", event: "source.resumed" } : { to: "authorized", event: "source.resumed" });
}

/** Permanent. Needs an organization administrator. */
export function revokeSource(db: Db, actor: Actor, sourceId: string) {
  return transition(db, actor, sourceId, "org.settings.manage", (s) => (s.authorization_status !== "revoked" ? { to: "revoked", event: "source.revoked" } : null));
}

// ---------------------------------------------------------------- partner brokerages available for a partner source

export async function listPartnerOptions(db: Db, actor: Actor): Promise<{ id: string; name: string; projects: { id: string; name: string }[] }[]> {
  return withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "partner.view");
    const { rows } = await c.query(
      // Brokerage names come from the directory function: developers can't read other organizations' rows.
      `select d.id, d.name, json_agg(json_build_object('id', p.id, 'name', p.name) order by p.name) as projects
         from app.project_shares s join app.brokerage_directory() d on d.id = s.brokerage_org_id join app.projects p on p.id = s.project_id
        where s.org_id = app.current_org_id() and s.status = 'active' group by d.id, d.name order by d.name`,
    );
    return rows.map((r) => ({ id: r.id, name: r.name, projects: r.projects }));
  });
}

// ---------------------------------------------------------------- feed sync

export const FEED_FAILURE_SUMMARIES: Record<FeedError["reason"], string> = {
  unreachable: "The feed host could not be reached.",
  blocked_address: "The feed host resolves to a private or reserved address.",
  http_status: "The feed answered with an error status.",
  redirect: "The feed redirected; redirects are not followed.",
  not_csv: "The feed did not return CSV.",
  too_large: "The feed file is larger than the import limit.",
  empty: "The feed returned no data rows.",
  timeout: "The feed did not answer in time.",
};

export type SyncResult = { ok: boolean; summary: string; batchId: string | null };

/**
 * Pulls the feed once and stages what it returns as a batch for review. A sync never changes inventory
 * by itself: the batch is validated and waits for someone to confirm it.
 */
export async function syncSource(
  db: Db,
  actor: Actor,
  sourceId: string,
  stage: (c: Client, input: { sourceId: string; recordType: ImportRecordType; headers: string[]; rows: string[][]; asOf: Date; fileName: string; options: Record<string, unknown> }) => Promise<string>,
  env: NodeJS.ProcessEnv = process.env,
  deps: AdapterDeps = defaultDeps,
): Promise<SyncResult> {
  const sid = id(sourceId);
  // Checks first, in their own transaction, so the outside request never holds a database transaction open.
  const src = await withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "inventory.import");
    const { rows } = await c.query("select * from app.inventory_sources where id = $1", [sid]);
    const s = rows[0];
    if (!s) throw new IdentityError("not_found");
    const adapter = adapterByKey(s.adapter_key);
    if (!adapter) throw new IdentityError("invalid_input", "no_adapter");
    if (s.authorization_status !== "authorized") throw new IdentityError("invalid_input", "source_not_authorized");
    if (!(await platformFeedsEnabled(c))) throw new IdentityError("invalid_input", "feeds_disabled");
    const secrets = (s.secret_names as string[]).map((n) => env[n]);
    if (secrets.some((v) => !v) || adapter.secretSlots.some((slot, i) => !slot.optional && !secrets[i])) throw new IdentityError("invalid_input", "not_configured");
    return { s, adapter, secrets };
  });

  let payload: Awaited<ReturnType<typeof src.adapter.fetch>> | null = null;
  let failure: string | null = null;
  try {
    payload = await src.adapter.fetch(src.s.config, src.secrets, deps);
  } catch (e) {
    failure = e instanceof FeedError ? FEED_FAILURE_SUMMARIES[e.reason] + (e.status ? ` (HTTP ${e.status})` : "")
      : e instanceof IdentityError ? "The feed settings are no longer valid." : "The feed could not be read.";
  }

  return withAppTx(db, actor, async (c) => {
    // Re-check: access or authorization could have changed while the request ran.
    await requireDeveloper(c, actor, "inventory.import");
    const { rows } = await c.query("select authorization_status from app.inventory_sources where id = $1 for update", [sid]);
    if (rows[0]?.authorization_status !== "authorized") throw new IdentityError("invalid_input", "source_not_authorized");
    let batchId: string | null = null;
    if (payload && !failure) {
      if (payload.rows.length > 2000) failure = FEED_FAILURE_SUMMARIES.too_large;
      else {
        batchId = await stage(c, {
          sourceId: sid, recordType: payload.recordType, headers: payload.headers, rows: payload.rows, asOf: payload.asOf,
          fileName: new URL(src.s.config.url).hostname, options: { as_of_basis: payload.asOfBasis },
        });
      }
    }
    const ok = !failure;
    const summary = ok ? `Received ${payload!.rows.length} rows; staged for review.` : failure!;
    await c.query(
      "insert into app.inventory_sync_runs (org_id, source_id, finished_at, ok, rows_received, summary, batch_id, run_by) values (app.current_org_id(), $1, now(), $2, $3, $4, $5, $6)",
      [sid, ok, payload?.rows.length ?? null, summary, batchId, actor.userId],
    );
    // last_success_at moves only when the staged data is applied (imports.ts): a fetch alone confirms nothing.
    await c.query("update app.inventory_sources set last_attempt_at = now(), last_error = $2 where id = $1", [sid, ok ? null : summary]);
    await audit(c, actor, { type: "source.synced", outcome: ok ? "success" : "failure", target: { type: "inventory_source", id: sid }, metadata: { rows: String(payload?.rows.length ?? 0) } });
    return { ok, summary, batchId };
  });
}

