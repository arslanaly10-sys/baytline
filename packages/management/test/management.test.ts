import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withAppTx, type Db } from "@baytline/db";
import { createOrganization, IdentityError, inviteMember, signUpFromInvitation } from "@baytline/identity";
import { createBootstrapInvitation } from "../../identity/src/bootstrap";
import {
  addRequestNote,
  createLease,
  createPmUnit,
  createProperty,
  createRequest,
  createWorkOrder,
  getLease,
  getPmUnit,
  getPortfolioSummary,
  getProperty,
  getRequest,
  getWorkOrder,
  listLeases,
  listPmUnits,
  listProperties,
  listRequests,
  listWorkOrders,
  recordCompletion,
  recordVendorConfirmation,
  updateLease,
  updatePmUnit,
  updateProperty,
  updateRequest,
  updateTenantContact,
  updateWorkOrder,
} from "../src";

let db: Db;
const PW = "a long test passphrase";
type A = { userId: string; orgId: string };
const u = {} as Record<"ops" | "admin" | "leasing" | "maint" | "fin" | "otherPm" | "dev", A>;
const f = {} as { prop: string; unit1: string; unit2: string; lease: string; tenant: string; request: string; wo: string; otherProp: string; otherUnit: string };

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof IdentityError ? `${e.code}${e.detail ? `:${e.detail}` : ""}` : `other:${(e as Error).message}`;
  }
};
const raw = <T = Record<string, unknown>>(a: A, sql: string, args: unknown[] = []) =>
  withAppTx(db, a, async (c) => (await c.query(sql, args)).rows as T[]);
async function join(token: string, name: string, orgId: string): Promise<A> {
  return { userId: (await signUpFromInvitation(db, { token, password: PW, displayName: name, locale: "en" })).userId, orgId };
}
const isoIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const PROPERTY = { name: "Palm Court", market: "SA", city: "Riyadh", propertyType: "residential_building", managementBasis: "full_management" };
const UNIT = { code: "A-101", unitType: "apartment", bedrooms: "2", areaSqm: "110.5", floor: "1", occupancy: "vacant" };

beforeAll(async () => {
  db = createDb();
  const boot = await createBootstrapInvitation(process.env.DATABASE_OWNER_URL!, { email: "ops@example.test" });
  u.ops = await join(boot.token, "Ops", boot.orgId);
  const pm = await createOrganization(db, u.ops, { type: "property_manager", name: "Manager A", market: "SA", adminEmail: "pm-admin@example.test" });
  u.admin = await join(pm.token, "PM admin", pm.orgId);
  for (const [k, role] of [["leasing", "pm_leasing_manager"], ["maint", "pm_maintenance_coordinator"], ["fin", "pm_finance"]] as const) {
    const i = await inviteMember(db, u.admin, { email: `${k}@example.test`, role });
    u[k] = await join(i.token, k, pm.orgId);
  }
  const other = await createOrganization(db, u.ops, { type: "property_manager", name: "Manager B", market: "AE", adminEmail: "pm-b@example.test" });
  u.otherPm = await join(other.token, "PM B", other.orgId);
  const dev = await createOrganization(db, u.ops, { type: "developer", name: "Developer", market: "SA", adminEmail: "dev@example.test" });
  u.dev = await join(dev.token, "Dev", dev.orgId);
});
afterAll(async () => {
  await db.app.end();
  await db.auth.end();
});

describe("properties", () => {
  it("validates, and only roles with property.manage create them", async () => {
    expect(await code(createProperty(db, u.admin, { ...PROPERTY, market: "XX" }))).toBe("invalid_input:market");
    expect(await code(createProperty(db, u.admin, { ...PROPERTY, agreementStart: "2026-05-01", agreementEnd: "2026-01-01" }))).toBe("invalid_input:agreement_end");
    expect(await code(createProperty(db, u.leasing, PROPERTY))).toBe("forbidden:property.manage");
    expect(await code(createProperty(db, u.dev, PROPERTY))).toBe("not_found"); // not a property-management org
    f.prop = await createProperty(db, u.admin, { ...PROPERTY, ownerName: "Sample Owner", agreementStart: "2026-01-01", agreementEnd: "2028-12-31" });
    f.otherProp = await createProperty(db, u.otherPm, { ...PROPERTY, name: "Other", market: "AE", city: "Dubai" });
  });

  it("reports which fields changed and keeps other organizations out", async () => {
    expect(await updateProperty(db, u.admin, f.prop, { ...PROPERTY, ownerName: "Sample Owner", agreementStart: "2026-01-01", agreementEnd: "2028-12-31" })).toEqual([]);
    expect(await updateProperty(db, u.admin, f.prop, { ...PROPERTY, city: "Jeddah", ownerName: "Sample Owner", agreementStart: "2026-01-01", agreementEnd: "2028-12-31" })).toEqual(["city"]);
    expect((await listProperties(db, u.admin)).map((p) => p.name)).toEqual(["Palm Court"]);
    expect(await code(getProperty(db, u.otherPm, f.prop))).toBe("not_found");
    expect(await code(updateProperty(db, u.otherPm, f.prop, PROPERTY))).toBe("not_found");
    expect(await raw(u.otherPm, "select id from app.pm_properties where id = $1", [f.prop])).toEqual([]);
  });

  it("hides archived properties from the default list", async () => {
    const id = await createProperty(db, u.admin, { ...PROPERTY, name: "Old block" });
    await updateProperty(db, u.admin, id, { ...PROPERTY, name: "Old block", status: "archived" });
    expect((await listProperties(db, u.admin)).map((p) => p.name)).not.toContain("Old block");
    expect((await listProperties(db, u.admin, { status: "archived" })).map((p) => p.name)).toEqual(["Old block"]);
  });
});

