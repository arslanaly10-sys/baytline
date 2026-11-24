import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createDb, withAppTx, type Db } from "@baytline/db";
import { createOrganization, IdentityError, inviteMember, signUpFromInvitation } from "@baytline/identity";
import { createBootstrapInvitation } from "../../identity/src/bootstrap";
import {
  createPriceList, createPriceVersion, createProject, createUnit, decidePriceVersion, grantShare, savePriceDraft, submitPriceVersion,
} from "@baytline/developer";
import {
  assignLead, captureAllNew, captureLead, createDeal, createLead, decideClaim, decideRegistration, getLead, listClaims, listDeals, listLeads, listRegistrations,
  listViewings, matchUnits, overrideScore, scheduleViewing, setLeadStatus, submitClaim, submitRegistration, updateDeal, updateRequirements, updateViewing, withdrawClaim,
} from "../src";

let db: Db;
let owner: pg.Client;
const PW = "a long test passphrase";
type A = { userId: string; orgId: string; mfa?: boolean };
const u = {} as Record<"ops" | "dev" | "sales" | "fin" | "inv" | "other" | "brk" | "brkAgent" | "brk2" | "customer", A>;
const f = {} as { project: string; unshared: string; u1: string; u2: string; u3: string; sample: string; enquiry: string; appointment: string };

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof IdentityError ? `${e.code}${e.detail ? `:${e.detail}` : ""}` : `other:${(e as Error).message}`;
  }
};
const raw = <T = Record<string, any>>(a: A, sql: string, args: unknown[] = []) => withAppTx(db, a, async (c) => (await c.query(sql, args)).rows as T[]);
async function join(token: string, name: string, orgId: string): Promise<A> {
  return { userId: (await signUpFromInvitation(db, { token, password: PW, displayName: name, locale: "en" })).userId, orgId };
}
const tomorrow = () => new Date(Date.now() + 36 * 36e5).toISOString().slice(0, 16);

beforeAll(async () => {
  db = createDb();
  owner = new pg.Client({ connectionString: process.env.DATABASE_OWNER_URL });
  await owner.connect();
  const boot = await createBootstrapInvitation(process.env.DATABASE_OWNER_URL!, { email: "l-ops@example.test" });
  u.ops = { ...(await join(boot.token, "Ops", boot.orgId)), mfa: true };
  const dev = await createOrganization(db, u.ops, { type: "developer", name: "Lead Dev", market: "AE", adminEmail: "l-dev@example.test" });
  u.dev = await join(dev.token, "Dev admin", dev.orgId);
  for (const [k, role] of [["sales", "developer_sales_manager"], ["fin", "developer_finance"], ["inv", "developer_inventory_manager"]] as const) {
    u[k] = await join((await inviteMember(db, u.dev, { email: `l-${k}@example.test`, role })).token, `Dev ${k}`, dev.orgId);
  }
  const other = await createOrganization(db, u.ops, { type: "developer", name: "Other Dev", market: "AE", adminEmail: "l-other@example.test" });
  u.other = await join(other.token, "Other", other.orgId);
  const brk = await createOrganization(db, u.ops, { type: "brokerage", name: "Lead Brokerage", market: "AE", adminEmail: "l-brk@example.test" });
  u.brk = await join(brk.token, "Brk admin", brk.orgId);
  u.brkAgent = await join((await inviteMember(db, u.brk, { email: "l-agent@example.test", role: "brokerage_agent" })).token, "Agent", brk.orgId);
  const brk2 = await createOrganization(db, u.ops, { type: "brokerage", name: "Second Brokerage", market: "AE", adminEmail: "l-brk2@example.test" });
  u.brk2 = await join(brk2.token, "Brk2 admin", brk2.orgId);

  // Inventory: one shared project with approved prices, one unshared, one sample unit.
  f.project = await createProject(db, u.dev, { name: "Harbour Test", market: "AE", city: "Dubai", propertyTypes: ["apartment"], status: "launched" });
  f.unshared = await createProject(db, u.dev, { name: "Private Test", market: "AE", city: "Dubai", propertyTypes: ["apartment"], status: "launched" });
  f.u1 = await createUnit(db, u.dev, f.project, { code: "H-1", propertyType: "apartment", bedrooms: "2", areaSqm: "100", status: "available" });
  f.u2 = await createUnit(db, u.dev, f.project, { code: "H-2", propertyType: "apartment", bedrooms: "2", areaSqm: "110", status: "available" });
  f.u3 = await createUnit(db, u.dev, f.project, { code: "H-3", propertyType: "apartment", bedrooms: "1", areaSqm: "70", status: "available" });
  const list = await createPriceList(db, u.dev, f.project, { name: "Launch", currency: "AED" });
  const v = await createPriceVersion(db, u.dev, list, { effectiveFrom: "2026-01-01" });
  // H-2 has no approved price: it can't match a budget.
  await savePriceDraft(db, u.dev, v, { effectiveFrom: "2026-01-01", prices: { [f.u1]: "1500000", [f.u3]: "900000" } });
  await submitPriceVersion(db, u.dev, v);
  await decidePriceVersion(db, u.fin, v, "approve");
  await grantShare(db, u.dev, { projectId: f.project, brokerageId: brk.orgId, includePricing: true, includeDocuments: false });
  await grantShare(db, u.dev, { projectId: f.project, brokerageId: brk2.orgId, includePricing: false, includeDocuments: false });

  // A customer request routed to the developer (inserted directly: the public flow is tested elsewhere).
  const cust = await owner.query("insert into app.users (email, display_name) values ('l-cust@example.test', 'Customer') returning id");
  u.customer = { userId: cust.rows[0].id, orgId: "" };
  f.enquiry = (await owner.query(
    `insert into app.customer_enquiries (customer_user_id, routed_org_id, listing_kind, project_id, listing_title, contact_name, contact_email, contact_phone, preferred_contact, locale, source, consent_at)
     values ($1, $2, 'project', $3, 'Harbour Test', 'Mona Test', 'mona@example.test', '+971500000001', 'phone', 'en', 'listing_page', now()) returning id`,
    [u.customer.userId, dev.orgId, f.project])).rows[0].id;
  f.appointment = (await owner.query(
    `insert into app.appointment_requests (customer_user_id, routed_org_id, kind, listing_kind, project_id, listing_title, preferred_slots, contact_name, contact_email, preferred_contact, locale, consent_at)
     values ($1, $2, 'viewing', 'project', $3, 'Harbour Test', '[{"date":"2026-12-01","period":"morning"}]', 'Mona Test', 'MONA@example.test', 'email', 'en', now()) returning id`,
    [u.customer.userId, dev.orgId, f.project])).rows[0].id;
});
afterAll(async () => {
  await owner.end();
  await db.app.end();
  await db.auth.end();
});

