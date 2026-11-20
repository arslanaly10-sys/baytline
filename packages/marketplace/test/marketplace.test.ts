import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { LEAD_ROLES, PUBLISH_ROLES, SUPPORT_ROLES, VIEWING_ROLES } from "@baytline/core";
import { createDb, withAppTx, type Db } from "@baytline/db";
import { createOrganization, ensurePersonalWorkspace, IdentityError, inviteMember, signUpCustomer, signUpFromInvitation } from "@baytline/identity";
import { createBootstrapInvitation } from "../../identity/src/bootstrap";
import {
  createPlan, createPlanVersion, createPriceList, createPriceVersion, createProject, createUnit, decidePlanVersion, decidePriceVersion,
  grantShare, savePhase, savePlanDraft, savePriceDraft, submitPlanVersion, submitPriceVersion, verifyUnit,
} from "../../developer/src";
import { createPmUnit, createProperty, updatePmUnit } from "../../management/src";
import {
  answerSupportRequest, cancelAppointment, compareListings, confirmAppointment, confirmRental, declineAppointment, getProjectPublication,
  getPublicProject, getPublicRental, listInbox, listMyRequests, listSupportQueue, parseCompareRefs, publishProject, publishRental,
  searchListings, setEnquiryStatus, submitAppointment, submitEnquiry, submitSupportRequest, unitAvailability, validateSlots, withdrawProject, withdrawRental,
} from "../src";

let db: Db;
const PW = "a long test passphrase";
type A = { userId: string; orgId: string };
const u = {} as Record<"ops" | "support" | "devAdmin" | "inv" | "fin" | "sales" | "brk" | "brk2" | "pmAdmin" | "pmMaint" | "alice" | "bob" | "devB", A>;
const f = {} as { project: string; unitA: string; unitB: string; unitDraft: string; unitHidden: string; sampleProject: string; pmUnit: string; pmUnit2: string };

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof IdentityError ? `${e.code}${e.detail ? `:${e.detail}` : ""}` : `other:${(e as Error).message}`;
  }
};
const raw = <T = Record<string, unknown>>(a: A, sql: string, args: unknown[] = []) => withAppTx(db, a, async (c) => (await c.query(sql, args)).rows as T[]);
async function join(token: string, name: string, orgId: string): Promise<A> {
  return { userId: (await signUpFromInvitation(db, { token, password: PW, displayName: name, locale: "en" })).userId, orgId };
}
async function customer(email: string, name: string): Promise<A> {
  const s = await signUpCustomer(db, { email, password: PW, displayName: name, locale: "en" });
  return { userId: s.userId, orgId: await ensurePersonalWorkspace(db, { id: s.userId, displayName: name }) };
}
const isoIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const contact = { name: "Alice Sample", preferredContact: "email", consent: true };

