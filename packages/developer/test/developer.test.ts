import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createDb, withAppTx, type Db } from "@baytline/db";
import { createOrganization, IdentityError, inviteMember, signUpFromInvitation } from "@baytline/identity";
import { createBootstrapInvitation } from "../../identity/src/bootstrap";
import {
  addDocument,
  archiveDocument,
  brokerageDirectory,
  createPlan,
  createPlanVersion,
  createPriceList,
  createPriceVersion,
  createProject,
  createUnit,
  decidePlanVersion,
  decidePriceVersion,
  getPlanVersion,
  getPriceVersion,
  getProject,
  getUnit,
  grantShare,
  listDocuments,
  listPendingApprovals,
  listProjects,
  listUnits,
  revokeShare,
  savePhase,
  savePlanDraft,
  savePriceDraft,
  submitPlanVersion,
  submitPriceVersion,
  updateShare,
  updateUnit,
  verifyUnit,
  parseMoney,
  getLocationProfile,
  listLocationSummaries,
  saveLocation,
  verifyLocation,
  createPlace,
  updatePlace,
  verifyPlace,
  archivePlace,
  importPlaces,
} from "../src";

let db: Db;
const PW = "a long test passphrase";
type A = { userId: string; orgId: string };
const u = {} as Record<"ops" | "devAdmin" | "inv" | "fin" | "sales" | "devB" | "brkX" | "brkY", A>;
const f = {} as { project: string; phaseA: string; phaseOther: string; unit1: string; unit2: string; draftUnit: string; list: string; v1: string; plan: string; pv1: string; docInternal: string; docPartners: string; share: string; sampleProject: string };

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof IdentityError ? `${e.code}${e.detail ? `:${e.detail}` : ""}` : `other:${(e as Error).message}`;
  }
};
const raw = <T = Record<string, unknown>>(a: A, sql: string, args: unknown[] = []) =>
  withAppTx(db, { userId: a.userId, orgId: a.orgId }, async (c) => (await c.query(sql, args)).rows as T[]);

async function join(token: string, name: string, orgId: string): Promise<A> {
  return { userId: (await signUpFromInvitation(db, { token, password: PW, displayName: name, locale: "en" })).userId, orgId };
}

beforeAll(async () => {
  db = createDb();
  const boot = await createBootstrapInvitation(process.env.DATABASE_OWNER_URL!, { email: "ops@example.test" });
  u.ops = await join(boot.token, "Ops", boot.orgId);
  const dev = await createOrganization(db, u.ops, { type: "developer", name: "Developer A", market: "SA", adminEmail: "a-admin@example.test" });
  u.devAdmin = await join(dev.token, "A admin", dev.orgId);
  for (const [k, role, email] of [["inv", "developer_inventory_manager", "a-inv"], ["fin", "developer_finance", "a-fin"], ["sales", "developer_sales_manager", "a-sales"]] as const) {
    const i = await inviteMember(db, u.devAdmin, { email: `${email}@example.test`, role });
    u[k] = await join(i.token, email, dev.orgId);
  }
  const devB = await createOrganization(db, u.ops, { type: "developer", name: "Developer B", market: "AE", adminEmail: "b-admin@example.test" });
  u.devB = await join(devB.token, "B admin", devB.orgId);
  const x = await createOrganization(db, u.ops, { type: "brokerage", name: "Brokerage X", market: "SA", adminEmail: "x@example.test" });
  u.brkX = await join(x.token, "X admin", x.orgId);
  const y = await createOrganization(db, u.ops, { type: "brokerage", name: "Brokerage Y", market: "SA", adminEmail: "y@example.test" });
  u.brkY = await join(y.token, "Y admin", y.orgId);
});
afterAll(async () => {
  await db.app.end();
  await db.auth.end();
});

const PROJECT = { name: "Test Tower", market: "SA", city: "Riyadh", location: "North district", propertyTypes: ["apartment", "penthouse"], description: "Test record.", launchDate: "2026-01-10", handoverDate: "2028-12-31", status: "launched" };

