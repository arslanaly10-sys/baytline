import { LEASE_RULE_CATEGORIES, LEASE_STATUSES, PAYMENT_FREQUENCIES, type LeaseStatus, type PaymentFrequency } from "@baytline/core";
import { withAppTx, type Client, type Db } from "@baytline/db";
import type { Actor } from "@baytline/identity";
import { audit, can, f, IdentityError, like, mapDbError, requireManagement } from "./guard";

/**
 * Leases store contract details as recorded by staff: dates, reference, rent, currency,
 * frequency and payment terms in the contract's own words. Nothing here is checked against
 * local tenancy rules; those are configured per market (Platform > Markets) and shown
 * on each lease with their setup status.
 */
export type LeaseRow = {
  id: string;
  unitId: string;
  unitCode: string;
  propertyId: string;
  propertyName: string;
  tenantId: string;
  tenantName: string;
  reference: string | null;
  status: LeaseStatus;
  startDate: string;
  endDate: string;
  renewalDate: string | null;
  rentMinor: string | null;
  currency: string;
  paymentFrequency: PaymentFrequency | null;
  daysToEnd: number;
  daysToRenewal: number | null;
};

export type LeaseSearch = { status?: string; propertyId?: string; unitId?: string; q?: string; endingWithin?: number; renewalWithin?: number };

const LEASE_SELECT = `
  select l.*, l.start_date::text as s, l.end_date::text as e, l.renewal_date::text as r, l.rent_minor::text as rent, l.deposit_minor::text as deposit,
         u.code as unit_code, u.property_id, p.name as property_name, p.market, t.display_name as tenant_name,
         (l.end_date - (now() at time zone mk.time_zone)::date)::int as days_to_end,
         (l.renewal_date - (now() at time zone mk.time_zone)::date)::int as days_to_renewal
    from app.pm_leases l
    join app.pm_units u on u.id = l.unit_id
    join app.pm_properties p on p.id = u.property_id
    join app.markets mk on mk.code = p.market
    join app.pm_tenants t on t.id = l.tenant_id`;

function mapLease(r: Record<string, any>): LeaseRow {
  return {
    id: r.id,
    unitId: r.unit_id,
    unitCode: r.unit_code,
    propertyId: r.property_id,
    propertyName: r.property_name,
    tenantId: r.tenant_id,
    tenantName: r.tenant_name,
    reference: r.reference,
    status: r.status,
    startDate: r.s,
    endDate: r.e,
    renewalDate: r.r,
    rentMinor: r.rent,
    currency: r.currency,
    paymentFrequency: r.payment_frequency,
    daysToEnd: r.days_to_end,
    daysToRenewal: r.days_to_renewal,
  };
}

export async function listLeases(db: Db, actor: Actor, s: LeaseSearch = {}): Promise<LeaseRow[]> {
  return withAppTx(db, actor, async (c) => {
    await requireManagement(c, actor, "lease.view");
    const where = ["l.org_id = app.current_org_id()"];
    const args: unknown[] = [];
    if (s.status && (LEASE_STATUSES as readonly string[]).includes(s.status)) where.push(`l.status = $${args.push(s.status)}`);
    if (s.propertyId) where.push(`u.property_id = $${args.push(f.id(s.propertyId))}`);
    if (s.unitId) where.push(`l.unit_id = $${args.push(f.id(s.unitId))}`);
    if (s.q?.trim()) {
      const n = args.push(like(s.q));
      where.push(`(t.display_name ilike $${n} or l.reference ilike $${n} or u.code ilike $${n})`);
    }
    const today = "(now() at time zone mk.time_zone)::date";
    if (s.endingWithin) where.push(`l.status in ('active','renewed') and l.end_date between ${today} and ${today} + $${args.push(Math.min(Math.max(s.endingWithin, 1), 730))}::int`);
    if (s.renewalWithin) where.push(`l.status in ('active','renewed') and l.renewal_date between ${today} and ${today} + $${args.push(Math.min(Math.max(s.renewalWithin, 1), 730))}::int`);
    const order = s.renewalWithin ? "l.renewal_date" : s.endingWithin ? "l.end_date" : "(l.status in ('active','renewed')) desc, l.end_date";
    const { rows } = await c.query(`${LEASE_SELECT} where ${where.join(" and ")} order by ${order} limit 1000`, args);
    return rows.map(mapLease);
  });
}