beforeAll(async () => {
  db = createDb();
  const boot = await createBootstrapInvitation(process.env.DATABASE_OWNER_URL!, { email: "ops@example.test" });
  u.ops = await join(boot.token, "Ops", boot.orgId);
  u.support = await join((await inviteMember(db, u.ops, { email: "support@example.test", role: "platform_support" })).token, "Support", boot.orgId);

  const dev = await createOrganization(db, u.ops, { type: "developer", name: "Developer A", market: "SA", adminEmail: "dev@example.test" });
  u.devAdmin = await join(dev.token, "Dev admin", dev.orgId);
  for (const [k, role] of [["inv", "developer_inventory_manager"], ["fin", "developer_finance"], ["sales", "developer_sales_manager"]] as const) {
    u[k] = await join((await inviteMember(db, u.devAdmin, { email: `${k}@example.test`, role })).token, k, dev.orgId);
  }
  const devB = await createOrganization(db, u.ops, { type: "developer", name: "Developer B", market: "SA", adminEmail: "devb@example.test" });
  u.devB = await join(devB.token, "Dev B", devB.orgId);
  const brk = await createOrganization(db, u.ops, { type: "brokerage", name: "Brokerage X", market: "SA", adminEmail: "brk@example.test" });
  u.brk = await join(brk.token, "Broker", brk.orgId);
  const brk2 = await createOrganization(db, u.ops, { type: "brokerage", name: "Brokerage Y", market: "SA", adminEmail: "brk2@example.test" });
  u.brk2 = await join(brk2.token, "Broker 2", brk2.orgId);
  const pm = await createOrganization(db, u.ops, { type: "property_manager", name: "Manager A", market: "AE", adminEmail: "pm@example.test" });
  u.pmAdmin = await join(pm.token, "PM admin", pm.orgId);
  u.pmMaint = await join((await inviteMember(db, u.pmAdmin, { email: "maint@example.test", role: "pm_maintenance_coordinator" })).token, "Maint", pm.orgId);
  u.alice = await customer("alice@example.test", "Alice");
  u.bob = await customer("bob@example.test", "Bob");

  // Developer inventory: one verified available unit with an approved price and plan, one unverified, one draft, one not selected.
  f.project = await createProject(db, u.inv, { name: "Palm Tower", market: "SA", city: "Riyadh", location: "North district", propertyTypes: ["apartment", "villa"], launchDate: "2026-01-10", handoverDate: "2028-12-31", status: "launched" });
  const phase = await savePhase(db, u.inv, f.project, { kind: "building", name: "Tower A", sortOrder: 1, expectedHandover: "2028-06-30" });
  f.unitA = await createUnit(db, u.inv, f.project, { code: "A-101", phaseId: phase, propertyType: "apartment", bedrooms: "2", areaSqm: "118.5", floor: "1", status: "available" });
  f.unitB = await createUnit(db, u.inv, f.project, { code: "A-102", phaseId: phase, propertyType: "apartment", bedrooms: "1", areaSqm: "70", floor: "1", status: "available" });
  f.unitDraft = await createUnit(db, u.inv, f.project, { code: "A-PH1", phaseId: phase, propertyType: "villa", bedrooms: "4", status: "draft" });
  f.unitHidden = await createUnit(db, u.inv, f.project, { code: "A-201", phaseId: phase, propertyType: "apartment", bedrooms: "3", status: "available" });
  await verifyUnit(db, u.inv, f.unitA);
  const list = await createPriceList(db, u.inv, f.project, { name: "Launch" });
  const v1 = await createPriceVersion(db, u.inv, list, { effectiveFrom: "2026-01-01" });
  await savePriceDraft(db, u.inv, v1, { effectiveFrom: "2026-01-01", prices: { [f.unitA]: "1250000", [f.unitB]: "700000", [f.unitHidden]: "900000" } });
  await submitPriceVersion(db, u.inv, v1);
  await decidePriceVersion(db, u.fin, v1, "approve");
  const plan = await createPlan(db, u.inv, f.project, { name: "Standard plan" });
  const pv = await createPlanVersion(db, u.inv, plan, { effectiveFrom: "2026-01-01" });
  await savePlanDraft(db, u.inv, pv, { currency: "SAR", effectiveFrom: "2026-01-01", handoverTerms: "As stated in the sales agreement.", milestones: [
    { label: "Booking", trigger: "on_booking", percent: "20" }, { label: "Handover", trigger: "on_handover", percent: "80" },
  ] });
  await submitPlanVersion(db, u.inv, pv);
  await decidePlanVersion(db, u.fin, pv, "approve");
  await grantShare(db, u.sales, { projectId: f.project, brokerageId: u.brk.orgId, includePricing: false, includeDocuments: false });

  // A sample project (as seeded for development) can never be published.
  const owner = new pg.Client({ connectionString: process.env.DATABASE_OWNER_URL });
  await owner.connect();
  f.sampleProject = (await owner.query("insert into app.projects (org_id, name, market, city, property_types, is_sample) values ($1, 'Sample', 'SA', 'X', '{apartment}', true) returning id", [u.devAdmin.orgId])).rows[0].id;
  await owner.end();

  // Property manager: one vacant unit, one occupied.
  const prop = await createProperty(db, u.pmAdmin, { name: "Creek Court", market: "AE", city: "Dubai", propertyType: "residential_building", managementBasis: "full_management" });
  f.pmUnit = await createPmUnit(db, u.pmAdmin, prop, { code: "C-1", unitType: "apartment", bedrooms: "2", areaSqm: "100", occupancy: "vacant" });
  f.pmUnit2 = await createPmUnit(db, u.pmAdmin, prop, { code: "C-2", unitType: "apartment", bedrooms: "1", occupancy: "occupied" });
});
afterAll(async () => {
  await db.app.end();
  await db.auth.end();
});

