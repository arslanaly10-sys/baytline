import {
  isMarketCode,
  MANAGEMENT_BASES,
  OCCUPANCY_STATUSES,
  PM_PROPERTY_TYPES,
  PM_UNIT_TYPES,
  type ManagementBasis,
  type MarketCode,
  type OccupancyStatus,
  type PmPropertyType,
  type PmUnitType,
} from "@baytline/core";
import { withAppTx, type Client, type Db } from "@baytline/db";
import type { Actor } from "@baytline/identity";
import { audit, can, f, IdentityError, like, mapDbError, requireManagement } from "./guard";

export type OccupancyCounts = Record<OccupancyStatus, number>;

// ---------------------------------------------------------------- portfolio summary

/**
 * Counts computed from stored records only. Each block is present only when the role
 * may see that area; null means "not visible to you", never "zero".
 */
export type PortfolioSummary = {
  properties: number;
  units: number;
  occupancy: OccupancyCounts | null;
  leases: { active: number; endingSoon: number; renewalsDue: number } | null;
  requests: { open: number; urgent: number; unassigned: number } | null;
  workOrders: { open: number; scheduledThisWeek: number } | null;
  windowDays: { endingSoon: number; renewalsDue: number };
};

export const ENDING_SOON_DAYS = 90;
export const RENEWAL_DUE_DAYS = 60;

const zeroOccupancy = (): OccupancyCounts => Object.fromEntries(OCCUPANCY_STATUSES.map((s) => [s, 0])) as OccupancyCounts;

export async function getPortfolioSummary(db: Db, actor: Actor): Promise<PortfolioSummary> {
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireManagement(c, actor, "property.view");
    const one = async (sql: string) => (await c.query(sql)).rows[0];
    const base = await one(`select (select count(*) from app.pm_properties where org_id = app.current_org_id() and status = 'active')::int as properties,
                                   (select count(*) from app.pm_units u join app.pm_properties p on p.id = u.property_id
                                     where u.org_id = app.current_org_id() and p.status = 'active')::int as units`);
    let occupancy: OccupancyCounts | null = null;
    if (can(ctx, "occupancy.view")) {
      occupancy = zeroOccupancy();
      const { rows } = await c.query(
        `select u.occupancy, count(*)::int as n from app.pm_units u join app.pm_properties p on p.id = u.property_id
          where u.org_id = app.current_org_id() and p.status = 'active' group by u.occupancy`,
      );
      for (const r of rows) occupancy[r.occupancy as OccupancyStatus] = r.n;
    }
    const today = "(now() at time zone mk.time_zone)::date";
    const leases = can(ctx, "lease.view")
      ? await one(`select count(*) filter (where l.status in ('active','renewed'))::int as active,
                          count(*) filter (where l.status in ('active','renewed') and l.end_date between ${today} and ${today} + ${ENDING_SOON_DAYS})::int as ending_soon,
                          count(*) filter (where l.status in ('active','renewed') and l.renewal_date between ${today} and ${today} + ${RENEWAL_DUE_DAYS})::int as renewals_due
                     from app.pm_leases l join app.pm_units u on u.id = l.unit_id join app.pm_properties p on p.id = u.property_id
                     join app.markets mk on mk.code = p.market where l.org_id = app.current_org_id()`)
      : null;
    const requests = can(ctx, "tenant_request.view")
      ? await one(`select count(*) filter (where status not in ('resolved','closed'))::int as open,
                          count(*) filter (where status not in ('resolved','closed') and priority = 'urgent')::int as urgent,
                          count(*) filter (where status not in ('resolved','closed') and assignee_user_id is null)::int as unassigned
                     from app.pm_requests where org_id = app.current_org_id()`)
      : null;
    const work = can(ctx, "maintenance.view")
      ? await one(`select count(*) filter (where w.status not in ('completed','cancelled'))::int as open,
                          count(*) filter (where w.status = 'scheduled' and w.scheduled_for between ${today} and ${today} + 6)::int as this_week
                     from app.pm_work_orders w join app.pm_properties p on p.id = w.property_id join app.markets mk on mk.code = p.market
                    where w.org_id = app.current_org_id()`)
      : null;
    return {
      properties: base.properties,
      units: base.units,
      occupancy,
      leases: leases && { active: leases.active, endingSoon: leases.ending_soon, renewalsDue: leases.renewals_due },
      requests: requests && { open: requests.open, urgent: requests.urgent, unassigned: requests.unassigned },
      workOrders: work && { open: work.open, scheduledThisWeek: work.this_week },
      windowDays: { endingSoon: ENDING_SOON_DAYS, renewalsDue: RENEWAL_DUE_DAYS },
    };
  });
}