describe("projects and phases", () => {
  it("lets project managers create, and others only view", async () => {
    expect(await code(createProject(db, u.fin, PROJECT))).toBe("forbidden:project.manage");
    expect(await code(createProject(db, u.inv, { ...PROJECT, handoverDate: "2025-01-01" }))).toBe("invalid_input:handover_before_launch");
    expect(await code(createProject(db, u.inv, { ...PROJECT, propertyTypes: ["castle"] }))).toBe("invalid_input:property_types");
    f.project = await createProject(db, u.inv, PROJECT);
    await createProject(db, u.inv, { ...PROJECT, name: "Garden Villas", city: "Jeddah", propertyTypes: ["villa"], status: "planning" });
    expect((await listProjects(db, u.fin)).map((p) => p.name)).toEqual(["Garden Villas", "Test Tower"]);
    expect((await listProjects(db, u.fin, { q: "jedd" })).map((p) => p.name)).toEqual(["Garden Villas"]);
    expect((await listProjects(db, u.fin, { propertyType: "penthouse", status: "launched" })).map((p) => p.name)).toEqual(["Test Tower"]);
  });

  it("organizes projects into buildings and phases", async () => {
    f.phaseA = await savePhase(db, u.inv, f.project, { kind: "building", name: "Tower A", sortOrder: 1 });
    expect(await code(savePhase(db, u.inv, f.project, { kind: "building", name: "Tower A" }))).toBe("conflict:phase_name_taken");
    const other = (await listProjects(db, u.inv, { q: "garden" }))[0]!.id;
    f.phaseOther = await savePhase(db, u.inv, other, { kind: "phase", name: "Phase 1" });
    expect((await getProject(db, u.fin, f.project)).phases.map((p) => p.name)).toEqual(["Tower A"]);
  });

  it("keeps other developers out, in the service and in the database", async () => {
    expect(await listProjects(db, u.devB)).toEqual([]);
    expect(await code(getProject(db, u.devB, f.project))).toBe("not_found");
    expect(await raw(u.devB, "select id from app.projects")).toEqual([]);
    expect(await code(raw(u.devB, "insert into app.projects (org_id, name, market, city, property_types) values ($1, 'x', 'SA', 'x', '{villa}')", [u.devAdmin.orgId]))).toMatch(/row-level security/);
    expect(await code(listProjects(db, u.brkX))).toBe("not_found"); // not a developer workspace
    expect(await raw(u.ops, "select id from app.projects")).toEqual([]); // platform staff see no business data
  });
});

describe("units", () => {
  it("creates units with explicit statuses; binding statuses need hold approval", async () => {
    f.unit1 = await createUnit(db, u.inv, f.project, { code: "A-101", phaseId: f.phaseA, propertyType: "apartment", bedrooms: "2", areaSqm: "118.50", floor: "1", status: "available" });
    f.unit2 = await createUnit(db, u.inv, f.project, { code: "A-102", phaseId: f.phaseA, propertyType: "apartment", bedrooms: "0", areaSqm: "52", floor: "1", status: "available" });
    f.draftUnit = await createUnit(db, u.inv, f.project, { code: "A-PH1", phaseId: f.phaseA, propertyType: "penthouse", status: "draft" });
    expect(await code(createUnit(db, u.inv, f.project, { code: "A-101", propertyType: "apartment", status: "draft" }))).toBe("conflict:unit_code_taken");
    expect(await code(createUnit(db, u.inv, f.project, { code: "X-1", phaseId: f.phaseOther, propertyType: "apartment", status: "draft" }))).toBe("invalid_input:phase");
    expect(await code(createUnit(db, u.inv, f.project, { code: "X-2", propertyType: "apartment", status: "sold" }))).toBe("forbidden:unit.hold.approve");
    expect(await code(createUnit(db, u.fin, f.project, { code: "X-3", propertyType: "apartment", status: "draft" }))).toBe("forbidden:unit.manage");
    const input = { code: "A-102", phaseId: f.phaseA, propertyType: "apartment", bedrooms: "0", areaSqm: "52", floor: "1", status: "reserved" };
    expect(await code(updateUnit(db, u.inv, f.unit2, input))).toBe("forbidden:unit.hold.approve");
    expect(await updateUnit(db, u.devAdmin, f.unit2, input)).toEqual(["status"]);
    expect(await code(updateUnit(db, u.inv, f.unit2, { ...input, status: "available" }))).toBe("forbidden:unit.hold.approve"); // undoing is binding too
  });

  it("shows provenance, never 'live', and keeps field history", async () => {
    let unit = await getUnit(db, u.fin, f.unit1);
    expect(unit).toMatchObject({ sourceKind: "partner_portal", verification: "owner_reported", availability: "unverified", version: 1 });
    await verifyUnit(db, u.inv, f.unit1);
    unit = await getUnit(db, u.fin, f.unit1);
    expect(unit.verification).toBe("verified");
    expect(unit.availability).toBe("recently_confirmed"); // manual entry: never "live"
    await updateUnit(db, u.inv, f.unit1, { code: "A-101", phaseId: f.phaseA, propertyType: "apartment", bedrooms: "2", areaSqm: "120", floor: "1", status: "available" });
    unit = await getUnit(db, u.fin, f.unit1);
    expect(unit).toMatchObject({ verification: "owner_reported", version: 2, areaSqm: "120.00" });
    expect(unit.history.map((h) => h.field)).toEqual(["verification", "area_sqm", "verification", "created"]); // newest first
    expect(await code(raw(u.devAdmin, "delete from app.unit_changes"))).toMatch(/permission denied/);
    expect(await code(verifyUnit(db, u.sales, f.unit1))).toBe("forbidden:inventory.verify");
  });

  it("never lets sample records look confirmed", async () => {
    const owner = new pg.Client({ connectionString: process.env.DATABASE_OWNER_URL });
    await owner.connect();
    const { rows } = await owner.query("insert into app.projects (org_id, name, market, city, property_types, is_sample) values ($1, 'Sample project', 'SA', 'Riyadh', '{villa}', true) returning id", [u.devAdmin.orgId]);
    f.sampleProject = rows[0].id;
    const unit = await owner.query("insert into app.units (org_id, project_id, code, property_type, status, verification, last_verified_at, verified_by, is_sample) values ($1, $2, 'S-1', 'villa', 'available', 'verified', now(), $3, true) returning id", [u.devAdmin.orgId, f.sampleProject, u.inv.userId]);
    await owner.end();
    const s = await getUnit(db, u.fin, unit.rows[0].id);
    expect(s).toMatchObject({ isSample: true, availability: "unverified", canVerify: false });
    expect(await code(verifyUnit(db, u.inv, unit.rows[0].id))).toBe("invalid_input:sample_cannot_be_verified");
  });
});

