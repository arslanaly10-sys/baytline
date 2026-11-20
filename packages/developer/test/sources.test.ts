import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withAppTx, type Db } from "@baytline/db";
import { createOrganization, IdentityError, inviteMember, signUpFromInvitation } from "@baytline/identity";
import { createBootstrapInvitation } from "../../identity/src/bootstrap";
import {
  applyBatch,
  cancelBatch,
  checkFeedUrl,
  createPriceList,
  createPriceVersion,
  createProject,
  createSource,
  createUnit,
  decidePriceVersion,
  getBatch,
  getSource,
  getUnit,
  grantShare,
  listInventoryChanges,
  listMyPartnerSources,
  listPartnerOptions,
  listSources,
  mapAndValidate,
  savePhase,
  savePriceDraft,
  stageFeedBatch,
  submitPartnerUpdate,
  submitPriceVersion,
  submitSourceForApproval,
  suspendSource,
  syncSource,
  updateSource,
  updateUnit,
  uploadImport,
  type AdapterDeps,
} from "../src";

let db: Db;
const PW = "a long test passphrase";
type A = { userId: string; orgId: string };
const u = {} as Record<"ops" | "admin" | "inv" | "sales" | "fin" | "other" | "brk" | "brkAgent", A>;
const f = {} as { project: string; project2: string; unit1: string; unit2: string; file: string; partner: string; feed: string };

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof IdentityError ? `${e.code}${e.detail ? `:${e.detail}` : ""}` : `other:${(e as Error).message}`;
  }
};
const raw = <T = Record<string, any>>(a: A, sql: string, args: unknown[] = []) =>
  withAppTx(db, { userId: a.userId, orgId: a.orgId }, async (c) => (await c.query(sql, args)).rows as T[]);
async function join(token: string, name: string, orgId: string): Promise<A> {
  return { userId: (await signUpFromInvitation(db, { token, password: PW, displayName: name, locale: "en" })).userId, orgId };
}
const hours = (n: number) => new Date(Date.now() - n * 36e5).toISOString();

beforeAll(async () => {
  db = createDb();
  const boot = await createBootstrapInvitation(process.env.DATABASE_OWNER_URL!, { email: "s-ops@example.test" });
  u.ops = await join(boot.token, "S ops", boot.orgId);
  const dev = await createOrganization(db, u.ops, { type: "developer", name: "Source Dev", market: "AE", adminEmail: "s-admin@example.test" });
  u.admin = await join(dev.token, "S admin", dev.orgId);
  for (const [k, role] of [["inv", "developer_inventory_manager"], ["sales", "developer_sales_manager"], ["fin", "developer_finance"]] as const) {
    const i = await inviteMember(db, u.admin, { email: `s-${k}@example.test`, role });
    u[k] = await join(i.token, `S ${k}`, dev.orgId);
  }
  const other = await createOrganization(db, u.ops, { type: "developer", name: "Other Dev", market: "AE", adminEmail: "s-other@example.test" });
  u.other = await join(other.token, "Other", other.orgId);
  const brk = await createOrganization(db, u.ops, { type: "brokerage", name: "Source Brokerage", market: "AE", adminEmail: "s-brk@example.test" });
  u.brk = await join(brk.token, "Brk", brk.orgId);
  const ag = await inviteMember(db, u.brk, { email: "s-agent@example.test", role: "brokerage_agent" });
  u.brkAgent = await join(ag.token, "Agent", brk.orgId);

  f.project = await createProject(db, u.inv, { name: "Source Tower", market: "AE", city: "Dubai", propertyTypes: ["apartment"], status: "launched", launchDate: "2026-01-01", handoverDate: "2028-06-30" });
  f.project2 = await createProject(db, u.inv, { name: "Other Tower", market: "AE", city: "Dubai", propertyTypes: ["apartment"], status: "planning" });
  await savePhase(db, u.inv, f.project, { kind: "building", name: "Tower A" });
  f.unit1 = await createUnit(db, u.inv, f.project, { code: "A-1", propertyType: "apartment", bedrooms: "1", areaSqm: "60", status: "available" });
  f.unit2 = await createUnit(db, u.inv, f.project, { code: "A-2", propertyType: "apartment", bedrooms: "2", areaSqm: "90", status: "available" });
});