describe("units and occupancy", () => {
  it("creates units with unique codes per property, never under another org's property", async () => {
    f.unit1 = await createPmUnit(db, u.admin, f.prop, UNIT);
    f.unit2 = await createPmUnit(db, u.admin, f.prop, { ...UNIT, code: "A-102", occupancy: "occupied" });
    expect(await code(createPmUnit(db, u.admin, f.prop, UNIT))).toBe("conflict:unit_code_taken");
    expect(await code(createPmUnit(db, u.admin, f.otherProp, { ...UNIT, code: "X" }))).toBe("not_found");
    f.otherUnit = await createPmUnit(db, u.otherPm, f.otherProp, UNIT);
  });

  it("lets leasing staff record occupancy but not edit unit details", async () => {
    expect(await code(updatePmUnit(db, u.leasing, f.unit1, { ...UNIT, bedrooms: "3" }))).toBe("forbidden:property.manage");
    expect(await updatePmUnit(db, u.leasing, f.unit1, { ...UNIT, occupancy: "notice_given" })).toEqual(["occupancy"]);
    const unit = await getPmUnit(db, u.admin, f.unit1);
    expect(unit.occupancy).toBe("notice_given");
    expect(unit.occupancyUpdatedByName).toBe("leasing");
    expect(await code(updatePmUnit(db, u.maint, f.unit1, { ...UNIT, occupancy: "vacant" }))).toBe("forbidden:lease.manage");
    await updatePmUnit(db, u.admin, f.unit1, UNIT); // back to vacant
  });

  it("doesn't show occupancy to roles without occupancy.view", async () => {
    const rows = await listPmUnits(db, u.maint, { propertyId: f.prop });
    expect(rows.map((r) => r.occupancy)).toEqual([null, null]);
    expect(rows.every((r) => r.activeLease === null)).toBe(true);
    expect((await listPmUnits(db, u.fin, { propertyId: f.prop })).map((r) => r.occupancy)).toEqual(["vacant", "occupied"]);
  });
});

