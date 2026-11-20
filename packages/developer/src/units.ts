import {
  availabilityLabel,
  BINDING_UNIT_STATUSES,
  PROPERTY_TYPES,
  UNIT_STATUSES,
  type AvailabilityLabel,
  type PropertyType,
  type SourceKind,
  type UnitStatus,
  type VerificationStatus,
} from "@baytline/core";
import { withAppTx, type Client, type Db } from "@baytline/db";
import type { Actor } from "@baytline/identity";
import { audit, can, IdentityError, requireDeveloper } from "./guard";
import { id, oneOf, optDecimal, optInt, req } from "./validation";

export type UnitPrice = { minor: string; currency: string; listName: string; effectiveFrom: string };

export type UnitRow = {
  id: string;
  projectId: string;
  projectName: string;
  phaseId: string | null;
  phaseName: string | null;
  code: string;
  propertyType: PropertyType;
  bedrooms: number | null;
  areaSqm: string | null;
  floor: number | null;
  status: UnitStatus;
  /** Only from an APPROVED price list version in effect today (market time zone). */
  price: UnitPrice | null;
  sourceKind: SourceKind;
  sourceRef: string | null;
  lastUpdatedAt: Date;
  verification: VerificationStatus;
  lastVerifiedAt: Date | null;
  version: number;
  isSample: boolean;
  /** Computed by @baytline/core; manual entries are never "live". */
  availability: AvailabilityLabel;
};

const UNIT_SELECT = `
  select u.id, u.project_id, p.name as project_name, u.phase_id, ph.name as phase_name, u.code, u.property_type,
         u.bedrooms, u.area_sqm::text, u.floor, u.status, u.source_kind, u.source_ref, u.last_updated_at,
         u.verification, u.last_verified_at, u.version, u.is_sample, u.org_id,
         cp.price_minor::text as price_minor, cp.currency, cp.list_name, cp.effective_from
    from app.units u
    join app.projects p on p.id = u.project_id
    join app.markets mk on mk.code = p.market
    left join app.project_phases ph on ph.id = u.phase_id
    left join lateral (
      select e.price_minor, l.currency, l.name as list_name, v.effective_from::text
        from app.price_list_entries e
        join app.price_list_versions v on v.id = e.version_id
        join app.price_lists l on l.id = v.price_list_id
       where e.unit_id = u.id and v.status = 'approved'
         and v.effective_from <= (now() at time zone mk.time_zone)::date
         and (v.effective_to is null or v.effective_to >= (now() at time zone mk.time_zone)::date)
       order by v.effective_from desc, v.decided_at desc
       limit 1) cp on true`;

function mapUnit(r: Record<string, any>, now: Date): UnitRow {
  return {
    id: r.id,
    projectId: r.project_id,
    projectName: r.project_name,
    phaseId: r.phase_id,
    phaseName: r.phase_name,
    code: r.code,
    propertyType: r.property_type,
    bedrooms: r.bedrooms,
    areaSqm: r.area_sqm,
    floor: r.floor,
    status: r.status,
    price: r.price_minor ? { minor: r.price_minor, currency: r.currency, listName: r.list_name, effectiveFrom: r.effective_from } : null,
    sourceKind: r.source_kind,
    sourceRef: r.source_ref,
    lastUpdatedAt: r.last_updated_at,
    verification: r.verification,
    lastVerifiedAt: r.last_verified_at,
    version: r.version,
    isSample: r.is_sample,
    availability: availabilityLabel(
      {
        sourceKind: r.source_kind,
        sourceId: r.source_ref ?? "workspace",
        ownerOrgId: r.org_id,
        lastUpdatedAt: r.last_updated_at.toISOString(),
        lastVerifiedAt: r.last_verified_at?.toISOString(),
        verification: r.verification,
        version: r.version,
        isSample: r.is_sample,
      },
      now,
    ),
  };
}

export type UnitSearch = { projectId?: string; phaseId?: string; status?: string; verification?: string; q?: string };

export async function listUnits(db: Db, actor: Actor, s: UnitSearch = {}, now = new Date()): Promise<UnitRow[]> {
  return withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "inventory.view");
    const where = ["u.org_id = app.current_org_id()"];
    const args: unknown[] = [];
    if (s.projectId) where.push(`u.project_id = $${args.push(id(s.projectId))}`);
    if (s.phaseId) where.push(`u.phase_id = $${args.push(id(s.phaseId))}`);
    if (s.status && (UNIT_STATUSES as readonly string[]).includes(s.status)) where.push(`u.status = $${args.push(s.status)}`);
    if (s.verification && ["verified", "owner_reported", "pending", "unverified", "disputed"].includes(s.verification)) where.push(`u.verification = $${args.push(s.verification)}`);
    if (s.q?.trim()) where.push(`u.code ilike $${args.push(`%${s.q.trim().slice(0, 40).replace(/[\\%_]/g, (ch) => "\\" + ch)}%`)}`);
    const { rows } = await c.query(`${UNIT_SELECT} where ${where.join(" and ")} order by p.name, ph.sort_order nulls last, u.code limit 1000`, args);
    return rows.map((r) => mapUnit(r, now));
  });
}