export type LeaseRuleStatus = { category: (typeof LEASE_RULE_CATEGORIES)[number]; status: "needs_setup" | "configured" };

export type LeaseDetail = LeaseRow & {
  paymentTerms: string | null;
  depositMinor: string | null;
  notes: string | null;
  market: string;
  /** Present only for roles allowed to see tenant contact details. */
  contact: { email: string | null; phone: string | null } | null;
  canSeeContact: boolean;
  canManage: boolean;
  unitOccupancy: string | null;
  rules: LeaseRuleStatus[];
  createdAt: Date;
  createdByName: string | null;
  updatedAt: Date | null;
};

export async function getLease(db: Db, actor: Actor, leaseId: string): Promise<LeaseDetail> {
  const lid = f.id(leaseId);
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireManagement(c, actor, "lease.view");
    const { rows } = await c.query(
      `${LEASE_SELECT.replace("from app.pm_leases l", ", u.occupancy as unit_occupancy, cu.display_name as created_by_name from app.pm_leases l left join app.users cu on cu.id = l.created_by")}
       where l.id = $1 and l.org_id = app.current_org_id()`,
      [lid],
    );
    const r = rows[0];
    if (!r) throw new IdentityError("not_found");
    const canSeeContact = can(ctx, "tenant.contact.view");
    // Database RLS also hides this table from other roles; the service doesn't even ask.
    const contact = canSeeContact
      ? ((await c.query("select email, phone from app.pm_tenant_contacts where tenant_id = $1", [r.tenant_id])).rows[0] ?? { email: null, phone: null })
      : null;
    const { rows: rules } = await c.query("select category, status from app.market_rules where market = $1 and category = any($2) order by category", [
      r.market,
      [...LEASE_RULE_CATEGORIES],
    ]);
    return {
      ...mapLease(r),
      paymentTerms: r.payment_terms,
      depositMinor: r.deposit,
      notes: r.notes,
      market: r.market,
      contact,
      canSeeContact,
      canManage: can(ctx, "lease.manage"),
      unitOccupancy: can(ctx, "occupancy.view") ? r.unit_occupancy : null,
      rules,
      createdAt: r.created_at,
      createdByName: r.created_by_name,
      updatedAt: r.updated_at,
    };
  });
}

export type LeaseInput = {
  reference?: unknown;
  status: unknown;
  startDate: unknown;
  endDate: unknown;
  renewalDate?: unknown;
  rent?: unknown;
  currency?: unknown;
  paymentFrequency?: unknown;
  paymentTerms?: unknown;
  deposit?: unknown;
  notes?: unknown;
};

function validateLease(i: LeaseInput, defaultCurrency: string) {
  const start = f.reqDate(i.startDate, "start_date");
  const end = f.reqDate(i.endDate, "end_date");
  if (end < start) throw new IdentityError("invalid_input", "end_before_start");
  const currency = i.currency ? f.currency(i.currency) : defaultCurrency;
  return {
    reference: f.opt(i.reference, 120, "reference"),
    status: f.oneOf(i.status, LEASE_STATUSES, "status"),
    start_date: start,
    end_date: end,
    renewal_date: f.optDate(i.renewalDate, "renewal_date"),
    rent_minor: f.parseMoney(i.rent, currency, "rent"),
    currency,
    payment_frequency: i.paymentFrequency ? f.oneOf(i.paymentFrequency, PAYMENT_FREQUENCIES, "payment_frequency") : null,
    payment_terms: f.opt(i.paymentTerms, 500, "payment_terms", true),
    deposit_minor: f.parseMoney(i.deposit, currency, "deposit"),
    notes: f.opt(i.notes, 2000, "notes", true),
  };
}