describe("leases and tenant contact details", () => {
  it("stores the contract as recorded, in the market's currency by default", async () => {
    expect(await code(createLease(db, u.leasing, { unitId: f.unit1, status: "active", startDate: "2026-06-01", endDate: "2026-01-01", newTenant: { name: "T" } }))).toBe("invalid_input:end_before_start");
    expect(await code(createLease(db, u.maint, { unitId: f.unit1, status: "active", startDate: "2026-01-01", endDate: "2026-12-31", newTenant: { name: "T" } }))).toBe("forbidden:lease.manage");
    f.lease = await createLease(db, u.leasing, {
      unitId: f.unit1,
      status: "active",
      reference: "L-2026-001",
      startDate: isoIn(-200),
      endDate: isoIn(45),
      renewalDate: isoIn(20),
      rent: "60000",
      paymentFrequency: "quarterly",
      paymentTerms: "Four cheques, as written in the contract",
      newTenant: { name: "Sample Tenant", email: "Tenant@Example.test", phone: "+966 50 000 0000" },
    });
    const lease = await getLease(db, u.leasing, f.lease);
    f.tenant = lease.tenantId;
    expect(lease).toMatchObject({ currency: "SAR", rentMinor: "6000000", paymentFrequency: "quarterly", paymentTerms: "Four cheques, as written in the contract" });
    expect(lease.contact).toEqual({ email: "tenant@example.test", phone: "+966 50 000 0000" });
    expect(lease.rules.every((r) => r.status === "needs_setup" || r.status === "configured")).toBe(true);
  });

  it("refuses a second live lease over the same dates; drafts may overlap", async () => {
    const base = { unitId: f.unit1, tenantId: f.tenant, startDate: isoIn(0), endDate: isoIn(300) };
    expect(await code(createLease(db, u.leasing, { ...base, status: "active" }))).toBe("conflict:lease_overlap");
    const draft = await createLease(db, u.leasing, { ...base, status: "draft" });
    expect(await code(updateLease(db, u.leasing, draft, { ...base, status: "renewed" }))).toBe("conflict:lease_overlap");
    expect(await updateLease(db, u.leasing, draft, { ...base, status: "draft", startDate: isoIn(46) })).toEqual(["start_date"]);
  });

  it("shows contact details only to authorized roles, enforced by the database too", async () => {
    const forFinance = await getLease(db, u.fin, f.lease);
    expect(forFinance.canSeeContact).toBe(false);
    expect(forFinance.contact).toBeNull();
    expect(await raw(u.fin, "select * from app.pm_tenant_contacts")).toEqual([]);
    expect(await raw(u.maint, "select * from app.pm_tenant_contacts")).toEqual([]);
    expect((await raw(u.admin, "select email from app.pm_tenant_contacts")).length).toBe(1);
    expect(await code(listLeases(db, u.maint))).toBe("forbidden:lease.view");
    expect(await code(updateTenantContact(db, u.fin, f.tenant, { email: "x@example.test" }))).toBe("forbidden:tenant.contact.view");
    await updateTenantContact(db, u.leasing, f.tenant, { email: "new@example.test", phone: "" });
    expect((await getLease(db, u.admin, f.lease)).contact).toEqual({ email: "new@example.test", phone: null });
    const ev = await raw<{ metadata: Record<string, unknown> }>(u.admin, "select metadata from app.audit_events where event_type = 'tenant.contact_updated'");
    expect(JSON.stringify(ev)).not.toContain("example.test");
  });

  it("finds leases ending and due for renewal, and links the lease to the unit", async () => {
    expect((await listLeases(db, u.fin, { endingWithin: 90 })).map((l) => l.id)).toEqual([f.lease]);
    expect((await listLeases(db, u.fin, { renewalWithin: 10 })).map((l) => l.id)).toEqual([]);
    expect((await getPmUnit(db, u.admin, f.unit1)).activeLease?.id).toBe(f.lease);
    expect(await code(getLease(db, u.otherPm, f.lease))).toBe("not_found");
  });
});

describe("tenant requests", () => {
  it("checks unit and assignee belong to this organization", async () => {
    const base = { propertyId: f.prop, title: "AC not cooling", category: "air_conditioning", priority: "urgent" };
    expect(await code(createRequest(db, u.maint, { ...base, unitId: f.otherUnit }))).toMatch(/^(not_found|invalid_input:unit)$/);
    expect(await code(createRequest(db, u.maint, { ...base, assigneeId: u.otherPm.userId }))).toBe("invalid_input:assignee");
    expect(await code(createRequest(db, u.fin, base))).toBe("forbidden:tenant_request.manage");
    f.request = await createRequest(db, u.maint, { ...base, unitId: f.unit1, tenantId: f.tenant, assigneeId: u.maint.userId });
  });

  it("records status times on entry and clears them on reopening; notes are kept", async () => {
    const upd = { title: "AC not cooling", category: "air_conditioning", priority: "urgent", assigneeId: u.maint.userId };
    expect(await updateRequest(db, u.maint, f.request, { ...upd, status: "resolved" })).toEqual(["status"]);
    expect((await getRequest(db, u.maint, f.request)).resolvedAt).not.toBeNull();
    await updateRequest(db, u.maint, f.request, { ...upd, status: "open" });
    expect((await getRequest(db, u.maint, f.request)).resolvedAt).toBeNull();
    await addRequestNote(db, u.maint, f.request, "Tenant says it rattles at night.");
    const r = await getRequest(db, u.maint, f.request);
    expect(r.notes.map((n) => n.body)).toEqual(["Tenant says it rattles at night."]);
    expect(r.tenantName).toBe("Sample Tenant");
    expect(JSON.stringify(r)).not.toContain("example.test"); // never contact details
    expect(await code(raw(u.admin, "delete from app.pm_request_notes"))).toMatch(/append_only|permission denied/);
    expect((await listRequests(db, u.admin, { status: "open_all", priority: "urgent" })).map((x) => x.id)).toEqual([f.request]);
  });
});