describe("role lists", () => {
  it("match the database", async () => {
    const [r] = await raw<{ l: string[]; v: string[]; p: string[]; s: string[] }>(u.alice, "select app.lead_roles() l, app.viewing_roles() v, app.publish_roles() p, app.support_roles() s");
    expect([...r!.l].sort()).toEqual(LEAD_ROLES);
    expect([...r!.v].sort()).toEqual(VIEWING_ROLES);
    expect([...r!.p].sort()).toEqual(PUBLISH_ROLES);
    expect([...r!.s].sort()).toEqual(SUPPORT_ROLES);
  });
});

describe("availability wording", () => {
  const base = { status: "available", sourceKind: "partner_portal" as const, verification: "verified" as const, lastUpdatedAt: new Date() };
  const now = new Date();
  it("calls a unit available only when the owner confirmed it recently", () => {
    expect(unitAvailability({ ...base, lastVerifiedAt: new Date(now.getTime() - 3600_000) }, now).state).toBe("available_confirmed");
    expect(unitAvailability({ ...base, lastVerifiedAt: new Date(now.getTime() - 3 * 86_400_000) }, now).state).toBe("stale");
    expect(unitAvailability({ ...base, verification: "owner_reported", lastVerifiedAt: null }, now).state).toBe("available_unconfirmed");
    expect(unitAvailability({ ...base, verification: "disputed", lastVerifiedAt: null }, now).state).toBe("disputed");
    expect(unitAvailability({ ...base, status: "reserved", lastVerifiedAt: null }, now).state).toBe("reserved");
  });
});

describe("publishing", () => {
  it("shows nothing until someone authorized publishes it", async () => {
    expect((await searchListings(db, {})).purpose).toBe("buy");
    expect(await searchListings(db, {})).toMatchObject({ projects: [] });
    expect(await code(getPublicProject(db, f.project))).toBe("not_found");
    expect(await code(publishProject(db, u.inv, f.project, { unitIds: [f.unitA], showPrices: true, showPaymentPlans: true }))).toBe("forbidden:listing.publish");
    expect(await code(publishProject(db, u.devAdmin, f.sampleProject, { unitIds: [], showPrices: false, showPaymentPlans: false }))).toBe("invalid_input:sample_not_publishable");
    expect(await code(publishProject(db, u.devB, f.project, { unitIds: [], showPrices: false, showPaymentPlans: false }))).toBe("not_found");
    expect(await code(publishProject(db, u.sales, f.project, { unitIds: [f.unitA], showPrices: true, showPaymentPlans: true, routeBrokerageOrgId: u.brk2.orgId }))).toBe("invalid_input:route_not_shared");
    await publishProject(db, u.sales, f.project, { unitIds: [f.unitA, f.unitB, f.unitDraft], showPrices: false, showPaymentPlans: false });
    const pub = await getProjectPublication(db, u.inv, f.project);
    expect(pub).toMatchObject({ status: "published", canPublish: false, publishedByName: "sales" });
  });

  it("lists only chosen, non-draft units; prices and plans only when chosen", async () => {
    let p = await getPublicProject(db, f.project);
    expect(p.units.map((x) => x.code).sort()).toEqual(["A-101", "A-102"]); // draft and unselected left out
    expect(p.units.every((x) => x.price === null)).toBe(true);
    expect(p.plans).toEqual([]);
    await publishProject(db, u.sales, f.project, { unitIds: [f.unitA, f.unitB], showPrices: true, showPaymentPlans: true });
    p = await getPublicProject(db, f.project);
    const a = p.units.find((x) => x.code === "A-101")!;
    const b = p.units.find((x) => x.code === "A-102")!;
    expect(a.price).toMatchObject({ minor: "125000000", currency: "SAR" });
    expect(a.availability.state).toBe("available_confirmed");
    expect(b.availability.state).toBe("available_unconfirmed"); // never verified: not described as available
    expect(a.handover).toEqual({ date: "2028-06-30", basis: "phase" });
    expect(p.plans[0]).toMatchObject({ name: "Standard plan", currency: "SAR" });
    expect(p.plans[0]!.milestones.map((m) => m.label)).toEqual(["Booking", "Handover"]);
    expect(JSON.stringify(p)).not.toContain("source_ref");
  });

  it("filters by market, area, type, bedrooms, price and confirmed availability", async () => {
    const one = async (s: Parameters<typeof searchListings>[1]) => {
      const r = await searchListings(db, s);
      return r.purpose === "buy" ? r.projects.map((x) => [x.name, x.matchingUnits, x.confirmedAvailable]) : [];
    };
    expect(await one({})).toEqual([["Palm Tower", 2, 1]]);
    expect(await one({ market: "AE" })).toEqual([]);
    expect(await one({ q: "north" })).toEqual([["Palm Tower", 2, 1]]);
    expect(await one({ type: "villa" })).toEqual([]);
    expect(await one({ minBedrooms: "2" })).toEqual([["Palm Tower", 1, 1]]);
    expect(await one({ availability: "confirmed" })).toEqual([["Palm Tower", 1, 1]]);
    expect((await searchListings(db, { minPrice: "800000" })).priceFilter).toBe("needs_market");
    expect(await one({ market: "SA", maxPrice: "800000" })).toEqual([["Palm Tower", 1, 0]]);
    expect(await code(searchListings(db, { market: "SA", maxPrice: "abc" }))).toMatch(/^invalid_input/);
  });

  it("publishes rentals only for vacant units and hides them once occupied", async () => {
    expect(await code(publishRental(db, u.pmMaint, f.pmUnit, { rent: "90000", paymentFrequency: "annual" }))).toBe("forbidden:listing.publish");
    expect(await code(publishRental(db, u.pmAdmin, f.pmUnit2, { rent: "50000", paymentFrequency: "annual" }))).toBe("invalid_input:rental_not_vacant");
    await publishRental(db, u.pmAdmin, f.pmUnit, { rent: "90000", paymentFrequency: "annual", availableFrom: isoIn(10), areaLabel: "Creek district" });
    const r = await getPublicRental(db, f.pmUnit);
    expect(r).toMatchObject({ rent: { minor: "9000000", currency: "AED", frequency: "annual" }, areaLabel: "Creek district" });
    expect(r.availability.state).toBe("available_confirmed");
    const s = await searchListings(db, { purpose: "rent", market: "AE", maxPrice: "100000" });
    expect(s.purpose === "rent" && s.rentals.map((x) => x.id)).toEqual([f.pmUnit]);
    await confirmRental(db, u.pmAdmin, f.pmUnit);
    await updatePmUnit(db, u.pmAdmin, f.pmUnit, { code: "C-1", unitType: "apartment", bedrooms: "2", areaSqm: "100", occupancy: "occupied" });
    expect(await code(getPublicRental(db, f.pmUnit))).toBe("not_found");
    await updatePmUnit(db, u.pmAdmin, f.pmUnit, { code: "C-1", unitType: "apartment", bedrooms: "2", areaSqm: "100", occupancy: "vacant" });
    expect((await getPublicRental(db, f.pmUnit)).id).toBe(f.pmUnit);
  });
});