const LIVE = ["active", "renewed"];

/** One unit can't have two live leases over overlapping dates. Checked under a row lock on the unit. */
async function assertNoOverlap(c: Client, unitId: string, start: string, end: string, status: string, exceptId?: string) {
  if (!LIVE.includes(status)) return;
  await c.query("select 1 from app.pm_units where id = $1 for update", [unitId]);
  const { rowCount } = await c.query(
    `select 1 from app.pm_leases where unit_id = $1 and status in ('active','renewed') and ($4::uuid is null or id <> $4)
       and daterange(start_date, end_date, '[]') && daterange($2::date, $3::date, '[]')`,
    [unitId, start, end, exceptId ?? null],
  );
  if (rowCount) throw new IdentityError("conflict", "lease_overlap");
}

async function unitMarketCurrency(c: Client, unitId: string): Promise<string> {
  const { rows } = await c.query(
    "select mk.currency from app.pm_units u join app.pm_properties p on p.id = u.property_id join app.markets mk on mk.code = p.market where u.id = $1",
    [unitId],
  );
  if (!rows[0]) throw new IdentityError("not_found");
  return rows[0].currency;
}

export type NewTenant = { name: unknown; email?: unknown; phone?: unknown };

function validateContact(t: { email?: unknown; phone?: unknown }) {
  const email = typeof t.email === "string" && t.email.trim() ? t.email.trim().toLowerCase() : null;
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new IdentityError("invalid_input", "tenant_email");
  const phone = typeof t.phone === "string" && t.phone.trim() ? t.phone.trim() : null;
  if (phone && !/^\+?[0-9 ()-]{6,24}$/.test(phone)) throw new IdentityError("invalid_input", "tenant_phone");
  return { email, phone };
}

export async function listTenants(db: Db, actor: Actor): Promise<{ id: string; name: string }[]> {
  return withAppTx(db, actor, async (c) => {
    await requireManagement(c, actor, "property.view");
    return (await c.query("select id, display_name as name from app.pm_tenants where org_id = app.current_org_id() order by display_name")).rows;
  });
}

/** Creates a lease for an existing tenant, or records a new tenant (and their contact details) with it. */
export async function createLease(db: Db, actor: Actor, input: LeaseInput & { unitId: unknown; tenantId?: unknown; newTenant?: NewTenant }): Promise<string> {
  const unitId = f.id(input.unitId);
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireManagement(c, actor, "lease.manage");
    const v = validateLease(input, await unitMarketCurrency(c, unitId));
    let tenantId: string;
    if (input.tenantId) {
      tenantId = f.id(input.tenantId);
      const t = await c.query("select 1 from app.pm_tenants where id = $1", [tenantId]);
      if (!t.rowCount) throw new IdentityError("invalid_input", "tenant");
    } else {
      const name = f.req(input.newTenant?.name, 160, "tenant_name");
      const contact = validateContact(input.newTenant ?? {});
      const { rows } = await c.query<{ id: string }>("insert into app.pm_tenants (org_id, display_name, created_by) values (app.current_org_id(), $1, $2) returning id", [name, actor.userId]);
      tenantId = rows[0]!.id;
      await audit(c, actor, { type: "tenant.created", target: { type: "tenant", id: tenantId } });
      if (contact.email || contact.phone) {
        if (!can(ctx, "tenant.contact.view")) throw new IdentityError("forbidden", "tenant.contact.view");
        await c.query("insert into app.pm_tenant_contacts (tenant_id, org_id, email, phone, updated_by) values ($1, app.current_org_id(), $2, $3, $4)", [tenantId, contact.email, contact.phone, actor.userId]);
      }
    }
    await assertNoOverlap(c, unitId, v.start_date, v.end_date, v.status);
    try {
      await c.query("savepoint s");
      const { rows } = await c.query<{ id: string }>(
        `insert into app.pm_leases (org_id, unit_id, tenant_id, reference, status, start_date, end_date, renewal_date, rent_minor, currency,
                payment_frequency, payment_terms, deposit_minor, notes, created_by)
         values (app.current_org_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id`,
        [unitId, tenantId, v.reference, v.status, v.start_date, v.end_date, v.renewal_date, v.rent_minor?.toString() ?? null, v.currency,
          v.payment_frequency, v.payment_terms, v.deposit_minor?.toString() ?? null, v.notes, actor.userId],
      );
      await audit(c, actor, { type: "lease.created", target: { type: "lease", id: rows[0]!.id }, metadata: { status: v.status } });
      return rows[0]!.id;
    } catch (e) {
      return mapDbError(c, e);
    }
  });
}