export type UnitChange = { id: string; at: Date; actorName: string | null; field: string; from: unknown; to: unknown; version: number; sourceKind: string };
export type PricePoint = { minor: string; currency: string; listName: string; version: number; status: string; effectiveFrom: string; effectiveTo: string | null };

export type UnitDetail = UnitRow & { history: UnitChange[]; prices: PricePoint[]; canManage: boolean; canVerify: boolean; canSetBinding: boolean };

export async function getUnit(db: Db, actor: Actor, unitId: string, now = new Date()): Promise<UnitDetail> {
  const uid = id(unitId);
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireDeveloper(c, actor, "inventory.view");
    const { rows } = await c.query(`${UNIT_SELECT} where u.id = $1 and u.org_id = app.current_org_id()`, [uid]);
    if (!rows[0]) throw new IdentityError("not_found");
    const { rows: hist } = await c.query(
      `select h.id::text, h.at, u.display_name, h.field, h.from_value, h.to_value, h.version, h.source_kind
         from app.unit_changes h left join app.users u on u.id = h.actor_user_id
        where h.unit_id = $1 order by h.id desc limit 200`,
      [uid],
    );
    const { rows: prices } = can(ctx, "price.view")
      ? await c.query(
          `select e.price_minor::text, l.currency, l.name, v.version, v.status, v.effective_from::text, v.effective_to::text
             from app.price_list_entries e join app.price_list_versions v on v.id = e.version_id join app.price_lists l on l.id = v.price_list_id
            where e.unit_id = $1 and v.status in ('approved','superseded') order by v.effective_from desc, l.name`,
          [uid],
        )
      : { rows: [] };
    return {
      ...mapUnit(rows[0], now),
      canManage: can(ctx, "unit.manage"),
      canVerify: can(ctx, "inventory.verify") && !rows[0].is_sample,
      canSetBinding: can(ctx, "unit.hold.approve"),
      history: hist.map((h) => ({ id: h.id, at: h.at, actorName: h.display_name, field: h.field, from: h.from_value, to: h.to_value, version: h.version, sourceKind: h.source_kind })),
      prices: prices.map((p) => ({ minor: p.price_minor, currency: p.currency, listName: p.name, version: p.version, status: p.status, effectiveFrom: p.effective_from, effectiveTo: p.effective_to })),
    };
  });
}

export type UnitInput = {
  code: unknown;
  phaseId?: unknown;
  propertyType: unknown;
  bedrooms?: unknown;
  areaSqm?: unknown;
  floor?: unknown;
  status: unknown;
  sourceRef?: unknown;
};

function validateUnit(i: UnitInput) {
  return {
    code: req(i.code, 40, "code"),
    phase_id: i.phaseId ? id(i.phaseId) : null,
    property_type: oneOf(i.propertyType, PROPERTY_TYPES, "property_type"),
    bedrooms: optInt(i.bedrooms, 0, 20, "bedrooms"),
    area_sqm: optDecimal(i.areaSqm, "area_sqm", { max: 99_999_999, places: 2 }),
    floor: optInt(i.floor, -5, 200, "floor"),
    status: oneOf(i.status, UNIT_STATUSES, "status"),
    source_ref: typeof i.sourceRef === "string" && i.sourceRef.trim() ? req(i.sourceRef, 120, "source_ref") : null,
  };
}

type Fields = ReturnType<typeof validateUnit>;
const TRACKED: (keyof Fields)[] = ["code", "phase_id", "property_type", "bedrooms", "area_sqm", "floor", "status", "source_ref"];

async function logChanges(c: Client, actor: Actor, unitId: string, version: number, changes: [string, unknown, unknown][], sourceKind: string) {
  for (const [field, from, to] of changes) {
    await c.query(
      `insert into app.unit_changes (org_id, unit_id, version, actor_user_id, field, from_value, to_value, source_kind)
       values (app.current_org_id(), $1, $2, $3, $4, $5, $6, $7)`,
      [unitId, version, actor.userId, field, JSON.stringify(from ?? null), JSON.stringify(to ?? null), sourceKind],
    );
  }
}

function bindingGuard(ctxCanBind: boolean, from: UnitStatus | null, to: UnitStatus) {
  // Reserving or selling a unit (or undoing either) is binding: human-only and needs unit.hold.approve.
  const binding = (s: UnitStatus | null) => s !== null && BINDING_UNIT_STATUSES.includes(s);
  if ((binding(to) || binding(from)) && from !== to && !ctxCanBind) throw new IdentityError("forbidden", "unit.hold.approve");
}