// ---------------------------------------------------------------- properties

export type PropertyRow = {
  id: string;
  name: string;
  market: MarketCode;
  city: string;
  address: string | null;
  propertyType: PmPropertyType;
  ownerName: string | null;
  managementBasis: ManagementBasis;
  agreementRef: string | null;
  agreementStart: string | null;
  agreementEnd: string | null;
  notes: string | null;
  status: "active" | "archived";
  isSample: boolean;
  unitCount: number;
  occupancy: OccupancyCounts;
  updatedAt: Date;
};

const PROPERTY_SELECT = `
  select p.*, p.agreement_start::text as a_start, p.agreement_end::text as a_end, coalesce(p.updated_at, p.created_at) as touched,
         (select count(*) from app.pm_units u where u.property_id = p.id)::int as unit_count,
         (select coalesce(jsonb_object_agg(occupancy, n), '{}') from (select occupancy, count(*)::int as n from app.pm_units u where u.property_id = p.id group by occupancy) x) as occ
    from app.pm_properties p`;

function mapProperty(r: Record<string, any>, showOccupancy: boolean): PropertyRow {
  return {
    id: r.id,
    name: r.name,
    market: r.market,
    city: r.city,
    address: r.address,
    propertyType: r.property_type,
    ownerName: r.owner_name,
    managementBasis: r.management_basis,
    agreementRef: r.agreement_ref,
    agreementStart: r.a_start,
    agreementEnd: r.a_end,
    notes: r.notes,
    status: r.status,
    isSample: r.is_sample,
    unitCount: r.unit_count,
    occupancy: showOccupancy ? { ...zeroOccupancy(), ...r.occ } : zeroOccupancy(),
    updatedAt: r.touched,
  };
}

export type PropertySearch = { q?: string; type?: string; basis?: string; market?: string; status?: string };

export async function listProperties(db: Db, actor: Actor, s: PropertySearch = {}): Promise<PropertyRow[]> {
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireManagement(c, actor, "property.view");
    const where = ["p.org_id = app.current_org_id()"];
    const args: unknown[] = [];
    if (s.q?.trim()) {
      const n = args.push(like(s.q));
      where.push(`(p.name ilike $${n} or p.city ilike $${n} or p.address ilike $${n} or p.owner_name ilike $${n})`);
    }
    if (s.type && (PM_PROPERTY_TYPES as readonly string[]).includes(s.type)) where.push(`p.property_type = $${args.push(s.type)}`);
    if (s.basis && (MANAGEMENT_BASES as readonly string[]).includes(s.basis)) where.push(`p.management_basis = $${args.push(s.basis)}`);
    if (s.market && isMarketCode(s.market)) where.push(`p.market = $${args.push(s.market)}`);
    where.push(s.status === "archived" ? "p.status = 'archived'" : s.status === "all" ? "true" : "p.status = 'active'");
    const { rows } = await c.query(`${PROPERTY_SELECT} where ${where.join(" and ")} order by p.is_sample, p.name`, args);
    return rows.map((r) => mapProperty(r, can(ctx, "occupancy.view")));
  });
}

export async function getProperty(db: Db, actor: Actor, propertyId: string): Promise<PropertyRow & { canManage: boolean }> {
  const pid = f.id(propertyId);
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireManagement(c, actor, "property.view");
    const { rows } = await c.query(`${PROPERTY_SELECT} where p.id = $1 and p.org_id = app.current_org_id()`, [pid]);
    if (!rows[0]) throw new IdentityError("not_found");
    return { ...mapProperty(rows[0], can(ctx, "occupancy.view")), canManage: can(ctx, "property.manage") };
  });
}

export type PropertyInput = {
  name: unknown;
  market: unknown;
  city: unknown;
  address?: unknown;
  propertyType: unknown;
  ownerName?: unknown;
  managementBasis: unknown;
  agreementRef?: unknown;
  agreementStart?: unknown;
  agreementEnd?: unknown;
  notes?: unknown;
  status?: unknown;
};

function validateProperty(i: PropertyInput) {
  const market = String(i.market);
  if (!isMarketCode(market)) throw new IdentityError("invalid_input", "market");
  const start = f.optDate(i.agreementStart, "agreement_start");
  const end = f.optDate(i.agreementEnd, "agreement_end");
  if (start && end && end < start) throw new IdentityError("invalid_input", "agreement_end");
  return {
    name: f.req(i.name, 160, "name"),
    market,
    city: f.req(i.city, 80, "city"),
    address: f.opt(i.address, 300, "address"),
    property_type: f.oneOf(i.propertyType, PM_PROPERTY_TYPES, "property_type"),
    owner_name: f.opt(i.ownerName, 160, "owner_name"),
    management_basis: f.oneOf(i.managementBasis, MANAGEMENT_BASES, "management_basis"),
    agreement_ref: f.opt(i.agreementRef, 120, "agreement_ref"),
    agreement_start: start,
    agreement_end: end,
    notes: f.opt(i.notes, 2000, "notes", true),
    status: i.status === undefined || i.status === "" ? "active" : f.oneOf(i.status, ["active", "archived"] as const, "status"),
  };
}