afterAll(async () => {
  await db.app.end();
  await db.auth.end();
});

describe("sources", () => {
  it("every developer has a built-in workspace source, and workspace edits are attributed to it", async () => {
    const list = await listSources(db, u.fin);
    expect(list.map((s) => [s.type, s.authorization, s.health])).toEqual([["workspace", "authorized", "not_applicable"]]);
    expect((await getUnit(db, u.fin, f.unit1)).source).toMatchObject({ name: "Workspace edits", type: "workspace" });
    expect((await getUnit(db, u.fin, f.unit1)).history[0]!.sourceName).toBe("Workspace edits");
  });

  it("file sources need inventory.import and an authorization reference, and are authorized on creation", async () => {
    expect(await code(createSource(db, u.fin, { type: "file_import", name: "Sheets", authorizationRef: "Ops", allProjects: true }))).toBe("forbidden:inventory.import");
    expect(await code(createSource(db, u.inv, { type: "file_import", name: "Sheets", authorizationRef: "", allProjects: true }))).toBe("invalid_input:authorization_ref");
    expect(await code(createSource(db, u.inv, { type: "file_import", name: "Sheets", authorizationRef: "Ops", projectIds: [] }))).toBe("invalid_input:projects");
    f.file = await createSource(db, u.inv, { type: "file_import", name: "Inventory sheet", authorizationRef: "Inventory team weekly export", projectIds: [f.project] });
    expect(await code(createSource(db, u.inv, { type: "file_import", name: "inventory SHEET", authorizationRef: "x", allProjects: true }))).toBe("conflict:source_name_taken");
    const s = await getSource(db, u.inv, f.file);
    expect(s).toMatchObject({ authorization: "authorized", health: "not_applicable", projects: [{ id: f.project, name: "Source Tower" }], freshnessHours: 72 });
  });

  it("refuses direct integrations: no adapter exists", async () => {
    expect(await code(createSource(db, u.inv, { type: "direct_integration", name: "CRM API", authorizationRef: "Contract 1", allProjects: true }))).toBe("invalid_input:no_adapter");
  });

  it("feeds start as drafts, keep only secret NAMES, and need platform approval", async () => {
    expect(await code(createSource(db, u.inv, { type: "data_feed", name: "Feed", authorizationRef: "Agreement 7", allProjects: true, config: { url: "http://feeds.example.com/a.csv", record_type: "units" } }))).toBe("invalid_input:feed_url");
    expect(await code(createSource(db, u.inv, { type: "data_feed", name: "Feed", authorizationRef: "Agreement 7", allProjects: true, config: { url: "https://10.0.0.5/a.csv", record_type: "units" } }))).toBe("invalid_input:feed_url");
    expect(await code(createSource(db, u.inv, { type: "data_feed", name: "Feed", authorizationRef: "Agreement 7", allProjects: true, config: { url: "https://feeds.example.com/a.csv", record_type: "units" }, secretNames: ["DATABASE_APP_URL"] }))).toBe("invalid_input:secret_name");
    f.feed = await createSource(db, u.inv, {
      type: "data_feed", name: "Sales system feed", authorizationRef: "Agreement 7", projectIds: [f.project], trusted: "on",
      config: { url: "https://feeds.example.com/units.csv", record_type: "units" }, secretNames: ["FEED_TEST_TOKEN"],
    });
    let s = await getSource(db, u.inv, f.feed, { FEED_TEST_TOKEN: "s3cret" });
    expect(s).toMatchObject({ authorization: "draft", health: "not_authorized", secrets: [{ name: "FEED_TEST_TOKEN", present: true }], freshnessHours: 24, trusted: true });
    expect(JSON.stringify(s)).not.toContain("s3cret");
    expect(await code(syncSource(db, u.inv, f.feed, (c, i) => stageFeedBatch(c, u.inv, i)))).toBe("invalid_input:source_not_authorized");
    await submitSourceForApproval(db, u.inv, f.feed);
    // Only platform administrators decide.
    expect(await code(raw(u.admin, "select app.decide_inventory_source($1, 'approve', null)", [f.feed]))).toMatch(/forbidden/);
    await raw(u.ops, "select app.decide_inventory_source($1, 'approve', 'Host checked')", [f.feed]);
    s = await getSource(db, u.inv, f.feed, { FEED_TEST_TOKEN: "s3cret" });
    expect(s).toMatchObject({ authorization: "authorized", health: "never_synced" });
    expect((await getSource(db, u.inv, f.feed, {})).health).toBe("not_configured");
  });

  it("platform staff see source metadata but no inventory", async () => {
    expect((await raw(u.ops, "select name from app.inventory_sources where org_id = $1 order by name", [u.inv.orgId])).length).toBe(3);
    expect(await raw(u.ops, "select id from app.import_batches")).toEqual([]);
    expect(await raw(u.ops, "select id from app.units")).toEqual([]);
  });

  it("other developers see nothing", async () => {
    expect((await listSources(db, u.other)).map((s) => s.type)).toEqual(["workspace"]);
    expect(await code(getSource(db, u.other, f.file))).toBe("not_found");
    expect(await raw(u.other, "select id from app.inventory_sources where org_id = $1", [u.inv.orgId])).toEqual([]);
  });
});