describe("price lists", () => {
  it("parses money exactly, per currency", () => {
    expect(parseMoney("1,250,000.50", "SAR")).toBe(125000050n);
    expect(parseMoney("12.345", "KWD")).toBe(12345n);
    expect(() => parseMoney("12.345", "SAR")).toThrow();
    expect(() => parseMoney("-5", "SAR")).toThrow();
  });

  it("drafts, submits and needs a different person to approve", async () => {
    f.list = await createPriceList(db, u.inv, f.project, { name: "Launch prices" });
    f.v1 = await createPriceVersion(db, u.inv, f.list, { effectiveFrom: "2026-01-01" });
    let v = await getPriceVersion(db, u.inv, f.v1);
    expect(v).toMatchObject({ currency: "SAR", status: "draft", canEdit: true }); // from the market's settings
    expect(await code(submitPriceVersion(db, u.inv, f.v1))).toBe("invalid_input:no_prices");
    expect(await savePriceDraft(db, u.inv, f.v1, { effectiveFrom: "2026-01-01", prices: { [f.unit1]: "1250000", [f.unit2]: "650000.50", [f.draftUnit]: "" } })).toBe(2);
    await submitPriceVersion(db, u.inv, f.v1);
    expect(await code(savePriceDraft(db, u.inv, f.v1, { effectiveFrom: "2026-01-01", prices: {} }))).toBe("invalid_input:version_locked");
    expect(await code(decidePriceVersion(db, u.inv, f.v1, "approve"))).toBe("forbidden:price.change.approve");
    expect(await code(decidePriceVersion(db, u.fin, f.v1, "reject"))).toBe("invalid_input:decision_note_required");
    expect((await listUnits(db, u.fin, { projectId: f.project })).find((x) => x.id === f.unit1)!.price).toBeNull(); // not approved yet
    await decidePriceVersion(db, u.fin, f.v1, "approve", "Matches the board-approved sheet");
    const unit = (await listUnits(db, u.fin, { projectId: f.project })).find((x) => x.id === f.unit1)!;
    expect(unit.price).toMatchObject({ minor: "125000000", currency: "SAR", listName: "Launch prices" });
  });

  it("blocks approving your own submission, even for admins", async () => {
    const v2 = await createPriceVersion(db, u.devAdmin, f.list, { effectiveFrom: "2026-06-01" });
    expect((await getPriceVersion(db, u.devAdmin, v2)).rows.find((r) => r.unitId === f.unit1)!.priceMinor).toBe("125000000"); // copied
    await savePriceDraft(db, u.devAdmin, v2, { effectiveFrom: "2026-06-01", prices: { [f.unit1]: "1300000", [f.unit2]: "650000.50" } });
    await submitPriceVersion(db, u.devAdmin, v2);
    expect(await code(decidePriceVersion(db, u.devAdmin, v2, "approve"))).toBe("forbidden:own_submission");
    const pending = await listPendingApprovals(db, u.devAdmin);
    expect(pending.find((p) => p.versionId === v2)).toMatchObject({ isOwnSubmission: true, canDecide: false });
    expect((await listPendingApprovals(db, u.fin)).find((p) => p.versionId === v2)!.canDecide).toBe(true);
    // The database refuses it too.
    expect(await code(raw(u.devAdmin, "update app.price_list_versions set status = 'approved', decided_by = $2, decided_at = now() where id = $1", [v2, u.devAdmin.userId]))).toMatch(/check constraint/);
    await decidePriceVersion(db, u.fin, v2, "approve");
    expect((await getPriceVersion(db, u.fin, f.v1)).status).toBe("superseded");
    const unit = await getUnit(db, u.fin, f.unit1);
    expect(unit.price?.minor).toBe("130000000");
    expect(unit.prices.map((p) => [p.version, p.status])).toEqual([[2, "approved"], [1, "superseded"]]);
  });

  it("keeps approved prices frozen in the database", async () => {
    expect(await code(raw(u.devAdmin, "update app.price_list_entries set price_minor = 1 where version_id = $1", [f.v1]))).toMatch(/version_locked/);
    expect(await code(raw(u.devAdmin, "update app.price_list_versions set notes = 'edited' where id = $1", [f.v1]))).toMatch(/version_locked/);
  });
});