describe("comparison", () => {
  it("marks confirmed, reported, estimated and missing facts", async () => {
    const refs = parseCompareRefs(`unit:${f.unitA},unit:${f.unitB},rental:${f.pmUnit},unit:${f.unitA},junk,unit:${f.unitHidden}`);
    expect(refs.length).toBe(4);
    const items = await compareListings(db, refs);
    expect(items.map((i) => i.ref)).toEqual([`unit:${f.unitA}`, `unit:${f.unitB}`, `rental:${f.pmUnit}`]); // unpublished unit dropped
    const [a, b, r] = items;
    expect(a!.price.basis).toBe("confirmed");
    expect(a!.bedrooms).toEqual({ value: 2, basis: "confirmed" }); // verified unit
    expect(b!.bedrooms).toEqual({ value: 1, basis: "owner_reported" });
    expect(a!.handover.basis).toBe("estimate");
    expect(a!.paymentPlans.basis).toBe("confirmed");
    expect(a!.lease.basis).toBe("missing");
    expect(r!.price.basis).toBe("owner_reported");
    expect(r!.handover.basis).toBe("missing");
    expect(r!.lease.value).toMatchObject({ frequency: "annual" });
  });
});

describe("enquiries", () => {
  it("needs consent, a phone for phone contact, and a signed-in customer", async () => {
    const e = { listingKind: "unit", listingId: f.unitA, source: "listing_page", locale: "en" as const };
    expect(await code(submitEnquiry(db, u.alice, { ...e, ...contact, consent: false }))).toBe("invalid_input:consent");
    expect(await code(submitEnquiry(db, u.alice, { ...e, ...contact, preferredContact: "whatsapp" }))).toBe("invalid_input:phone_required");
    expect(await code(submitEnquiry(db, u.devAdmin, { ...e, ...contact }))).toBe("not_found"); // not a personal workspace
    expect(await code(submitEnquiry(db, u.alice, { ...e, ...contact, listingId: f.unitHidden }))).toBe("not_found");
  });

  it("routes to the developer by default and records source and time", async () => {
    const id = await submitEnquiry(db, u.alice, { listingKind: "unit", listingId: f.unitA, source: "compare_page", locale: "ar", ...contact, message: "Is parking included?" });
    const [row] = await raw<Record<string, unknown>>(u.alice, "select * from app.customer_enquiries where id = $1", [id]);
    expect(row).toMatchObject({ routed_org_id: u.devAdmin.orgId, contact_email: "alice@example.test", source: "compare_page", locale: "ar", listing_title: "Palm Tower · A-101", status: "new" });
    expect(row!.consent_at).toBeInstanceOf(Date);
    const inbox = await listInbox(db, u.sales);
    expect(inbox.enquiries.map((x) => x.id)).toEqual([id]);
    expect(inbox.enquiries[0]!.contactEmail).toBe("alice@example.test");
  });

  it("routes to the named brokerage when it holds an active share", async () => {
    await publishProject(db, u.sales, f.project, { unitIds: [f.unitA, f.unitB], showPrices: true, showPaymentPlans: true, routeBrokerageOrgId: u.brk.orgId });
    const id = await submitEnquiry(db, u.bob, { listingKind: "project", listingId: f.project, source: "listing_page", locale: "en", name: "Bob", preferredContact: "phone", phone: "+966 50 000 0000", consent: true });
    expect((await listInbox(db, u.brk)).enquiries.map((x) => x.id)).toEqual([id]);
    expect((await listInbox(db, u.sales)).enquiries.map((x) => x.id)).not.toContain(id); // routed elsewhere
  });

  it("keeps customer details away from everyone else", async () => {
    expect((await raw(u.bob, "select * from app.customer_enquiries")).length).toBe(1); // only his own
    expect(await raw(u.devB, "select * from app.customer_enquiries")).toEqual([]);
    expect(await raw(u.brk2, "select * from app.customer_enquiries")).toEqual([]);
    expect(await raw(u.inv, "select * from app.customer_enquiries")).toEqual([]); // inventory role isn't a lead role
    expect(await code(listInbox(db, u.fin))).toBe("forbidden:lead.view");
    expect(await code(raw(u.alice, "insert into app.customer_enquiries (customer_user_id, routed_org_id, listing_kind, listing_title, contact_name, contact_email, preferred_contact, locale, source, consent_at) values ($1, $2, 'unit', 'x', 'x', 'x', 'email', 'en', 'listing_page', now())", [u.alice.userId, u.devB.orgId]))).toMatch(/permission denied/);
    expect(await code(raw(u.alice, "update app.customer_enquiries set routed_org_id = $1", [u.devB.orgId]))).toMatch(/permission denied/);
  });

  it("lets the receiving organization track status", async () => {
    const [mine] = (await listMyRequests(db, u.alice)).enquiries;
    expect(await code(setEnquiryStatus(db, u.devAdmin, mine!.id, "bogus"))).toBe("invalid_input:status");
    await setEnquiryStatus(db, u.sales, mine!.id, "in_progress");
    expect((await listMyRequests(db, u.alice)).enquiries[0]!.status).toBe("in_progress");
    expect(await code(setEnquiryStatus(db, u.brk, mine!.id, "closed"))).toBe("not_found");
  });
});