describe("capture", () => {
  it("turns requests into one lead per person, idempotently, keeping the customer's consent", async () => {
    expect(await code(captureLead(db, u.inv, { enquiryId: f.enquiry }))).toBe("forbidden:lead.manage");
    const a = await captureLead(db, u.sales, { enquiryId: f.enquiry });
    expect(a.created).toBe(true);
    expect(await captureLead(db, u.sales, { enquiryId: f.enquiry })).toEqual({ id: a.id, created: false });
    // The same person's appointment request joins the same lead.
    expect(await captureLead(db, u.sales, { appointmentId: f.appointment })).toEqual({ id: a.id, created: false });
    expect(await captureAllNew(db, u.sales)).toBe(0);
    const lead = await getLead(db, u.sales, a.id);
    expect(lead).toMatchObject({ contactName: "Mona Test", contactPhone: "+971500000001", source: "enquiry", appointmentId: f.appointment, status: "new" });
    expect(lead.events.map((e) => e.kind)).toEqual(["note", "created"]);
    expect(await code(captureLead(db, u.other, { enquiryId: f.enquiry }))).toBe("not_found"); // routed elsewhere
  });

  it("requires consent and a way to reach the person for leads entered by staff", async () => {
    expect(await code(createLead(db, u.brk, { name: "Walk-in", email: "w@example.test", consent: "" }))).toBe("invalid_input:consent");
    expect(await code(createLead(db, u.brk, { name: "Walk-in", consent: "on" }))).toBe("invalid_input:email_or_phone");
    const id = await createLead(db, u.brk, { name: "Walk-in Test", email: "walkin@example.test", phone: "+971 50 111 2222", consent: "on", interest: "2 bedrooms near the harbour" });
    expect((await getLead(db, u.brk, id)).events[0]!.detail).toMatchObject({ consent: "confirmed_by_staff" });
  });
});