export async function createUnit(db: Db, actor: Actor, projectId: string, input: UnitInput): Promise<string> {
  const pid = id(projectId);
  const v = validateUnit(input);
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireDeveloper(c, actor, "unit.manage");
    bindingGuard(can(ctx, "unit.hold.approve"), null, v.status);
    const p = await c.query("select 1 from app.projects where id = $1", [pid]);
    if (!p.rowCount) throw new IdentityError("not_found");
    try {
      await c.query("savepoint s");
      const { rows } = await c.query<{ id: string }>(
        `insert into app.units (org_id, project_id, phase_id, code, property_type, bedrooms, area_sqm, floor, status, source_ref, created_by)
         values (app.current_org_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
        [pid, v.phase_id, v.code, v.property_type, v.bedrooms, v.area_sqm, v.floor, v.status, v.source_ref, actor.userId],
      );
      const uid = rows[0]!.id;
      await logChanges(c, actor, uid, 1, [["created", null, v]], "partner_portal");
      await audit(c, actor, { type: "unit.created", target: { type: "unit", id: uid } });
      return uid;
    } catch (e) {
      await mapUnitError(c, e);
      throw e;
    }
  });
}

async function mapUnitError(c: Client, e: unknown) {
  const code = e && typeof e === "object" ? (e as { code?: string; message?: string }) : {};
  if (code.code === "23505") {
    await c.query("rollback to savepoint s");
    throw new IdentityError("conflict", "unit_code_taken");
  }
  if (code.message === "phase_not_in_project") {
    await c.query("rollback to savepoint s");
    throw new IdentityError("invalid_input", "phase");
  }
}

/**
 * Edits bump the version, refresh last_updated_at, write one history row per changed
 * field, and drop verification back to "owner_reported": a confirmation applies to the
 * data that was confirmed, not to later edits.
 */
export async function updateUnit(db: Db, actor: Actor, unitId: string, input: UnitInput): Promise<string[]> {
  const uid = id(unitId);
  const v = validateUnit(input);
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireDeveloper(c, actor, "unit.manage");
    const { rows } = await c.query("select *, area_sqm::text as area_txt from app.units where id = $1 for update", [uid]);
    const before = rows[0];
    if (!before) throw new IdentityError("not_found");
    bindingGuard(can(ctx, "unit.hold.approve"), before.status, v.status);
    const prev: Record<string, unknown> = { ...before, area_sqm: before.area_txt };
    // Area is numeric: "52" and "52.00" are the same value, not an edit.
    const same = (k: keyof Fields) =>
      k === "area_sqm" ? (prev[k] == null && v[k] == null) || (prev[k] != null && v[k] != null && Number(prev[k]) === Number(v[k])) : String(prev[k] ?? "") === String(v[k] ?? "");
    const changes = TRACKED.filter((k) => !same(k)).map((k) => [k, prev[k] ?? null, v[k]] as [string, unknown, unknown]);
    if (!changes.length) return [];
    const version = before.version + 1;
    try {
      await c.query("savepoint s");
      await c.query(
        `update app.units set code = $2, phase_id = $3, property_type = $4, bedrooms = $5, area_sqm = $6, floor = $7, status = $8,
                source_ref = $9, version = $10, last_updated_at = now(), source_kind = 'partner_portal',
                verification = case when verification = 'verified' then 'owner_reported' else verification end,
                last_verified_at = case when verification = 'verified' then null else last_verified_at end,
                verified_by = case when verification = 'verified' then null else verified_by end
          where id = $1`,
        [uid, v.code, v.phase_id, v.property_type, v.bedrooms, v.area_sqm, v.floor, v.status, v.source_ref, version],
      );
    } catch (e) {
      await mapUnitError(c, e);
      throw e;
    }
    if (before.verification === "verified") changes.push(["verification", "verified", "owner_reported"]);
    await logChanges(c, actor, uid, version, changes, "partner_portal");
    await audit(c, actor, { type: "unit.updated", target: { type: "unit", id: uid }, metadata: { fields: changes.map((x) => x[0]).join(",") } });
    return changes.map((x) => x[0]);
  });
}

/** A person with inventory.verify confirms the unit's current data. Sample records can never be verified. */
export async function verifyUnit(db: Db, actor: Actor, unitId: string): Promise<void> {
  const uid = id(unitId);
  await withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "inventory.verify");
    const { rows } = await c.query("select verification, version, is_sample from app.units where id = $1 for update", [uid]);
    const u = rows[0];
    if (!u) throw new IdentityError("not_found");
    if (u.is_sample) throw new IdentityError("invalid_input", "sample_cannot_be_verified");
    await c.query("update app.units set verification = 'verified', last_verified_at = now(), verified_by = $2 where id = $1", [uid, actor.userId]);
    await logChanges(c, actor, uid, u.version, [["verification", u.verification, "verified"]], "partner_portal");
    await audit(c, actor, { type: "unit.verified", target: { type: "unit", id: uid } });
  });
}