describe("maintenance", () => {
  it("takes property and unit from the request, and never sets completed directly", async () => {
    expect(await code(createWorkOrder(db, u.maint, { requestId: f.request, title: "Fix AC", status: "completed" }))).toBe("invalid_input:status");
    expect(await code(createWorkOrder(db, u.maint, { requestId: f.request, title: "Fix AC", status: "scheduled" }))).toBe("invalid_input:scheduled_needs_date");
    f.wo = await createWorkOrder(db, u.maint, { requestId: f.request, title: "Fix AC", status: "scheduled", scheduledFor: isoIn(2) });
    const w = await getWorkOrder(db, u.maint, f.wo);
    expect(w).toMatchObject({ propertyId: f.prop, unitId: f.unit1, requestId: f.request, vendorConfirmed: false });
  });

  it("only treats a vendor as booked when a person records it, and resets that if the vendor changes", async () => {
    expect(await code(recordVendorConfirmation(db, u.maint, f.wo))).toBe("invalid_input:vendor_name_required");
    const base = { title: "Fix AC", status: "scheduled", scheduledFor: isoIn(2) };
    await updateWorkOrder(db, u.maint, f.wo, { ...base, vendorName: "Cool Air Co" });
    expect((await getWorkOrder(db, u.maint, f.wo)).vendorConfirmed).toBe(false);
    await recordVendorConfirmation(db, u.maint, f.wo);
    const confirmed = await getWorkOrder(db, u.maint, f.wo);
    expect(confirmed.vendorConfirmed).toBe(true);
    expect(confirmed.vendorConfirmedByName).toBe("maint");
    await updateWorkOrder(db, u.maint, f.wo, { ...base, vendorName: "Other Vendor" });
    expect((await getWorkOrder(db, u.maint, f.wo)).vendorConfirmed).toBe(false);
  });

  it("completes only with notes from a person; then the order is closed to edits", async () => {
    expect(await code(recordCompletion(db, u.maint, f.wo, { notes: "" }))).toBe("invalid_input:completion_notes");
    expect(await code(recordCompletion(db, u.fin, f.wo, { notes: "x" }))).toBe("forbidden:maintenance.manage");
    await recordCompletion(db, u.maint, f.wo, { notes: "Replaced capacitor.", cost: "350.50" });
    const done = await getWorkOrder(db, u.fin, f.wo);
    expect(done).toMatchObject({ status: "completed", costMinor: "35050", costCurrency: "SAR", completionNotes: "Replaced capacitor.", completedByName: "maint" });
    expect(await code(updateWorkOrder(db, u.maint, f.wo, { title: "Fix AC", status: "in_progress" }))).toBe("invalid_input:work_order_completed");
    expect(await code(recordCompletion(db, u.maint, f.wo, { notes: "again" }))).toBe("invalid_input:work_order_closed");
    expect((await listWorkOrders(db, u.maint, { status: "open_all" })).map((x) => x.id)).not.toContain(f.wo);
  });
});

describe("portfolio summary", () => {
  it("counts stored records, and hides blocks a role can't see", async () => {
    const s = await getPortfolioSummary(db, u.admin);
    expect(s).toMatchObject({ properties: 1, units: 2 });
    expect(s.occupancy).toMatchObject({ vacant: 1, occupied: 1, notice_given: 0 });
    expect(s.leases).toEqual({ active: 1, endingSoon: 1, renewalsDue: 1 });
    expect(s.requests).toEqual({ open: 1, urgent: 1, unassigned: 0 });
    expect(s.workOrders).toEqual({ open: 0, scheduledThisWeek: 0 });

    const forMaint = await getPortfolioSummary(db, u.maint);
    expect(forMaint.occupancy).toBeNull();
    expect(forMaint.leases).toBeNull();
    expect(forMaint.requests).not.toBeNull();
    const forFinance = await getPortfolioSummary(db, u.fin);
    expect(forFinance.requests).toBeNull();
    expect(forFinance.leases).not.toBeNull();

    const other = await getPortfolioSummary(db, u.otherPm);
    expect(other).toMatchObject({ properties: 1, units: 1, leases: { active: 0, endingSoon: 0, renewalsDue: 0 } });
  });

  it("writes an audit trail for each change", async () => {
    const types = (await raw<{ event_type: string }>(u.admin, "select distinct event_type from app.audit_events where org_id = $1", [u.admin.orgId])).map((r) => r.event_type);
    for (const t of ["pm_property.created", "pm_unit.updated", "lease.created", "tenant.created", "request.updated", "work_order.vendor_confirmed", "work_order.completed"]) {
      expect(types).toContain(t);
    }
  });
});