describe("appointment requests", () => {
  const base = { listingKind: "rental", listingId: "", kind: "viewing", locale: "en" as const, ...contact };
  it("validates preferred times", () => {
    const today = "2026-11-20";
    expect(() => validateSlots([], today)).toThrow();
    expect(() => validateSlots([{ date: "2026-11-19", period: "morning" }], today)).toThrow();
    expect(() => validateSlots([{ date: "2027-03-01", period: "morning" }], today)).toThrow(); // beyond 90 days
    expect(() => validateSlots([{ date: "2026-11-21", period: "night" }], today)).toThrow();
    expect(validateSlots([{ date: "2026-11-21", period: "morning" }, { date: "", period: "" }], today)).toEqual([{ date: "2026-11-21", period: "morning" }]);
  });

  it("stays pending until an authorized person confirms a time", async () => {
    const id = await submitAppointment(db, u.alice, { ...base, listingId: f.pmUnit, slots: [{ date: isoIn(3), period: "evening" }, { date: isoIn(4), period: "morning" }] });
    let mine = (await listMyRequests(db, u.alice)).appointments.find((x) => x.id === id)!;
    expect(mine).toMatchObject({ status: "pending", confirmedFor: null });
    expect(await code(confirmAppointment(db, u.pmMaint, id, { localDateTime: `${isoIn(3)}T18:00` }))).toBe("forbidden:viewing.manage");
    expect(await code(confirmAppointment(db, u.pmAdmin, id, { localDateTime: "2020-01-01T10:00" }))).toBe("invalid_input:confirmed_for");
    await confirmAppointment(db, u.pmAdmin, id, { localDateTime: `${isoIn(3)}T18:30`, note: "Ask for the building manager." });
    mine = (await listMyRequests(db, u.alice)).appointments.find((x) => x.id === id)!;
    expect(mine.status).toBe("confirmed");
    expect(mine.confirmedFor).toBeInstanceOf(Date);
    expect(mine.orgNote).toBe("Ask for the building manager.");
    await cancelAppointment(db, u.alice, id);
    expect((await listMyRequests(db, u.alice)).appointments.find((x) => x.id === id)!.status).toBe("cancelled");
    expect(await code(cancelAppointment(db, u.bob, id))).toBe("not_found");
    expect(await code(declineAppointment(db, u.pmAdmin, id, {}))).toBe("invalid_input:appointment_closed");
  });

  it("can be declined with a note", async () => {
    const id = await submitAppointment(db, u.bob, { ...base, listingKind: "unit", listingId: f.unitB, kind: "consultation", name: "Bob", slots: [{ date: isoIn(5), period: "afternoon" }] });
    expect((await listInbox(db, u.brk)).appointments.map((x) => x.id)).toContain(id); // project routed to brokerage
    await declineAppointment(db, u.brk, id, { note: "Fully booked that week." });
    expect((await listMyRequests(db, u.bob)).appointments[0]).toMatchObject({ status: "declined", orgNote: "Fully booked that week." });
  });
});