describe("assignment and visibility", () => {
  it("shows agents only the leads assigned to them", async () => {
    const id = (await listLeads(db, u.brk)).leads[0]!.id;
    expect((await listLeads(db, u.brkAgent)).leads).toEqual([]);
    expect(await code(getLead(db, u.brkAgent, id))).toBe("not_found");
    expect(await code(assignLead(db, u.brkAgent, id, u.brkAgent.userId))).toBe("forbidden:lead.assign");
    await assignLead(db, u.brk, id, u.brkAgent.userId);
    expect((await listLeads(db, u.brkAgent)).leads.map((l) => l.id)).toEqual([id]);
    // An agent's own new lead is assigned to them automatically.
    const mine = await createLead(db, u.brkAgent, { name: "Agent Lead", phone: "+971501234567", consent: "on" });
    expect((await listLeads(db, u.brkAgent)).leads.map((l) => l.id).sort()).toEqual([id, mine].sort());
    expect(await code(assignLead(db, u.brk, id, u.dev.userId))).toBe("invalid_input:assignee_not_member");
    expect(await raw(u.other, "select id from app.leads")).toEqual([]);
  });
});

describe("explainable scoring", () => {
  it("scores from recorded facts, explains every point, and records overrides with reasons", async () => {
    const id = (await listLeads(db, u.sales)).leads[0]!.id;
    let lead = await getLead(db, u.sales, id);
    // Phone, requested an appointment, recent activity.
    expect(lead.score.lines.map((l) => [l.signal, l.points])).toEqual([["reachable_by_phone", 10], ["requested_appointment", 10], ["recent_activity", 10]]);
    expect(lead.score).toMatchObject({ score: 30, band: "warm" });
    await updateRequirements(db, u.sales, id, { budgetMax: "1,600,000", currency: "AED", propertyTypes: ["apartment"], bedroomsMin: "2", timeline: "3_months", financing: "cash" });
    lead = await getLead(db, u.sales, id);
    expect(lead.score).toMatchObject({ score: 75, band: "hot" });
    expect(await code(overrideScore(db, u.sales, id, "cold", ""))).toBe("invalid_input:override_reason");
    await overrideScore(db, u.sales, id, "cold", "Said they're only browsing for now");
    lead = await getLead(db, u.sales, id);
    expect(lead.score).toMatchObject({ score: 75, computedBand: "hot", band: "cold", override: { reason: "Said they're only browsing for now", byName: "Dev sales" } });
    expect(lead.events[0]).toMatchObject({ kind: "score_override", detail: { to: "cold", reason: "Said they're only browsing for now" } });
    await overrideScore(db, u.sales, id, "", "");
    expect((await getLead(db, u.sales, id)).score.band).toBe("hot");
    expect(await code(setLeadStatus(db, u.sales, id, "lost"))).toBe("invalid_input:lost_reason");
  });
});

describe("matching", () => {
  it("offers only available, non-sample units with approved prices within budget, with their labels", async () => {
    const id = (await listLeads(db, u.sales)).leads[0]!.id;
    const { matches } = await matchUnits(db, u.sales, id);
    // Budget 1.6M, 2+ bedrooms: H-1 (1.5M approved). H-2 has no approved price; H-3 has 1 bedroom.
    expect(matches.map((m) => [m.code, m.price?.minor, m.availability])).toEqual([["H-1", "150000000", "unverified"]]);
    expect(matches[0]!.criteria.map((x) => x.criterion)).toEqual(["property_type", "bedrooms", "budget"]);
  });

  it("matches a brokerage's lead against shared projects only, and only with prices it may see", async () => {
    const lead = await createLead(db, u.brk, { name: "Buyer Test", email: "buyer@example.test", consent: "on" });
    await updateRequirements(db, u.brk, lead, { propertyTypes: ["apartment"], bedroomsMin: "1", budgetMax: "2000000", currency: "AED" });
    expect((await matchUnits(db, u.brk, lead)).matches.map((m) => m.code).sort()).toEqual(["H-1", "H-3"]);
    // The second brokerage's share doesn't include pricing: with a budget, nothing can be matched.
    const l2 = await createLead(db, u.brk2, { name: "Other Buyer", email: "ob@example.test", consent: "on" });
    await updateRequirements(db, u.brk2, l2, { propertyTypes: ["apartment"], budgetMax: "2000000", currency: "AED" });
    expect((await matchUnits(db, u.brk2, l2)).matches).toEqual([]);
    await updateRequirements(db, u.brk2, l2, { propertyTypes: ["apartment"] });
    expect((await matchUnits(db, u.brk2, l2)).matches.every((m) => m.price === null)).toBe(true);
  });
});