describe("payment plans", () => {
  const ms = [
    { label: "Booking", trigger: "on_booking", percent: "10" },
    { label: "Structure complete", trigger: "construction_progress", progressPercent: "50", percent: "30" },
    { label: "Handover", trigger: "on_handover", percent: "50" },
  ];

  it("validates milestones arithmetically and needs approval", async () => {
    f.plan = await createPlan(db, u.inv, f.project, { name: "Standard plan" });
    f.pv1 = await createPlanVersion(db, u.inv, f.plan, { effectiveFrom: "2026-01-01" });
    expect(await code(savePlanDraft(db, u.inv, f.pv1, { currency: "SAR", effectiveFrom: "2026-01-01", milestones: [{ label: "x", trigger: "on_booking", percent: "10", amount: "5000" }] }))).toBe("invalid_input:milestone_percent_or_amount");
    expect(await code(savePlanDraft(db, u.inv, f.pv1, { currency: "SAR", effectiveFrom: "2026-01-01", milestones: [{ label: "x", trigger: "after_handover", percent: "10" }] }))).toBe("invalid_input:milestone_months");
    await savePlanDraft(db, u.inv, f.pv1, { currency: "SAR", effectiveFrom: "2026-01-01", handoverTerms: "As stated in the developer's sales agreement.", milestones: ms });
    expect(await code(submitPlanVersion(db, u.inv, f.pv1))).toBe("invalid_input:percent_not_100"); // 90%
    await savePlanDraft(db, u.inv, f.pv1, { currency: "SAR", effectiveFrom: "2026-01-01", milestones: [...ms, { label: "Post-handover", trigger: "after_handover", monthsAfterHandover: "12", percent: "10" }] });
    expect((await getPlanVersion(db, u.inv, f.pv1)).percentTotal).toBe("100.00");
    expect(await code(submitPlanVersion(db, u.fin, f.pv1))).toBe("forbidden:payment_plan.publish");
    await submitPlanVersion(db, u.inv, f.pv1);
    await decidePlanVersion(db, u.fin, f.pv1, "approve");
    expect(await code(raw(u.devAdmin, "delete from app.payment_plan_milestones where version_id = $1", [f.pv1]))).toMatch(/version_locked/);
    const v2 = await createPlanVersion(db, u.inv, f.plan, { effectiveFrom: "2027-01-01" });
    expect((await getPlanVersion(db, u.inv, v2)).milestones).toHaveLength(4); // copied from approved
  });
});