describe("support", () => {
  it("lets customers ask and see answers; only support staff read the queue", async () => {
    const [enq] = (await listMyRequests(db, u.bob)).enquiries;
    expect(await code(submitSupportRequest(db, u.alice, { topic: "enquiry", subject: "x", message: "y", relatedEnquiryId: enq!.id, locale: "en" }))).toBe("invalid_input:related_enquiry");
    const id = await submitSupportRequest(db, u.alice, { topic: "privacy", subject: "Delete my data", message: "Please remove my enquiry details.", locale: "en" });
    expect(await code(listSupportQueue(db, u.devAdmin))).toBe("not_found");
    expect((await listSupportQueue(db, u.support)).map((x) => x.id)).toEqual([id]);
    expect(await raw(u.bob, "select * from app.support_requests")).toEqual([]);
    await answerSupportRequest(db, u.support, id, { response: "We've removed them." });
    expect((await listMyRequests(db, u.alice)).support[0]).toMatchObject({ status: "answered", response: "We've removed them." });
  });
});

describe("withdrawal", () => {
  it("removes listings from public view without touching existing requests", async () => {
    await withdrawProject(db, u.devAdmin, f.project);
    expect(await code(getPublicProject(db, f.project))).toBe("not_found");
    expect(await compareListings(db, [{ kind: "unit", id: f.unitA }])).toEqual([]);
    expect(await code(submitEnquiry(db, u.alice, { listingKind: "unit", listingId: f.unitA, source: "listing_page", locale: "en", ...contact }))).toBe("not_found");
    expect((await listMyRequests(db, u.alice)).enquiries.length).toBe(1);
    await withdrawRental(db, u.pmAdmin, f.pmUnit);
    expect(await code(getPublicRental(db, f.pmUnit))).toBe("not_found");
    const events = (await raw<{ event_type: string }>(u.devAdmin, "select event_type from app.audit_events where org_id = $1", [u.devAdmin.orgId])).map((r) => r.event_type);
    for (const t of ["listing.published", "listing.updated", "listing.withdrawn", "enquiry.received", "enquiry.status_changed"]) expect(events).toContain(t);
  });
});