describe("file imports", () => {
  // "As of" just now: later than the units created in setup, so they aren't conflicts.
  let asOf = "";

  it("uploads without touching inventory, and suggests a mapping", async () => {
    asOf = new Date().toISOString();
    expect(await code(uploadImport(db, u.inv, { sourceId: f.file, recordType: "units", csv: "only,header\n", asOf }))).toBe("invalid_input:file_empty");
    expect(await code(uploadImport(db, u.inv, { sourceId: f.file, recordType: "units", csv: "a,A\n1,2", asOf }))).toBe("invalid_input:file_headers");
    expect(await code(uploadImport(db, u.inv, { sourceId: f.file, recordType: "units", csv: "a\n1", asOf: hours(-5) }))).toBe("invalid_input:as_of_future");
    const csv = [
      "Project Name,Unit No,Type,Availability,Beds,Size sqm,Building",
      "Source Tower,A-1,apartment,unavailable,1,60,Tower A", // update
      "Source Tower,A-2,apartment,available,2,90,", // unchanged
      "Source Tower,A-3,apartment,available,3,120.5,Tower A", // create
      "Source Tower,A-4,apartment,available,3,120,Tower A", // duplicate
      "Source Tower,A-4,apartment,reserved,3,120,Tower A", // duplicate
      "Source Tower,A-5,castle,available,,,", // error
      "Other Tower,B-1,apartment,available,,,", // project not in source
      "Nowhere,C-1,apartment,available,,,", // project not found
      "Source Tower,A-6,apartment,sold,1,50,", // create, binding status
    ].join("\n");
    const bid = await uploadImport(db, u.inv, { sourceId: f.file, recordType: "units", csv, asOf, fileName: "units.csv" });
    const b = await getBatch(db, u.inv, bid);
    expect(b).toMatchObject({ status: "uploaded", rowCount: 9, summary: null });
    expect(b.mapping).toMatchObject({ project: 0, code: 1, property_type: 2, status: 3, bedrooms: 4, area_sqm: 5, phase: 6 });
    expect((await getUnit(db, u.fin, f.unit1)).status).toBe("available");

    expect(await code(mapAndValidate(db, u.inv, bid, { ...b.mapping, code: null }))).toBe("invalid_input:mapping_code");
    expect(await code(mapAndValidate(db, u.inv, bid, { ...b.mapping, status: 1 }))).toBe("invalid_input:mapping_reused");
    const summary = await mapAndValidate(db, u.inv, bid, b.mapping!);
    expect(summary).toEqual({ create: 2, update: 1, unchanged: 1, error: 3, duplicate: 2, conflict: 0 });
    const v = await getBatch(db, u.inv, bid);
    const byRow = Object.fromEntries(v.rows.map((r) => [r.rowNo, r]));
    expect(byRow[1]!.changes).toEqual([{ field: "status", from: "available", to: "unavailable" }, { field: "phase_id", from: null, to: expect.any(String) }]);
    expect(byRow[4]!.errors[0]).toMatchObject({ code: "duplicate", rows: [5] });
    expect(byRow[6]!.errors[0]).toMatchObject({ field: "property_type", code: "invalid" });
    expect(byRow[7]!.errors[0]).toMatchObject({ field: "project", code: "not_in_source" });
    expect(byRow[8]!.errors[0]).toMatchObject({ field: "project", code: "not_found" });
    expect(byRow[9]!.warnings).toContainEqual({ field: "status", code: "needs_hold_approval" });
    expect(v.needs.holdApproval).toBe(true);
    expect(v.can.apply).toBe(false); // inventory manager can't approve holds
    expect((await getBatch(db, u.admin, bid)).can.apply).toBe(true);
    expect((await getUnit(db, u.fin, f.unit1)).status).toBe("available"); // still nothing applied

    // Applying needs the reviewed fingerprint and the right permissions.
    const hash = (await raw(u.admin, "select preview_hash from app.import_batches where id = $1", [bid]))[0]!.preview_hash;
    expect(await code(applyBatch(db, u.admin, bid, { previewHash: "stale" }))).toBe("conflict:changed_since_preview");
    expect(await code(applyBatch(db, u.inv, bid, { previewHash: hash }))).toBe("forbidden:unit.hold.approve");
    expect(await code(applyBatch(db, u.sales, bid, { previewHash: hash }))).toBe("forbidden:inventory.import");

    // If records change after the preview, apply refuses.
    await updateUnit(db, u.inv, f.unit2, { code: "A-2", propertyType: "apartment", bedrooms: "2", areaSqm: "91", status: "available" });
    expect(await code(applyBatch(db, u.admin, bid, { previewHash: hash }))).toBe("conflict:changed_since_preview");
    await mapAndValidate(db, u.admin, bid, b.mapping!);
    const hash2 = (await raw(u.admin, "select preview_hash from app.import_batches where id = $1", [bid]))[0]!.preview_hash;
    const res = await applyBatch(db, u.admin, bid, { previewHash: hash2 });
    // A-2 now differs (91 vs 90) and was changed after as_of by another source: a conflict, skipped.
    expect(res).toMatchObject({ applied: 3, disputed: 0 });
    const a1 = await getUnit(db, u.fin, f.unit1);
    expect(a1).toMatchObject({ status: "unavailable", sourceKind: "structured_import", verification: "owner_reported", version: 2, source: { name: "Inventory sheet" } });
    expect(a1.history.find((h) => h.field === "status")).toMatchObject({ field: "status", from: "available", to: "unavailable", sourceName: "Inventory sheet", batchId: bid });
    expect((await getUnit(db, u.fin, f.unit2)).areaSqm).toBe("91.00");
    expect(await code(applyBatch(db, u.admin, bid, { previewHash: hash2 }))).toBe("invalid_input:batch_not_validated");
    expect((await getSource(db, u.inv, f.file)).lastSuccessAt).not.toBeNull();
  });

  it("confirms availability only when someone allowed to verify says so, as of the data's own time", async () => {
    const asOf2 = hours(30);
    const bid = await uploadImport(db, u.inv, { sourceId: f.file, recordType: "units", csv: "project,code,status\nSource Tower,A-1,available", asOf: asOf2 });
    const b = await getBatch(db, u.inv, bid);
    await mapAndValidate(db, u.inv, bid, b.mapping!);
    // A-1 was changed by this same source after asOf2: not a conflict with itself.
    const hash = (await raw(u.inv, "select preview_hash from app.import_batches where id = $1", [bid]))[0]!.preview_hash;
    expect(await code(applyBatch(db, u.sales, bid, { previewHash: hash, confirmVerified: "on" }))).toBe("forbidden:inventory.import");
    await applyBatch(db, u.inv, bid, { previewHash: hash, confirmVerified: "on" });
    const unit = await getUnit(db, u.fin, f.unit1);
    expect(unit.verification).toBe("verified");
    expect(unit.lastVerifiedAt?.toISOString()).toBe(new Date(asOf2).toISOString());
    // Confirmed 30 hours ago by a file import: recently confirmed (72h window), never "live".
    expect(unit.availability).toBe("recently_confirmed");
    // Shortening the source's window makes the same confirmation stale.
    await updateSource(db, u.inv, f.file, { name: "Inventory sheet", authorizationRef: "Inventory team weekly export", projectIds: [f.project], freshnessHours: "24" });
    expect((await getUnit(db, u.fin, f.unit1)).availability).toBe("stale");
    // Suspending the source means its confirmations no longer count.
    await suspendSource(db, u.inv, f.file);
    expect((await getUnit(db, u.fin, f.unit1)).availability).toBe("unverified");
    expect(await code(uploadImport(db, u.inv, { sourceId: f.file, recordType: "units", csv: "a\n1", asOf }))).toBe("invalid_input:source_not_authorized");
  });

  it("flags conflicts and can mark them as disputed instead of overwriting", async () => {
    const file2 = await createSource(db, u.inv, { type: "file_import", name: "Second sheet", authorizationRef: "Sales ops", allProjects: true });
    const bid = await uploadImport(db, u.inv, { sourceId: file2, recordType: "units", csv: "project,code,status\nSource Tower,A-2,reserved", asOf: hours(48) });
    await mapAndValidate(db, u.admin, bid, (await getBatch(db, u.inv, bid)).mapping!);
    const b = await getBatch(db, u.admin, bid);
    expect(b.summary).toMatchObject({ conflict: 1 });
    expect(b.rows[0]!.warnings).toContainEqual({ field: "code", code: "changed_after_as_of" });
    const hash = (await raw(u.inv, "select preview_hash from app.import_batches where id = $1", [bid]))[0]!.preview_hash;
    const res = await applyBatch(db, u.admin, bid, { previewHash: hash, conflictPolicy: "mark_disputed" });
    expect(res).toMatchObject({ applied: 0, disputed: 1 });
    const a2 = await getUnit(db, u.fin, f.unit2);
    expect(a2).toMatchObject({ status: "available", verification: "disputed", availability: "disputed" });
  });

  it("imports prices only as a draft version that still needs a second person to approve", async () => {
    const list = await createPriceList(db, u.inv, f.project, { name: "Launch", currency: "AED" });
    const v1 = await createPriceVersion(db, u.inv, list, { effectiveFrom: "2026-01-01" });
    await savePriceDraft(db, u.inv, v1, { effectiveFrom: "2026-01-01", prices: { [f.unit1]: "1000000" } });
    await submitPriceVersion(db, u.inv, v1);
    await decidePriceVersion(db, u.fin, v1, "approve");
    const file3 = await createSource(db, u.inv, { type: "file_import", name: "Price sheet", authorizationRef: "Finance", allProjects: true });
    const csv = "project,code,price_list,price\nSource Tower,A-1,Launch,1000000\nSource Tower,A-2,Launch,\"1,250,000.50\"\nSource Tower,A-9,Launch,5";
    const bid = await uploadImport(db, u.inv, { sourceId: file3, recordType: "prices", csv, asOf });
    const m = (await getBatch(db, u.inv, bid)).mapping!;
    const s1 = await mapAndValidate(db, u.inv, bid, m);
    expect(s1).toMatchObject({ error: 3 }); // no effective date yet
    const s2 = await mapAndValidate(db, u.inv, bid, m, { effectiveFrom: "2026-12-01" });
    expect(s2).toMatchObject({ unchanged: 1, create: 1, error: 1 });
    const hash = (await raw(u.inv, "select preview_hash from app.import_batches where id = $1", [bid]))[0]!.preview_hash;
    expect(await code(applyBatch(db, u.fin, bid, { previewHash: hash }))).toBe("forbidden:inventory.import");
    const res = await applyBatch(db, u.inv, bid, { previewHash: hash });
    expect(res).toMatchObject({ applied: 1, drafts: 1 });
    const drafts = (await getBatch(db, u.inv, bid)).drafts;
    expect(drafts).toMatchObject([{ kind: "price", name: "Launch", version: 2, status: "draft" }]);
    // Current price is unchanged until the draft is approved.
    expect((await getUnit(db, u.fin, f.unit2)).price).toBeNull();
    const entries = await raw(u.inv, "select unit_id, price_minor::text from app.price_list_entries where version_id = $1 order by price_minor", [drafts[0]!.id]);
    expect(entries.map((e) => e.price_minor)).toEqual(["100000000", "125000050"]);
    // A second import for the same list waits until the open draft is decided.
    const again = await uploadImport(db, u.inv, { sourceId: file3, recordType: "prices", csv: "project,code,price_list,price\nSource Tower,A-1,Launch,9", asOf, effectiveFrom: "2026-12-02" });
    expect(await mapAndValidate(db, u.inv, again, m)).toMatchObject({ error: 1 });
    expect((await getBatch(db, u.inv, again)).rows[0]!.errors[0]).toMatchObject({ field: "price_list", code: "open_version" });
    await cancelBatch(db, u.inv, again);
    expect(await code(cancelBatch(db, u.inv, again))).toBe("invalid_input:batch_final");
  });

  it("imports payment plans as one draft per plan; a bad milestone blocks the whole plan", async () => {
    const file = (await listSources(db, u.inv)).find((s) => s.name === "Price sheet")!.id;
    const csv = [
      "project,plan,currency,effective_from,seq,label,trigger,due_date,progress_percent,months_after_handover,percent,amount",
      "Source Tower,Easy 60/40,AED,2026-12-01,1,Booking,on_booking,,,,20,",
      "Source Tower,Easy 60/40,AED,2026-12-01,2,Construction 50%,construction_progress,,50,,40,",
      "Source Tower,Easy 60/40,AED,2026-12-01,3,Handover,on_handover,,,,40,",
      "Source Tower,Broken,AED,2026-12-01,1,Booking,on_booking,,,,50,",
      "Source Tower,Broken,AED,2026-12-01,2,Later,after_handover,,,,60,",
    ].join("\n");
    const bid = await uploadImport(db, u.inv, { sourceId: file, recordType: "payment_plans", csv, asOf });
    const s = await mapAndValidate(db, u.inv, bid, (await getBatch(db, u.inv, bid)).mapping!);
    expect(s).toMatchObject({ create: 3, error: 2 });
    const rows = (await getBatch(db, u.inv, bid)).rows;
    expect(rows.find((r) => r.rowNo === 5)!.errors[0]).toMatchObject({ field: "months_after_handover", code: "required" });
    expect(rows.find((r) => r.rowNo === 4)!.errors[0]).toMatchObject({ field: "plan", code: "other_rows_failed" });
    const hash = (await raw(u.inv, "select preview_hash from app.import_batches where id = $1", [bid]))[0]!.preview_hash;
    expect(await applyBatch(db, u.inv, bid, { previewHash: hash })).toMatchObject({ applied: 3, drafts: 1 });
    expect((await getBatch(db, u.inv, bid)).drafts).toMatchObject([{ kind: "plan", name: "Easy 60/40", version: 1, status: "draft" }]);
  });

  it("updates projects with field history", async () => {
    const file = (await listSources(db, u.inv)).find((s) => s.name === "Second sheet")!.id;
    const bid = await uploadImport(db, u.inv, { sourceId: file, recordType: "projects", csv: "project,status,handover_date\nSource Tower,under construction,2028-09-30\nSource Tower,,2020-01-01", asOf });
    await mapAndValidate(db, u.inv, bid, (await getBatch(db, u.inv, bid)).mapping!);
    expect((await getBatch(db, u.inv, bid)).summary).toMatchObject({ duplicate: 2 });
    const ok = await uploadImport(db, u.inv, { sourceId: file, recordType: "projects", csv: "project,status,handover_date\nSource Tower,under construction,2028-09-30", asOf });
    await mapAndValidate(db, u.inv, ok, (await getBatch(db, u.inv, ok)).mapping!);
    const hash = (await raw(u.inv, "select preview_hash from app.import_batches where id = $1", [ok]))[0]!.preview_hash;
    await applyBatch(db, u.inv, ok, { previewHash: hash });
    const hist = await listInventoryChanges(db, u.fin, { recordType: "project" });
    expect(hist.map((h) => [h.field, h.to, h.sourceName])).toEqual(expect.arrayContaining([["status", "under_construction", "Second sheet"], ["handover_date", "2028-09-30", "Second sheet"]]));
    const all = await listInventoryChanges(db, u.fin);
    expect(new Set(all.map((h) => h.recordType))).toEqual(new Set(["unit", "project", "price", "payment_plan"]));
  });
});