describe("documents", () => {
  it("stores references with visibility; only https links", async () => {
    expect(await code(addDocument(db, u.inv, f.project, { title: "Brochure", docType: "brochure", referenceKind: "url", reference: "http://insecure.example/x.pdf", visibility: "partners" }))).toBe("invalid_input:reference_url");
    expect(await code(addDocument(db, u.sales, f.project, { title: "x", docType: "other", referenceKind: "external_ref", reference: "DMS-1", visibility: "internal" }))).toBe("forbidden:document.manage");
    f.docPartners = await addDocument(db, u.inv, f.project, { title: "Brochure", docType: "brochure", referenceKind: "url", reference: "https://files.example.test/brochure.pdf", visibility: "partners" });
    f.docInternal = await addDocument(db, u.inv, f.project, { title: "Internal cost sheet", docType: "other", referenceKind: "external_ref", reference: "DMS-4471", visibility: "internal" });
    expect((await listDocuments(db, u.sales, { projectId: f.project })).map((d) => d.title).sort()).toEqual(["Brochure", "Internal cost sheet"]);
  });
});

describe("brokerage partners", () => {
  it("only partner managers share, never sample projects, only to brokerages", async () => {
    const dir = await brokerageDirectory(db, u.sales);
    expect(dir.map((d) => d.name)).toEqual(["Brokerage X", "Brokerage Y"]);
    expect(await code(grantShare(db, u.inv, { projectId: f.project, brokerageId: u.brkX.orgId, includePricing: false, includeDocuments: true }))).toBe("forbidden:partner.manage");
    expect(await code(grantShare(db, u.sales, { projectId: f.sampleProject, brokerageId: u.brkX.orgId, includePricing: false, includeDocuments: false }))).toBe("invalid_input:sample_not_shareable");
    expect(await code(grantShare(db, u.sales, { projectId: f.project, brokerageId: u.devB.orgId, includePricing: false, includeDocuments: false }))).toBe("invalid_input:brokerage");
    f.share = await grantShare(db, u.sales, { projectId: f.project, brokerageId: u.brkX.orgId, includePricing: false, includeDocuments: true });
    expect(await code(grantShare(db, u.sales, { projectId: f.project, brokerageId: u.brkX.orgId, includePricing: false, includeDocuments: true }))).toBe("conflict:already_shared");
  });

  it("shows the partner exactly what the share includes", async () => {
    expect((await raw<{ name: string }>(u.brkX, "select name from app.projects")).map((r) => r.name)).toEqual(["Test Tower"]);
    expect((await raw<{ code: string }>(u.brkX, "select code from app.units order by code")).map((r) => r.code)).toEqual(["A-101", "A-102"]); // no drafts, no samples
    expect((await raw<{ title: string }>(u.brkX, "select title from app.project_documents")).map((r) => r.title)).toEqual(["Brochure"]); // no internal docs
    expect(await raw(u.brkX, "select unit_id from app.price_list_entries")).toEqual([]); // pricing not shared
    expect(await raw(u.brkX, "select * from app.unit_changes")).toEqual([]);
    expect(await raw(u.brkY, "select id from app.projects")).toEqual([]); // other brokerage: nothing
    expect(await code(raw(u.brkX, "update app.units set status = 'sold' returning id"))).toBe("ok");
    expect(await raw(u.brkX, "update app.units set status = 'sold' returning id")).toEqual([]); // read-only
  });

  it("pricing is shared only when included, and only approved versions", async () => {
    await updateShare(db, u.sales, f.share, { includePricing: true, includeDocuments: true });
    const statuses = (await raw<{ status: string }>(u.brkX, "select status from app.price_list_versions")).map((r) => r.status);
    expect(statuses).toEqual(["approved"]);
    expect((await raw(u.brkX, "select * from app.payment_plan_versions")).length).toBe(1); // approved plan only, not the new draft
  });

  it("archiving a document or revoking the share hides it at once", async () => {
    await archiveDocument(db, u.inv, f.docPartners);
    expect(await raw(u.brkX, "select title from app.project_documents")).toEqual([]);
    await revokeShare(db, u.sales, f.share);
    expect(await raw(u.brkX, "select id from app.projects")).toEqual([]);
    expect(await raw(u.brkX, "select id from app.units")).toEqual([]);
  });
});