describe("client registration and protection", () => {
  it("registers a client with the developer, approves a protection period, and catches duplicates across brokerages", async () => {
    const lead = (await listLeads(db, u.brk, { q: "Walk-in" })).leads[0]!.id;
    expect(await code(submitRegistration(db, u.brk, lead, f.unshared))).toBe("invalid_input:project_not_shared");
    const reg = await submitRegistration(db, u.brk, lead, f.project, "Met at the sales centre");
    expect(await code(submitRegistration(db, u.brk, lead, f.project))).toBe("conflict:already_registered");
    // The same person, registered by another brokerage.
    const l2 = await createLead(db, u.brk2, { name: "Walk-in Again", phone: "050 111 2222", consent: "on" });
    const reg2 = await submitRegistration(db, u.brk2, l2, f.project);
    // Brokerages see only their own registrations.
    expect((await listRegistrations(db, u.brk2)).items.map((r) => r.id)).toEqual([reg2]);
    expect((await listRegistrations(db, u.brk)).items[0]).toMatchObject({ developerName: "Lead Dev", state: "submitted" });
    // The developer sees both, masked, flagged as possible duplicates.
    const dv = await listRegistrations(db, u.sales);
    const first = dv.items.find((r) => r.id === reg)!;
    expect(first).toMatchObject({ clientName: "Walk-in Test", emailMasked: "w***@example.test", phoneMasked: "••• 2222", brokerageName: "Lead Brokerage" });
    expect(first.possibleDuplicates).toEqual([{ id: reg2, brokerageName: "Second Brokerage", state: "submitted" }]);
    expect(await code(decideRegistration(db, u.fin, reg, "approve", "60"))).toBe("forbidden:client_registration.review");
    expect(await code(decideRegistration(db, u.sales, reg, "reject"))).toBe("invalid_input:decision_note_required");
    expect(await code(decideRegistration(db, u.sales, reg, "approve", "400"))).toBe("invalid_input:protection_days");
    await decideRegistration(db, u.sales, reg, "approve", "60");
    expect(await code(decideRegistration(db, u.sales, reg2, "approve", "60"))).toBe("conflict:already_protected");
    await decideRegistration(db, u.sales, reg2, "reject", undefined, "Already registered by another agency");
    const mine = (await listRegistrations(db, u.brk)).items.find((r) => r.id === reg)!;
    expect(mine).toMatchObject({ state: "protected", protectionDays: 60 });
    expect(Math.round((mine.protectedUntil!.getTime() - mine.protectedFrom!.getTime()) / 864e5)).toBe(60);
    expect(await code(raw(u.brk, "update app.client_registrations set status = 'approved'"))).toMatch(/permission denied/);
  });
});