describe("feeds", () => {
  const deps = (body: string, init: { status?: number; type?: string; headers?: Record<string, string>; addr?: string } = {}): AdapterDeps => ({
    lookup: async () => [{ address: init.addr ?? "93.184.216.34", family: 4 }],
    fetch: (async (_url: unknown, opts: { headers: Record<string, string> }) => {
      // The token is sent to the feed host only, never stored or returned.
      expect(opts.headers.authorization).toBe("Bearer s3cret");
      return new Response(body, { status: init.status ?? 200, headers: { "content-type": init.type ?? "text/csv", ...init.headers } });
    }) as unknown as typeof fetch,
    now: () => new Date(),
  });
  const env = { FEED_TEST_TOKEN: "s3cret" };
  const stage = (c: Parameters<typeof stageFeedBatch>[0], i: Parameters<typeof stageFeedBatch>[2]) => stageFeedBatch(c, u.inv, i);

  it("refuses private addresses and records failures without details from the provider", async () => {
    const r = await syncSource(db, u.inv, f.feed, stage, env, deps("x", { addr: "10.1.2.3" }));
    expect(r).toMatchObject({ ok: false, batchId: null, summary: "The feed host resolves to a private or reserved address." });
    const r2 = await syncSource(db, u.inv, f.feed, stage, env, deps("secret internal error", { status: 500 }));
    expect(r2.summary).toBe("The feed answered with an error status. (HTTP 500)");
    expect((await getSource(db, u.inv, f.feed, env)).health).toBe("failing");
    expect(await code(syncSource(db, u.inv, f.feed, stage, {}, deps("")))).toBe("invalid_input:not_configured");
  });

  it("stages a successful pull for review, and only applying it confirms anything", async () => {
    const r = await syncSource(db, u.inv, f.feed, stage, env, deps("project,code,status\nSource Tower,A-1,reserved\nSource Tower,A-3,available"));
    expect(r.ok).toBe(true);
    // A sync alone confirms nothing.
    let s = await getSource(db, u.inv, f.feed, env);
    expect(s.health).toBe("never_synced");
    expect(s.pendingBatches).toBe(1);
    const b = await getBatch(db, u.admin, r.batchId!);
    expect(b).toMatchObject({ status: "validated", summary: { update: 1, unchanged: 1 }, options: { as_of_basis: "fetch_time" } });
    const hash = (await raw(u.inv, "select preview_hash from app.import_batches where id = $1", [r.batchId]))[0]!.preview_hash;
    await applyBatch(db, u.admin, r.batchId!, { previewHash: hash });
    s = await getSource(db, u.inv, f.feed, env);
    expect(s.health).toBe("healthy");
    // A trusted, authorized feed confirms availability as of its data time: recently confirmed, never live.
    const a3 = (await raw(u.inv, "select id from app.units where code = 'A-3'"))[0]!.id;
    expect(await getUnit(db, u.fin, a3)).toMatchObject({ sourceKind: "partner_feed", verification: "verified", availability: "recently_confirmed" });
    expect((await getUnit(db, u.fin, f.unit1)).status).toBe("reserved");
  });

  it("uses the data's own timestamp, so older feed data can't silently overwrite newer edits", async () => {
    const asOf = new Date(Date.now() - 2 * 36e5);
    await updateUnit(db, u.admin, f.unit1, { code: "A-1", propertyType: "apartment", bedrooms: "1", areaSqm: "60", status: "available" });
    const r = await syncSource(db, u.inv, f.feed, stage, env, deps("project,code,status\nSource Tower,A-1,reserved", { headers: { "x-data-as-of": asOf.toUTCString() } }));
    const b = await getBatch(db, u.admin, r.batchId!);
    expect(b).toMatchObject({ summary: { conflict: 1 }, options: { as_of_basis: "data_header" } });
    expect(Math.abs(b.asOf.getTime() - asOf.getTime())).toBeLessThan(1000);
    await cancelBatch(db, u.admin, r.batchId!);
  });

  it("changing where a trusted feed connects needs approval again", async () => {
    const changed = await updateSource(db, u.inv, f.feed, {
      name: "Sales system feed", authorizationRef: "Agreement 7", projectIds: [f.project], trusted: "on",
      config: { url: "https://other.example.com/units.csv", record_type: "units" }, secretNames: ["FEED_TEST_TOKEN"],
    });
    expect(changed).toContain("needs_approval");
    expect((await getSource(db, u.inv, f.feed, env)).authorization).toBe("draft");
  });

  it("validates feed URLs strictly", () => {
    for (const bad of ["https://localhost/x", "https://printer.local/x", "https://[::1]/x", "ftp://a.example.com/x", "https://user:pw@a.example.com/x", "https://a.example.com:8443/x"]) {
      expect(() => checkFeedUrl(bad)).toThrow();
    }
    expect(checkFeedUrl("https://feeds.example.com/inventory.csv").hostname).toBe("feeds.example.com");
  });
});

