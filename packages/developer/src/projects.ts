import { isMarketCode, PHASE_KINDS, PROJECT_STATUSES, PROPERTY_TYPES, type MarketCode, type PhaseKind, type ProjectStatus, type PropertyType } from "@baytline/core";
import { withAppTx, type Client, type Db } from "@baytline/db";
import type { Actor } from "@baytline/identity";
import { audit, can, IdentityError, requireDeveloper } from "./guard";
import { id, oneOf, opt, optDate, req } from "./validation";

export type ProjectRow = {
  id: string;
  name: string;
  market: MarketCode;
  city: string;
  location: string | null;
  propertyTypes: PropertyType[];
  status: ProjectStatus;
  launchDate: string | null;
  handoverDate: string | null;
  isSample: boolean;
  phaseCount: number;
  unitCounts: Record<"draft" | "available" | "reserved" | "sold" | "unavailable", number>;
  updatedAt: Date;
};

export type ProjectSearch = { q?: string; status?: string; market?: string; propertyType?: string };

const PROJECT_SELECT = `
  select p.id, p.name, p.market, p.city, p.location, p.property_types, p.status, p.launch_date::text, p.handover_date::text,
         p.is_sample, p.description, p.created_at, coalesce(p.updated_at, p.created_at) as updated_at,
         (select count(*) from app.project_phases ph where ph.project_id = p.id)::int as phase_count,
         (select jsonb_object_agg(s, coalesce(n, 0)) from (
            select s, (select count(*) from app.units u where u.project_id = p.id and u.status = s)::int as n
              from unnest(array['draft','available','reserved','sold','unavailable']) s) x) as unit_counts
    from app.projects p`;

function mapProject(r: Record<string, any>): ProjectRow & { description: string | null } {
  return {
    id: r.id,
    name: r.name,
    market: r.market,
    city: r.city,
    location: r.location,
    propertyTypes: r.property_types,
    status: r.status,
    launchDate: r.launch_date,
    handoverDate: r.handover_date,
    isSample: r.is_sample,
    phaseCount: r.phase_count,
    unitCounts: r.unit_counts,
    updatedAt: r.updated_at,
    description: r.description,
  };
}

export async function listProjects(db: Db, actor: Actor, s: ProjectSearch = {}): Promise<ProjectRow[]> {
  return withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "project.view");
    const where = ["p.org_id = app.current_org_id()"];
    const args: unknown[] = [];
    if (s.q?.trim()) {
      const n = args.push(`%${s.q.trim().slice(0, 100).replace(/[\\%_]/g, (ch) => "\\" + ch)}%`);
      where.push(`(p.name ilike $${n} or p.city ilike $${n} or p.location ilike $${n})`);
    }
    if (s.status && (PROJECT_STATUSES as readonly string[]).includes(s.status)) where.push(`p.status = $${args.push(s.status)}`);
    if (s.market && isMarketCode(s.market)) where.push(`p.market = $${args.push(s.market)}`);
    if (s.propertyType && (PROPERTY_TYPES as readonly string[]).includes(s.propertyType)) where.push(`$${args.push(s.propertyType)} = any(p.property_types)`);
    const { rows } = await c.query(`${PROJECT_SELECT} where ${where.join(" and ")} order by p.is_sample, p.name`, args);
    return rows.map(mapProject);
  });
}

export type Phase = { id: string; kind: PhaseKind; name: string; expectedHandover: string | null; sortOrder: number; unitCount: number };

export type ProjectDetail = ProjectRow & { description: string | null; createdAt: Date; phases: Phase[]; canManage: boolean };

export async function getProject(db: Db, actor: Actor, projectId: string): Promise<ProjectDetail> {
  const pid = id(projectId);
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireDeveloper(c, actor, "project.view");
    return loadProject(c, pid, can(ctx, "project.manage"));
  });
}

async function loadProject(c: Client, pid: string, canManage: boolean): Promise<ProjectDetail> {
  const { rows } = await c.query(`${PROJECT_SELECT} where p.id = $1 and p.org_id = app.current_org_id()`, [pid]);
  if (!rows[0]) throw new IdentityError("not_found");
  const { rows: phases } = await c.query(
    `select ph.id, ph.kind, ph.name, ph.expected_handover::text, ph.sort_order,
            (select count(*) from app.units u where u.phase_id = ph.id)::int as unit_count
       from app.project_phases ph where ph.project_id = $1 order by ph.sort_order, ph.name`,
    [pid],
  );
  const p = mapProject(rows[0]);
  return {
    ...p,
    createdAt: rows[0].created_at,
    canManage,
    phases: phases.map((r) => ({ id: r.id, kind: r.kind, name: r.name, expectedHandover: r.expected_handover, sortOrder: r.sort_order, unitCount: r.unit_count })),
  };
}

export type ProjectInput = {
  name: unknown;
  market: unknown;
  city: unknown;
  location?: unknown;
  propertyTypes: unknown[];
  description?: unknown;
  launchDate?: unknown;
  handoverDate?: unknown;
  status: unknown;
};