describe("viewings, deals and commission claims", () => {
  it("schedules and completes a viewing, which moves the lead and its score", async () => {
    const lead = (await listLeads(db, u.brk, { q: "Walk-in" })).leads[0]!.id;
    expect(await code(scheduleViewing(db, u.brk, lead, { projectId: f.unshared, localDateTime: tomorrow() }))).toBe("invalid_input:project");
    const v = await scheduleViewing(db, u.brk, lead, { projectId: f.project, unitId: f.u1, localDateTime: tomorrow() });
    expect((await getLead(db, u.brk, lead)).status).toBe("viewing");
    expect((await listViewings(db, u.brk)).items.map((x) => x.id)).toContain(v);
    await updateViewing(db, u.brk, v, { status: "completed", outcome: "Liked the view" });
    expect((await getLead(db, u.brk, lead)).score.lines.map((l) => l.signal)).toContain("viewing_completed");
  });

  it("opens a deal on approved inventory, records the agreed price, and claims commission through two-person approval", async () => {
    const lead = (await listLeads(db, u.brk, { q: "Walk-in" })).leads[0]!.id;
    const reg = (await listRegistrations(db, u.brk)).items.find((r) => r.state === "protected")!.id;
    // Sample units and units outside shared projects can't be used.
    const sample = (await owner.query("insert into app.units (org_id, project_id, code, property_type, status, is_sample) values ($1, $2, 'SAMPLE-1', 'apartment', 'available', true) returning id", [u.dev.orgId, f.project])).rows[0].id;
    expect(await code(createDeal(db, u.brk, lead, { unitId: sample }))).toBe("invalid_input:unit");
    const deal = await createDeal(db, u.brk, lead, { unitId: f.u1, registrationId: reg });
    let d = (await listDeals(db, u.brk)).items.find((x) => x.id === deal)!;
    expect(d).toMatchObject({ stage: "negotiating", listPriceMinor: "150000000", currency: "AED", availabilityAtOpen: "unverified" });
    expect(await code(submitClaim(db, u.brk, deal, { basis: "fixed", amount: "30000" }))).toBe("invalid_input:deal_not_won");
    expect(await code(updateDeal(db, u.brk, deal, { stage: "won" }))).toBe("invalid_input:agreed_price");
    await updateDeal(db, u.brk, deal, { stage: "won", agreedPrice: "1,450,000" });
    expect((await getLead(db, u.brk, lead)).status).toBe("won");
    // 2% of 1,450,000 is 29,000: a different amount is refused.
    expect(await code(submitClaim(db, u.brk, deal, { basis: "percent", ratePercent: "2", amount: "30000" }))).toBe("invalid_input:amount_rate_mismatch");
    // The agent works this lead, but only brokerage admins and managers claim commission.
    expect(await code(submitClaim(db, u.brkAgent, deal, { basis: "percent", ratePercent: "2", amount: "29000" }))).toBe("forbidden");
    const claim = await submitClaim(db, u.brk, deal, { basis: "percent", ratePercent: "2", amount: "29000", note: "Per agency agreement" });
    expect(await code(submitClaim(db, u.brk, deal, { basis: "fixed", amount: "1" }))).toBe("conflict:duplicate");
    // The developer sees the claim with what it needs to check it.
    const dv = (await listClaims(db, u.fin)).items.find((k) => k.id === claim)!;
    expect(dv).toMatchObject({ projectName: "Harbour Test", unitCode: "H-1", clientName: "Walk-in Test", claimantName: "Lead Brokerage", dealPriceMinor: "145000000", amountMinor: "2900000", status: "submitted" });
    expect(await code(decideClaim(db, u.sales, claim, "approve"))).toBe("forbidden:commission.approve");
    expect(await code(decideClaim(db, u.brk, claim, "approve"))).toBe("not_found");
    expect(await code(decideClaim(db, u.fin, claim, "reject"))).toBe("invalid_input:decision_note_required");
    await decideClaim(db, u.fin, claim, "approve");
    d = (await listDeals(db, u.brk)).items.find((x) => x.id === deal)!;
    expect(d.claim).toMatchObject({ status: "approved", amountMinor: "2900000" });
    expect(await code(withdrawClaim(db, u.brk, claim))).toBe("invalid_input:not_pending");
    expect(await code(raw(u.fin, "update app.commission_claims set status = 'submitted'"))).toMatch(/permission denied/);
  });

  it("refuses a claim without a protecting registration, and enforces two people in the database", async () => {
    const lead = await createLead(db, u.brk, { name: "No Reg", email: "noreg@example.test", consent: "on" });
    const deal = await createDeal(db, u.brk, lead, { unitId: f.u3 });
    await updateDeal(db, u.brk, deal, { stage: "won", agreedPrice: "900000" });
    expect(await code(submitClaim(db, u.brk, deal, { basis: "fixed", amount: "10000" }))).toBe("invalid_input:no_protection");
    // Even a developer admin can't approve a claim they submitted (the check holds in SQL).
    const own = await owner.query(
      `insert into app.commission_claims (deal_id, claimant_org_id, payer_org_id, registration_id, project_name, unit_code, client_name, claimant_name, deal_price_minor, currency, basis, amount_minor, submitted_by)
       select d.id, d.org_id, $2, (select id from app.client_registrations where status = 'approved' limit 1), 'x', 'x', 'x', 'x', 1, 'AED', 'fixed', 1, $3 from app.deals d where d.id = $1 returning id`,
      [deal, u.dev.orgId, u.dev.userId]);
    expect(await code(decideClaim(db, u.dev, own.rows[0].id, "approve"))).toBe("forbidden:own_submission");
  });

  it("keeps other developers out", async () => {
    expect((await listClaims(db, u.other)).items).toEqual([]);
    expect((await listRegistrations(db, u.other)).items).toEqual([]);
    expect(await raw(u.other, "select id from app.deals union all select id from app.viewings")).toEqual([]);
  });
});