describe("partner updates", () => {
  it("a partner proposes availability for shared projects; the developer reviews before anything changes", async () => {
    await grantShare(db, u.admin, { projectId: f.project, brokerageId: u.brk.orgId, includePricing: false, includeDocuments: false });
    expect(await code(createSource(db, u.inv, { type: "partner", name: "Brokerage updates", authorizationRef: "Agency agreement", partnerOrgId: u.brk.orgId, projectIds: [f.project] }))).toBe("forbidden:partner.manage");
    expect(await code(createSource(db, u.admin, { type: "partner", name: "Brokerage updates", authorizationRef: "Agency agreement", partnerOrgId: u.brk.orgId, projectIds: [f.project2] }))).toBe("invalid_input:partner_projects");
    expect(await listPartnerOptions(db, u.admin)).toMatchObject([{ name: "Source Brokerage", projects: [{ name: "Source Tower" }] }]);
    f.partner = await createSource(db, u.admin, { type: "partner", name: "Brokerage updates", authorizationRef: "Agency agreement", partnerOrgId: u.brk.orgId, projectIds: [f.project] });
    expect((await getSource(db, u.inv, f.partner)).partner).toMatchObject({ name: "Source Brokerage" });

    const mine = await listMyPartnerSources(db, u.brk);
    expect(mine).toMatchObject([{ name: "Brokerage updates", developerName: "Source Dev", projects: [{ name: "Source Tower" }] }]);
    expect(await code(listMyPartnerSources(db, u.brkAgent))).toBe("forbidden:inventory.update.submit");
    expect(await code(submitPartnerUpdate(db, u.brk, { sourceId: f.partner, projectId: f.project, lines: "A-1,booked", asOf: hours(0) }))).toBe("invalid_input:lines");
    expect(await code(submitPartnerUpdate(db, u.brk, { sourceId: f.partner, projectId: f.project2, lines: "A-1,available", asOf: hours(0) }))).toBe("invalid_input:project_not_in_source");
    const bid = await submitPartnerUpdate(db, u.brk, { sourceId: f.partner, projectId: f.project, lines: "A-3,unavailable\nZ-9,available", asOf: hours(0), note: "Client walked away" });
    // The brokerage sees its own submission, never the developer's other batches or rows.
    expect((await raw(u.brk, "select id from app.import_batches")).map((r) => r.id)).toEqual([bid]);
    expect(await raw(u.brk, "select * from app.import_rows")).toEqual([]);

    const b = await getBatch(db, u.inv, bid);
    expect(b).toMatchObject({ status: "submitted", partnerSubmitted: true, mapping: { code: 0, status: 1 }, source: { partnerName: "Source Brokerage" } });
    await mapAndValidate(db, u.inv, bid, b.mapping!);
    const v = await getBatch(db, u.inv, bid);
    expect(v.summary).toMatchObject({ update: 1, error: 1 });
    expect(v.rows.find((r) => r.rowNo === 2)!.errors[0]).toMatchObject({ code: "partner_cannot_create" });
  });
});