function validateProject(i: ProjectInput) {
  const market = String(i.market);
  if (!isMarketCode(market)) throw new IdentityError("invalid_input", "market");
  const types = [...new Set(i.propertyTypes.map(String))];
  if (!types.length || types.some((t) => !(PROPERTY_TYPES as readonly string[]).includes(t))) throw new IdentityError("invalid_input", "property_types");
  const launch = optDate(i.launchDate, "launch_date");
  const handover = optDate(i.handoverDate, "handover_date");
  if (launch && handover && handover < launch) throw new IdentityError("invalid_input", "handover_before_launch");
  return {
    name: req(i.name, 160, "name"),
    market,
    city: req(i.city, 80, "city"),
    location: opt(i.location, 200, "location"),
    property_types: types,
    description: opt(i.description, 4000, "description", true),
    launch_date: launch,
    handover_date: handover,
    status: oneOf(i.status, PROJECT_STATUSES, "status"),
  };
}

async function requireEnabledMarket(c: Client, market: string) {
  const ok = await c.query("select 1 from app.markets where code = $1 and status = 'enabled'", [market]);
  if (!ok.rowCount) throw new IdentityError("invalid_input", "market");
}

export async function createProject(db: Db, actor: Actor, input: ProjectInput): Promise<string> {
  const v = validateProject(input);
  return withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "project.manage");
    await requireEnabledMarket(c, v.market);
    const { rows } = await c.query<{ id: string }>(
      `insert into app.projects (org_id, name, market, city, location, property_types, description, launch_date, handover_date, status, created_by)
       values (app.current_org_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
      [v.name, v.market, v.city, v.location, v.property_types, v.description, v.launch_date, v.handover_date, v.status, actor.userId],
    );
    await audit(c, actor, { type: "project.created", target: { type: "project", id: rows[0]!.id } });
    return rows[0]!.id;
  });
}

export async function updateProject(db: Db, actor: Actor, projectId: string, input: ProjectInput): Promise<string[]> {
  const pid = id(projectId);
  const v = validateProject(input);
  return withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "project.manage");
    const { rows } = await c.query("select * , launch_date::text as ld, handover_date::text as hd from app.projects where id = $1 for update", [pid]);
    const before = rows[0];
    if (!before) throw new IdentityError("not_found");
    if (v.market !== before.market) await requireEnabledMarket(c, v.market);
    const prev: Record<string, unknown> = { ...before, launch_date: before.ld, handover_date: before.hd };
    const changed = (Object.keys(v) as (keyof typeof v)[]).filter((k) => JSON.stringify(prev[k] ?? null) !== JSON.stringify(v[k] ?? null));
    if (!changed.length) return [];
    await c.query(
      `update app.projects set name = $2, market = $3, city = $4, location = $5, property_types = $6, description = $7,
              launch_date = $8, handover_date = $9, status = $10, updated_at = now(), updated_by = $11 where id = $1`,
      [pid, v.name, v.market, v.city, v.location, v.property_types, v.description, v.launch_date, v.handover_date, v.status, actor.userId],
    );
    await audit(c, actor, { type: "project.updated", target: { type: "project", id: pid }, metadata: { fields: changed.join(",") } });
    return changed;
  });
}

export type PhaseInput = { kind: unknown; name: unknown; expectedHandover?: unknown; sortOrder?: unknown };

export async function savePhase(db: Db, actor: Actor, projectId: string, input: PhaseInput, phaseId?: string): Promise<string> {
  const pid = id(projectId);
  const kind = oneOf(input.kind, PHASE_KINDS, "kind");
  const name = req(input.name, 120, "phase_name");
  const handover = optDate(input.expectedHandover, "expected_handover");
  const sort = Number.isInteger(Number(input.sortOrder)) ? Number(input.sortOrder) : 0;
  return withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "project.manage");
    const p = await c.query("select 1 from app.projects where id = $1", [pid]);
    if (!p.rowCount) throw new IdentityError("not_found");
    try {
      await c.query("savepoint s");
      if (phaseId) {
        const res = await c.query(
          "update app.project_phases set kind = $3, name = $4, expected_handover = $5, sort_order = $6, updated_at = now(), updated_by = $7 where id = $1 and project_id = $2",
          [id(phaseId), pid, kind, name, handover, sort, actor.userId],
        );
        if (res.rowCount !== 1) throw new IdentityError("not_found");
        await audit(c, actor, { type: "phase.updated", target: { type: "phase", id: phaseId } });
        return phaseId;
      }
      const { rows } = await c.query<{ id: string }>(
        `insert into app.project_phases (org_id, project_id, kind, name, expected_handover, sort_order, created_by)
         values (app.current_org_id(), $1, $2, $3, $4, $5, $6) returning id`,
        [pid, kind, name, handover, sort, actor.userId],
      );
      await audit(c, actor, { type: "phase.created", target: { type: "phase", id: rows[0]!.id } });
      return rows[0]!.id;
    } catch (e) {
      if (e && typeof e === "object" && (e as { code?: string }).code === "23505") {
        await c.query("rollback to savepoint s");
        throw new IdentityError("conflict", "phase_name_taken");
      }
      throw e;
    }
  });
}