describe("location profiles", () => {
  const school = { kind: "amenity", category: "school", name: "Test school", latitude: "24.7600", longitude: "46.6400" };
  let schoolId = "", shareY = "";

  it("starts empty and lets only area-profile managers edit", async () => {
    const p = await getLocationProfile(db, u.fin, f.project);
    expect(p).toMatchObject({ location: null, places: [], canManage: false, access: "owner" });
    expect(await code(saveLocation(db, u.fin, f.project, { latitude: "24.75", longitude: "46.63" }))).toBe("forbidden:area_profile.manage");
    expect(await code(saveLocation(db, u.inv, f.project, { latitude: "46.63", longitude: "24.75" }))).toBe("invalid_input:coordinates_outside_gcc"); // swapped
    expect(await code(saveLocation(db, u.inv, f.project, { latitude: "24.75" }))).toBe("invalid_input:coordinates");
    expect(await code(saveLocation(db, u.inv, f.project, { latitude: "24.75", longitude: "46.63", sourceKind: "provider" }))).toBe("invalid_input:source_kind");
    expect(await saveLocation(db, u.inv, f.project, { address: "King Fahd Road", area: "North", latitude: "24.75", longitude: "46.63", sourceReference: "Site survey plan" })).toContain("coordinates");
    expect(await saveLocation(db, u.inv, f.project, { address: "King Fahd Road", area: "North", latitude: "24.75", longitude: "46.63", sourceReference: "Site survey plan" })).toEqual([]);
    expect(await code(getLocationProfile(db, u.devB, f.project))).toBe("not_found");
  });

  it("records places with their source, computes or keeps distance, never invents it", async () => {
    expect(await code(createPlace(db, u.inv, f.project, { kind: "infrastructure", category: "rail", name: "Metro extension", stage: "planned" }))).toBe("invalid_input:source_required");
    expect(await code(createPlace(db, u.inv, f.project, { kind: "amenity", category: "rail", name: "x" }))).toBe("invalid_input:category");
    expect(await code(createPlace(db, u.inv, f.project, { kind: "amenity", category: "school", name: "x", stage: "planned" }))).toBe("invalid_input:stage");
    schoolId = await createPlace(db, u.inv, f.project, school);
    await createPlace(db, u.inv, f.project, { kind: "amenity", category: "retail", name: "Corner market", distanceKm: "0.4" });
    await createPlace(db, u.inv, f.project, { kind: "amenity", category: "healthcare", name: "Clinic without distance" });
    await createPlace(db, u.inv, f.project, { kind: "infrastructure", category: "rail", name: "Metro extension", stage: "planned", expectedDate: "2029-01-01", sourceReference: "Transport authority plan, 2025 edition" });
    await createPlace(db, u.inv, f.project, { kind: "competitor", category: "residential", name: "Other Towers", developerName: "Some developer", stage: "launched", distanceKm: "1.8", sourceReference: "Developer's sales brochure" });
    const p = await getLocationProfile(db, u.fin, f.project);
    expect(p.totalPlaces).toBe(5);
    const byName = Object.fromEntries(p.places.map((x) => [x.name, x]));
    expect(byName["Test school"]!.distance?.basis).toBe("computed");
    expect(byName["Test school"]!.distance!.meters).toBeGreaterThan(1000);
    expect(byName["Corner market"]!.distance).toEqual({ meters: 400, basis: "recorded" });
    expect(byName["Clinic without distance"]!.distance).toBeNull();
    expect(byName["Other Towers"]).toMatchObject({ developerName: "Some developer", sourceKind: "manual_entry", sourceReference: "Developer's sales brochure" });
    expect(p.places.slice(-2).map((x) => x.distance)).toEqual([null, null]); // unknown distances sort last
  });

  it("filters by kind, category and distance, saying how many lack a distance", async () => {
    const near = await getLocationProfile(db, u.fin, f.project, { maxDistance: "1000" });
    expect(near.places.map((x) => x.name)).toEqual(["Corner market"]);
    expect(near.hiddenWithoutDistance).toBe(2); // the clinic and the metro plan have no distance
    expect((await getLocationProfile(db, u.fin, f.project, { kind: "competitor" })).places.map((x) => x.name)).toEqual(["Other Towers"]);
    expect((await getLocationProfile(db, u.fin, f.project, { category: "school" })).places.map((x) => x.name)).toEqual(["Test school"]);
  });

  it("verifies, and any later change needs verifying again", async () => {
    expect(await code(verifyPlace(db, u.sales, schoolId))).toBe("forbidden:inventory.verify");
    await verifyPlace(db, u.inv, schoolId);
    await verifyLocation(db, u.inv, f.project);
    let p = await getLocationProfile(db, u.fin, f.project);
    expect(p.location!.verification).toBe("verified");
    expect(p.places.find((x) => x.id === schoolId)!.verification).toBe("verified");
    expect(await updatePlace(db, u.inv, schoolId, { ...school, name: "Test school (renamed)" })).toEqual(["name"]);
    await saveLocation(db, u.inv, f.project, { address: "King Fahd Road, gate 2", area: "North", latitude: "24.75", longitude: "46.63", sourceReference: "Site survey plan" });
    p = await getLocationProfile(db, u.fin, f.project);
    expect(p.location!.verification).toBe("unverified");
    expect(p.places.find((x) => x.id === schoolId)!.verification).toBe("unverified");
  });

  it("shares with a brokerage only when the share includes location", async () => {
    shareY = await grantShare(db, u.sales, { projectId: f.project, brokerageId: u.brkY.orgId, includePricing: false, includeDocuments: false });
    expect(await code(getLocationProfile(db, u.brkY, f.project))).toBe("not_found");
    expect(await raw(u.brkY, "select * from app.project_places")).toEqual([]);
    await updateShare(db, u.sales, shareY, { includePricing: false, includeDocuments: false, includeLocation: true });
    const p = await getLocationProfile(db, u.brkY, f.project);
    expect(p).toMatchObject({ access: "partner", canManage: false, canVerify: false, sharedWithPartners: null });
    expect(p.places.length).toBe(5);
    expect(await code(createPlace(db, u.brkY, f.project, school))).toBe("not_found");
    expect(await code(raw(u.brkY, "update app.project_places set name = 'x'"))).toMatch(/^ok$|permission denied/);
    expect((await raw<{ name: string }>(u.sales, "select name from app.project_places where name = 'x'")).length).toBe(0); // RLS: partner can't change rows
    await updateShare(db, u.sales, shareY, { includePricing: true, includeDocuments: false }); // older callers leave location as it was
    expect((await getLocationProfile(db, u.brkY, f.project)).places.length).toBe(5);
    expect(await code(getLocationProfile(db, u.brkX, f.project))).toBe("not_found"); // its share was revoked
  });

  it("archives places and imports CSV all-or-nothing, labelled as imported", async () => {
    await archivePlace(db, u.inv, schoolId);
    expect((await getLocationProfile(db, u.brkY, f.project)).places.map((x) => x.name)).not.toContain("Test school (renamed)");
    expect(await code(importPlaces(db, u.inv, f.project, "kind,category,name\n", "x"))).toBe("invalid_input:import_empty");
    expect(await code(importPlaces(db, u.inv, f.project, "kind,category,name\namenity,park,x\n", ""))).toBe("invalid_input:import_source_required");
    const wrong = await importPlaces(db, u.inv, f.project, 'kind,category,name,latitude,longitude\namenity,park,"Park, north",24.751,46.631\namenity,castle,Bad category,,\n', "Municipal amenities list");
    expect(wrong).toEqual({ imported: 0, errors: [{ line: 3, field: "category" }] });
    const ok = await importPlaces(db, u.inv, f.project, 'kind,category,name,latitude,longitude,source\namenity,park,"Park, north",24.751,46.631,\ninfrastructure,road,Ring road link,,,Roads plan\n', "Municipal amenities list");
    expect(ok).toEqual({ imported: 2, errors: [] });
    const p = await getLocationProfile(db, u.inv, f.project);
    const park = p.places.find((x) => x.name === "Park, north")!;
    expect(park).toMatchObject({ sourceKind: "structured_import", sourceReference: "Municipal amenities list", verification: "unverified" });
    expect(p.places.find((x) => x.name === "Ring road link")!.sourceReference).toBe("Roads plan");
    const summaries = await listLocationSummaries(db, u.fin);
    expect(summaries.find((x) => x.projectId === f.project)).toMatchObject({ hasCoordinates: true, places: 6 });
    const types = (await raw<{ event_type: string }>(u.devAdmin, "select distinct event_type from app.audit_events where org_id = $1", [u.devAdmin.orgId])).map((r) => r.event_type);
    for (const t of ["location.updated", "location.verified", "place.created", "place.updated", "place.verified", "place.archived", "place.imported"]) expect(types).toContain(t);
  });
});