async function requireEnabledMarket(c: Client, code: string) {
  const r = await c.query("select 1 from app.markets where code = $1 and status = 'enabled'", [code]);
  if (!r.rowCount) throw new IdentityError("invalid_input", "market");
}

export async function createProperty(db: Db, actor: Actor, input: PropertyInput): Promise<string> {
  const v = validateProperty(input);
  return withAppTx(db, actor, async (c) => {
    await requireManagement(c, actor, "property.manage");
    await requireEnabledMarket(c, v.market);
    const { rows } = await c.query<{ id: string }>(
      `insert into app.pm_properties (org_id, name, market, city, address, property_type, owner_name, management_basis,
              agreement_ref, agreement_start, agreement_end, notes, created_by)
       values (app.current_org_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
      [v.name, v.market, v.city, v.address, v.property_type, v.owner_name, v.management_basis, v.agreement_ref, v.agreement_start, v.agreement_end, v.notes, actor.userId],
    );
    await audit(c, actor, { type: "pm_property.created", target: { type: "pm_property", id: rows[0]!.id } });
    return rows[0]!.id;
  });
}

export async function updateProperty(db: Db, actor: Actor, propertyId: string, input: PropertyInput): Promise<string[]> {
  const pid = f.id(propertyId);
  const v = validateProperty(input);
  return withAppTx(db, actor, async (c) => {
    await requireManagement(c, actor, "property.manage");
    const { rows } = await c.query("select *, agreement_start::text as a_start, agreement_end::text as a_end from app.pm_properties where id = $1 for update", [pid]);
    const b = rows[0];
    if (!b) throw new IdentityError("not_found");
    if (v.market !== b.market) await requireEnabledMarket(c, v.market);
    const prev: Record<string, unknown> = { ...b, agreement_start: b.a_start, agreement_end: b.a_end };
    const changed = (Object.keys(v) as (keyof typeof v)[]).filter((k) => (prev[k] ?? null) !== (v[k] ?? null));
    if (!changed.length) return [];
    await c.query(
      `update app.pm_properties set name = $2, market = $3, city = $4, address = $5, property_type = $6, owner_name = $7,
              management_basis = $8, agreement_ref = $9, agreement_start = $10, agreement_end = $11, notes = $12, status = $13,
              updated_at = now(), updated_by = $14 where id = $1`,
      [pid, v.name, v.market, v.city, v.address, v.property_type, v.owner_name, v.management_basis, v.agreement_ref, v.agreement_start, v.agreement_end, v.notes, v.status, actor.userId],
    );
    await audit(c, actor, { type: "pm_property.updated", target: { type: "pm_property", id: pid }, metadata: { fields: changed.join(",") } });
    return changed;
  });
}

// ---------------------------------------------------------------- units

export type PmUnitRow = {
  id: string;
  propertyId: string;
  propertyName: string;
  code: string;
  unitType: PmUnitType;
  bedrooms: number | null;
  areaSqm: string | null;
  floor: number | null;
  /** null when the role can't see occupancy. */
  occupancy: OccupancyStatus | null;
  occupancyUpdatedAt: Date | null;
  occupancyUpdatedByName: string | null;
  notes: string | null;
  isSample: boolean;
  activeLease: { id: string; endDate: string; tenantName: string } | null;
};

export type UnitSearch = { propertyId?: string; occupancy?: string; type?: string; q?: string };

export async function listPmUnits(db: Db, actor: Actor, s: UnitSearch = {}): Promise<PmUnitRow[]> {
  return withAppTx(db, actor, async (c) => selectUnits(c, await requireManagement(c, actor, "property.view"), s));
}

async function selectUnits(c: Client, ctx: Awaited<ReturnType<typeof requireManagement>>, s: UnitSearch & { unitId?: string }): Promise<PmUnitRow[]> {
  {
    const occ = can(ctx, "occupancy.view");
    const leases = can(ctx, "lease.view");
    const where = ["u.org_id = app.current_org_id()"];
    const args: unknown[] = [];
    if (s.unitId) where.push(`u.id = $${args.push(f.id(s.unitId))}`);
    else where.push("p.status = 'active'");
    if (s.propertyId) where.push(`u.property_id = $${args.push(f.id(s.propertyId))}`);
    if (occ && s.occupancy && (OCCUPANCY_STATUSES as readonly string[]).includes(s.occupancy)) where.push(`u.occupancy = $${args.push(s.occupancy)}`);
    if (s.type && (PM_UNIT_TYPES as readonly string[]).includes(s.type)) where.push(`u.unit_type = $${args.push(s.type)}`);
    if (s.q?.trim()) where.push(`u.code ilike $${args.push(like(s.q))}`);
    const { rows } = await c.query(
      `select u.*, u.area_sqm::text as area, p.name as property_name, ou.display_name as occ_by,
              ${leases ? `(select jsonb_build_object('id', l.id, 'endDate', l.end_date::text, 'tenantName', t.display_name)
                 from app.pm_leases l join app.pm_tenants t on t.id = l.tenant_id
                where l.unit_id = u.id and l.status in ('active','renewed') order by l.start_date desc limit 1)` : "null"} as lease
         from app.pm_units u join app.pm_properties p on p.id = u.property_id left join app.users ou on ou.id = u.occupancy_updated_by
        where ${where.join(" and ")} order by p.name, u.code limit 2000`,
      args,
    );
    return rows.map((r) => ({
      id: r.id,
      propertyId: r.property_id,
      propertyName: r.property_name,
      code: r.code,
      unitType: r.unit_type,
      bedrooms: r.bedrooms,
      areaSqm: r.area,
      floor: r.floor,
      occupancy: occ ? r.occupancy : null,
      occupancyUpdatedAt: occ ? r.occupancy_updated_at : null,
      occupancyUpdatedByName: occ ? r.occ_by : null,
      notes: r.notes,
      isSample: r.is_sample,
      activeLease: r.lease,
    }));
  }
}

export type UnitInput = { code: unknown; unitType: unknown; bedrooms?: unknown; areaSqm?: unknown; floor?: unknown; occupancy: unknown; notes?: unknown };

function validateUnit(i: UnitInput) {
  return {
    code: f.req(i.code, 40, "code"),
    unit_type: f.oneOf(i.unitType, PM_UNIT_TYPES, "unit_type"),
    bedrooms: f.optInt(i.bedrooms, 0, 20, "bedrooms"),
    area_sqm: f.optDecimal(i.areaSqm, "area_sqm", { max: 99_999_999, places: 2 }),
    floor: f.optInt(i.floor, -5, 200, "floor"),
    occupancy: f.oneOf(i.occupancy, OCCUPANCY_STATUSES, "occupancy"),
    notes: f.opt(i.notes, 1000, "notes", true),
  };
}

export async function createPmUnit(db: Db, actor: Actor, propertyId: string, input: UnitInput): Promise<string> {
  const pid = f.id(propertyId);
  const v = validateUnit(input);
  return withAppTx(db, actor, async (c) => {
    await requireManagement(c, actor, "property.manage");
    const p = await c.query("select 1 from app.pm_properties where id = $1", [pid]);
    if (!p.rowCount) throw new IdentityError("not_found");
    try {
      await c.query("savepoint s");
      const { rows } = await c.query<{ id: string }>(
        `insert into app.pm_units (org_id, property_id, code, unit_type, bedrooms, area_sqm, floor, occupancy, occupancy_updated_by, notes, created_by)
         values (app.current_org_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $8) returning id`,
        [pid, v.code, v.unit_type, v.bedrooms, v.area_sqm, v.floor, v.occupancy, actor.userId, v.notes],
      );
      await audit(c, actor, { type: "pm_unit.created", target: { type: "pm_unit", id: rows[0]!.id } });
      return rows[0]!.id;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") {
        await c.query("rollback to savepoint s");
        throw new IdentityError("conflict", "unit_code_taken");
      }
      return mapDbError(c, e);
    }
  });
}

/**
 * Unit details need property.manage; recording occupancy alone is allowed with lease.manage
 * (leasing staff record move-ins and notices without editing the unit itself).
 */
export async function updatePmUnit(db: Db, actor: Actor, unitId: string, input: UnitInput): Promise<string[]> {
  const uid = f.id(unitId);
  const v = validateUnit(input);
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireManagement(c, actor, "property.view");
    const { rows } = await c.query("select *, area_sqm::text as area from app.pm_units where id = $1 for update", [uid]);
    const b = rows[0];
    if (!b) throw new IdentityError("not_found");
    const prev: Record<string, unknown> = { ...b, area_sqm: b.area };
    const same = (k: keyof typeof v) =>
      k === "area_sqm" ? (prev[k] == null && v[k] == null) || Number(prev[k]) === Number(v[k]) : String(prev[k] ?? "") === String(v[k] ?? "");
    const changed = (Object.keys(v) as (keyof typeof v)[]).filter((k) => !same(k));
    if (!changed.length) return [];
    const details = changed.filter((k) => k !== "occupancy");
    if (details.length && !can(ctx, "property.manage")) throw new IdentityError("forbidden", "property.manage");
    if (changed.includes("occupancy") && !can(ctx, "property.manage") && !can(ctx, "lease.manage")) throw new IdentityError("forbidden", "lease.manage");
    try {
      await c.query("savepoint s");
      await c.query(
        `update app.pm_units set code = $2, unit_type = $3, bedrooms = $4, area_sqm = $5, floor = $6, notes = $8,
                occupancy = $7,
                occupancy_updated_at = case when occupancy is distinct from $7 then now() else occupancy_updated_at end,
                occupancy_updated_by = case when occupancy is distinct from $7 then $9::uuid else occupancy_updated_by end,
                updated_at = now(), updated_by = $9 where id = $1`,
        [uid, v.code, v.unit_type, v.bedrooms, v.area_sqm, v.floor, v.occupancy, v.notes, actor.userId],
      );
    } catch (e) {
      if ((e as { code?: string }).code === "23505") {
        await c.query("rollback to savepoint s");
        throw new IdentityError("conflict", "unit_code_taken");
      }
      return mapDbError(c, e);
    }
    await audit(c, actor, {
      type: "pm_unit.updated",
      target: { type: "pm_unit", id: uid },
      metadata: { fields: changed.join(","), ...(changed.includes("occupancy") ? { occupancyFrom: b.occupancy, occupancyTo: v.occupancy } : {}) },
    });
    return changed;
  });
}

export type UnitDetail = PmUnitRow & {
  canEditDetails: boolean;
  canRecordOccupancy: boolean;
  leases: { id: string; reference: string | null; status: string; startDate: string; endDate: string; tenantName: string }[] | null;
  requests: { id: string; title: string; status: string; priority: string; reportedAt: Date }[] | null;
  workOrders: { id: string; title: string; status: string; scheduledFor: string | null }[] | null;
};

export async function getPmUnit(db: Db, actor: Actor, unitId: string): Promise<UnitDetail> {
  const uid = f.id(unitId);
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireManagement(c, actor, "property.view");
    const [unit] = await selectUnits(c, ctx, { unitId: uid });
    if (!unit) throw new IdentityError("not_found");
    const leases = can(ctx, "lease.view")
      ? (await c.query(
          `select l.id, l.reference, l.status, l.start_date::text as s, l.end_date::text as e, t.display_name
             from app.pm_leases l join app.pm_tenants t on t.id = l.tenant_id where l.unit_id = $1 order by l.start_date desc`,
          [uid],
        )).rows.map((r) => ({ id: r.id, reference: r.reference, status: r.status, startDate: r.s, endDate: r.e, tenantName: r.display_name }))
      : null;
    const requests = can(ctx, "tenant_request.view")
      ? (await c.query("select id, title, status, priority, reported_at from app.pm_requests where unit_id = $1 order by reported_at desc limit 50", [uid])).rows.map((r) => ({
          id: r.id,
          title: r.title,
          status: r.status,
          priority: r.priority,
          reportedAt: r.reported_at,
        }))
      : null;
    const workOrders = can(ctx, "maintenance.view")
      ? (await c.query("select id, title, status, scheduled_for::text as d from app.pm_work_orders where unit_id = $1 order by created_at desc limit 50", [uid])).rows.map((r) => ({
          id: r.id,
          title: r.title,
          status: r.status,
          scheduledFor: r.d,
        }))
      : null;
    return { ...unit, canEditDetails: can(ctx, "property.manage"), canRecordOccupancy: can(ctx, "property.manage") || can(ctx, "lease.manage"), leases, requests, workOrders };
  });
}

/** Active staff in the organization, for assignment pickers. */
export async function listStaff(db: Db, actor: Actor): Promise<{ id: string; name: string; role: string }[]> {
  return withAppTx(db, actor, async (c) => {
    await requireManagement(c, actor, "property.view");
    const { rows } = await c.query(
      `select u.id, u.display_name, m.role from app.memberships m join app.users u on u.id = m.user_id
        where m.org_id = app.current_org_id() and m.status = 'active' order by u.display_name`,
    );
    return rows.map((r) => ({ id: r.id, name: r.display_name, role: r.role }));
  });
}