export async function updateLease(db: Db, actor: Actor, leaseId: string, input: LeaseInput): Promise<string[]> {
  const lid = f.id(leaseId);
  return withAppTx(db, actor, async (c) => {
    await requireManagement(c, actor, "lease.manage");
    const { rows } = await c.query(
      "select *, start_date::text as s, end_date::text as e, renewal_date::text as r, rent_minor::text as rent, deposit_minor::text as dep from app.pm_leases where id = $1 for update",
      [lid],
    );
    const b = rows[0];
    if (!b) throw new IdentityError("not_found");
    const v = validateLease(input, b.currency);
    await assertNoOverlap(c, b.unit_id, v.start_date, v.end_date, v.status, lid);
    const prev: Record<string, unknown> = { ...b, start_date: b.s, end_date: b.e, renewal_date: b.r, rent_minor: b.rent, deposit_minor: b.dep };
    const changed = (Object.keys(v) as (keyof typeof v)[]).filter((k) => String(prev[k] ?? "") !== String(v[k] ?? ""));
    if (!changed.length) return [];
    await c.query(
      `update app.pm_leases set reference = $2, status = $3, start_date = $4, end_date = $5, renewal_date = $6, rent_minor = $7, currency = $8,
              payment_frequency = $9, payment_terms = $10, deposit_minor = $11, notes = $12, updated_at = now(), updated_by = $13 where id = $1`,
      [lid, v.reference, v.status, v.start_date, v.end_date, v.renewal_date, v.rent_minor?.toString() ?? null, v.currency, v.payment_frequency,
        v.payment_terms, v.deposit_minor?.toString() ?? null, v.notes, actor.userId],
    );
    await audit(c, actor, {
      type: "lease.updated",
      target: { type: "lease", id: lid },
      metadata: { fields: changed.join(","), ...(changed.includes("status") ? { statusFrom: b.status, statusTo: v.status } : {}) },
    });
    return changed;
  });
}

/** Only contact-authorized roles can see or change contact details. */
export async function updateTenantContact(db: Db, actor: Actor, tenantId: string, input: { email?: unknown; phone?: unknown }): Promise<void> {
  const tid = f.id(tenantId);
  const contact = validateContact(input);
  await withAppTx(db, actor, async (c) => {
    await requireManagement(c, actor, "tenant.contact.view");
    await requireManagement(c, actor, "lease.manage");
    const t = await c.query("select 1 from app.pm_tenants where id = $1", [tid]);
    if (!t.rowCount) throw new IdentityError("not_found");
    await c.query(
      `insert into app.pm_tenant_contacts (tenant_id, org_id, email, phone, updated_by) values ($1, app.current_org_id(), $2, $3, $4)
       on conflict (tenant_id) do update set email = excluded.email, phone = excluded.phone, updated_at = now(), updated_by = excluded.updated_by`,
      [tid, contact.email, contact.phone, actor.userId],
    );
    // No contact values in the audit trail: only that they changed.
    await audit(c, actor, { type: "tenant.contact_updated", target: { type: "tenant", id: tid } });
  });
}
