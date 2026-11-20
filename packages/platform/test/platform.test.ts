import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withAppTx, type Db } from "@baytline/db";
import {
  createOrganization,
  getOrgContext,
  IdentityError,
  inviteMember,
  listAuditEvents,
  signIn,
  signUpFromInvitation,
  validateSession,
} from "@baytline/identity";
import { createBootstrapInvitation } from "../../identity/src/bootstrap";
import {
  deriveStatus,
  getIntegrationRegistry,
  getMarketDetail,
  getOrganizationProfile,
  getUserProfile,
  listMarkets,
  revokeUserSessions,
  runIntegrationCheck,
  searchOrganizations,
  searchUsers,
  setIntegrationEnabled,
  setOrganizationStatus,
  setUserStatus,
  updateMarket,
  updateOrganizationProfile,
} from "../src";

let db: Db;
const PW = "a long test passphrase";
const f = {} as { plat: string; adminId: string; supportId: string; devOrg: string; devAdminId: string; devToken: string; personalOrg?: string };
const admin = () => ({ userId: f.adminId, orgId: f.plat });
const support = () => ({ userId: f.supportId, orgId: f.plat });
const devAdmin = () => ({ userId: f.devAdminId, orgId: f.devOrg });

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof IdentityError ? `${e.code}${e.detail ? `:${e.detail}` : ""}` : `other:${(e as Error).message}`;
  }
};
const raw = <T>(userId: string, orgId: string, sql: string, args: unknown[] = []) =>
  withAppTx(db, { userId, orgId }, async (c) => (await c.query(sql, args)).rows as T[]);

const MARKET_OK = {
  nameEn: "United Arab Emirates",
  nameAr: "الإمارات العربية المتحدة",
  currency: "AED",
  timeZone: "Asia/Dubai",
  weekendDays: ["6", "0"],
  defaultLocale: "en",
  supportedLocales: ["ar", "en", "ur", "ru"],
  numberingSystem: "latn",
  dateStyle: "medium",
  status: "enabled",
};

beforeAll(async () => {
  db = createDb();
  const boot = await createBootstrapInvitation(process.env.DATABASE_OWNER_URL!, { email: "ops@example.test" });
  f.plat = boot.orgId;
  f.adminId = (await signUpFromInvitation(db, { token: boot.token, password: PW, displayName: "Ops admin", locale: "en" })).userId;
  const sup = await inviteMember(db, admin(), { email: "support@example.test", role: "platform_support" });
  f.supportId = (await signUpFromInvitation(db, { token: sup.token, password: PW, displayName: "Support person", locale: "en" })).userId;
  const dev = await createOrganization(db, admin(), { type: "developer", name: "Test Developer", market: "SA", adminEmail: "dev@example.test" });
  f.devOrg = dev.orgId;
  const s = await signUpFromInvitation(db, { token: dev.token, password: PW, displayName: "Dev admin", locale: "ar" });
  f.devAdminId = s.userId;
  f.devToken = s.token;
});
afterAll(async () => {
  await db.app.end();
  await db.auth.end();
});

describe("integration status", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  const base = { adapterAvailable: true, enabled: true, developmentOnly: false, missingSecrets: 0 };
  it("is connected only after a recent successful check", () => {
    expect(deriveStatus({ ...base, lastCheck: null }, now)).toBe("untested");
    expect(deriveStatus({ ...base, lastCheck: { ok: false, at: now } }, now)).toBe("failing");
    expect(deriveStatus({ ...base, lastCheck: { ok: true, at: new Date("2026-11-17T12:00:00Z") } }, now)).toBe("stale");
    expect(deriveStatus({ ...base, lastCheck: { ok: true, at: new Date("2026-11-19T11:00:00Z") } }, now)).toBe("connected");
  });
  it("never reports connected without an adapter, secrets, or while disabled", () => {
    const good = { ok: true, at: now };
    expect(deriveStatus({ ...base, adapterAvailable: false, lastCheck: good }, now)).toBe("not_available");
    expect(deriveStatus({ ...base, missingSecrets: 1, lastCheck: good }, now)).toBe("not_configured");
    expect(deriveStatus({ ...base, enabled: false, lastCheck: good }, now)).toBe("disabled");
    expect(deriveStatus({ ...base, adapterAvailable: false, developmentOnly: true }, now)).toBe("development_only");
  });
});

describe("integration registry", () => {
  const env = {
    ...process.env,
    DATABASE_APP_URL: process.env.DATABASE_APP_URL,
    WHATSAPP_BUSINESS_TOKEN: "s3cr3t-whatsapp-value",
    MAIL_DEV_OUTBOX: undefined,
  } as NodeJS.ProcessEnv;

  it("never sends secret values, only names and presence", async () => {
    const reg = await getIntegrationRegistry(db, admin(), env);
    const json = JSON.stringify(reg);
    expect(json).not.toContain("s3cr3t-whatsapp-value");
    expect(json).not.toContain(new URL(process.env.DATABASE_APP_URL!).password);
    const wa = reg.find((r) => r.key === "whatsapp")!;
    expect(wa.secrets.find((s) => s.name === "WHATSAPP_BUSINESS_TOKEN")?.present).toBe(true);
    // Secret present, but no adapter exists: still not available.
    expect(wa.status).toBe("not_available");
  });

  it("marks the database connected only after a real check", async () => {
    expect((await getIntegrationRegistry(db, admin(), env)).find((r) => r.key === "database")!.status).toBe("untested");
    expect(await runIntegrationCheck(db, admin(), "database", env)).toMatchObject({ ok: true });
    expect((await getIntegrationRegistry(db, admin(), env)).find((r) => r.key === "database")!.status).toBe("connected");
  });

  it("refuses checks for providers without an adapter", async () => {
    expect(await code(runIntegrationCheck(db, admin(), "whatsapp", env))).toBe("invalid_input:no_check_available");
  });

  it("shows email as development-only, never connected", async () => {
    const dev = { ...env, MAIL_DEV_OUTBOX: "console", NODE_ENV: "development" } as NodeJS.ProcessEnv;
    expect((await getIntegrationRegistry(db, admin(), dev)).find((r) => r.key === "email")!.status).toBe("development_only");
    expect((await getIntegrationRegistry(db, admin(), env)).find((r) => r.key === "email")!.status).toBe("not_available");
  });

  it("lets support look but not change anything", async () => {
    expect((await getIntegrationRegistry(db, support(), env)).length).toBeGreaterThan(0);
    expect(await code(runIntegrationCheck(db, support(), "database", env))).toBe("forbidden:platform.integrations.manage");
    expect(await code(setIntegrationEnabled(db, support(), "database", false))).toBe("forbidden:platform.integrations.manage");
  });

  it("hides the registry from organizations outside the platform", async () => {
    expect(await code(getIntegrationRegistry(db, devAdmin(), env))).toBe("forbidden:platform.integrations.view");
    expect(await raw(f.devAdminId, f.devOrg, "select * from app.integration_checks")).toEqual([]);
  });

  it("keeps check history append-only", async () => {
    expect(await code(raw(f.adminId, f.plat, "delete from app.integration_checks"))).toMatch(/permission denied/);
    expect(await code(raw(f.supportId, f.plat, "insert into app.integration_checks (provider_key, checked_by, ok, summary) values ('database', $1, true, 'fake')", [f.supportId]))).toMatch(/row-level security/);
  });

  it("won't pretend core infrastructure can be turned off", async () => {
    expect(await code(setIntegrationEnabled(db, admin(), "database", false))).toBe("invalid_input:required_integration");
    const d = (await getIntegrationRegistry(db, admin(), env)).find((r) => r.key === "database")!;
    expect(d).toMatchObject({ status: "connected", required: true });
  });

  it("records turning an optional integration off, and status follows", async () => {
    await setIntegrationEnabled(db, admin(), "email", false, "Not in use yet");
    const e = (await getIntegrationRegistry(db, admin(), { ...env, MAIL_DEV_OUTBOX: "console", NODE_ENV: "development" } as NodeJS.ProcessEnv)).find((r) => r.key === "email")!;
    // Disabled wins over the development stand-in.
    expect(e).toMatchObject({ enabled: false, notes: "Not in use yet" });
    expect(e.status).toBe("not_available");
    await setIntegrationEnabled(db, admin(), "email", true);
  });
});

describe("organizations", () => {
  it("lists and searches business organizations for platform staff", async () => {
    const all = await searchOrganizations(db, support());
    expect(all.map((o) => o.type)).toEqual(expect.arrayContaining(["platform", "developer"]));
    expect(all.some((o) => o.type === "individual")).toBe(false);
    expect((await searchOrganizations(db, admin(), { q: "test dev" })).map((o) => o.name)).toEqual(["Test Developer"]);
    expect(await searchOrganizations(db, admin(), { q: "%" })).toEqual([]); // wildcards matched literally
    expect((await searchOrganizations(db, admin(), { market: "SA", type: "developer" })).length).toBe(1);
    expect(await code(searchOrganizations(db, devAdmin()))).toBe("forbidden:platform.orgs.view");
  });

  it("edits profiles only with platform.orgs.manage, and audits the fields", async () => {
    const input = { name: "Test Developer", legalName: "Test Developer LLC", registrationRef: "REF-1", website: "https://dev.example.test", market: "SA" };
    expect(await code(updateOrganizationProfile(db, support(), f.devOrg, input))).toBe("forbidden:platform.orgs.manage");
    expect(await code(updateOrganizationProfile(db, admin(), f.devOrg, { ...input, website: "http://insecure.example" }))).toBe("invalid_input:website");
    await updateOrganizationProfile(db, admin(), f.devOrg, input);
    const p = await getOrganizationProfile(db, support(), f.devOrg);
    expect(p).toMatchObject({ legalName: "Test Developer LLC", registrationRef: "REF-1", updatedByName: "Ops admin" });
    const { rows } = await listAuditEvents(db, admin(), { eventType: "org.updated" });
    expect(rows[0]!.metadata).toEqual({ fields: "legal_name,registration_ref,website" });
  });

  it("suspension removes members' access immediately; the platform org can't be suspended", async () => {
    await setOrganizationStatus(db, admin(), f.devOrg, "suspended");
    expect(await getOrgContext(db, devAdmin())).toBeNull();
    await setOrganizationStatus(db, admin(), f.devOrg, "active");
    expect(await getOrgContext(db, devAdmin())).not.toBeNull();
    expect(await code(setOrganizationStatus(db, admin(), f.plat, "suspended"))).toBe("forbidden:platform_org");
    expect(await code(raw(f.adminId, f.plat, "update app.organizations set status = 'suspended' where id = $1", [f.plat]))).toMatch(/platform_org_cannot_be_suspended/);
  });
});

describe("users", () => {
  it("finds users and shows memberships across organizations", async () => {
    const found = await searchUsers(db, support(), { q: "dev@" });
    expect(found.map((u) => u.email)).toEqual(["dev@example.test"]);
    const p = await getUserProfile(db, support(), f.devAdminId);
    expect(p.memberships.map((m) => [m.orgName, m.role])).toEqual([["Test Developer", "developer_admin"]]);
    expect(p.activeSessions).toBeGreaterThan(0);
    expect(p.canManage).toBe(false); // support is read-only
    expect((await getUserProfile(db, admin(), f.devAdminId)).canManage).toBe(true);
    expect(await code(searchUsers(db, devAdmin()))).toBe("forbidden:platform.users.view");
  });

  it("disables an account: sign-in and existing sessions stop working", async () => {
    expect(await code(setUserStatus(db, support(), f.devAdminId, "disabled"))).toBe("forbidden:platform.users.manage");
    await setUserStatus(db, admin(), f.devAdminId, "disabled");
    expect(await validateSession(db, f.devToken)).toBeNull();
    expect((await signIn(db, { email: "dev@example.test", password: PW })).ok).toBe(false);
    await setUserStatus(db, admin(), f.devAdminId, "active");
    expect((await signIn(db, { email: "dev@example.test", password: PW })).ok).toBe(true);
  });

  it("never lets anyone change their own account status", async () => {
    expect(await code(setUserStatus(db, admin(), f.adminId, "disabled"))).toBe("forbidden:self_change");
    expect(await code(raw(f.adminId, f.plat, "update app.users set status = 'disabled' where id = $1", [f.adminId]))).toMatch(/status_change_not_allowed|0 rows/);
    expect(await code(raw(f.devAdminId, f.devOrg, "update app.users set status = 'disabled' where id = $1", [f.devAdminId]))).toMatch(/status_change_not_allowed/);
    const rows = await raw<{ status: string }>(f.adminId, f.plat, "select status from app.users where id = $1", [f.adminId]);
    expect(rows[0]!.status).toBe("active");
  });

  it("signs someone out everywhere", async () => {
    const s = await signIn(db, { email: "dev@example.test", password: PW });
    expect(s.ok).toBe(true);
    expect(await revokeUserSessions(db, admin(), f.devAdminId)).toBeGreaterThan(0);
    if (s.ok) expect(await validateSession(db, s.session.token)).toBeNull();
  });
});

describe("markets", () => {
  it("are readable by any signed-in user, with every rule needing setup", async () => {
    const ms = await listMarkets(db, f.devAdminId);
    expect(ms.map((m) => m.code)).toEqual(["AE", "BH", "KW", "OM", "QA", "SA"]);
    expect(ms.every((m) => m.rulesNeedingSetup === 12 && m.rulesTotal === 12)).toBe(true);
    expect(ms.find((m) => m.code === "KW")!.currencyDigits).toBe(3);
  });

  it("validate edits against real currency and time zone lists", async () => {
    expect(await code(updateMarket(db, admin(), "AE", { ...MARKET_OK, currency: "XYZ1" }))).toBe("invalid_input:currency");
    expect(await code(updateMarket(db, admin(), "AE", { ...MARKET_OK, timeZone: "Mars/Olympus" }))).toBe("invalid_input:time_zone");
    expect(await code(updateMarket(db, admin(), "AE", { ...MARKET_OK, defaultLocale: "ar", supportedLocales: ["en"] }))).toBe("invalid_input:default_locale");
    expect(await code(updateMarket(db, admin(), "AE", { ...MARKET_OK, weekendDays: [] }))).toBe("invalid_input:weekend_days");
  });

  it("only platform administrators change them, and changes are audited", async () => {
    expect(await code(updateMarket(db, support(), "AE", MARKET_OK))).toBe("forbidden:platform.markets.configure");
    expect(await updateMarket(db, admin(), "AE", MARKET_OK)).toEqual([]); // no-op
    expect(await updateMarket(db, admin(), "AE", { ...MARKET_OK, numberingSystem: "arab", notes: "Reviewed" })).toEqual(["numbering_system", "notes"]);
    const { market } = await getMarketDetail(db, support(), "AE");
    expect(market).toMatchObject({ numberingSystem: "arab", updatedByName: "Ops admin" });
    const ev = await listAuditEvents(db, admin(), { eventType: "market.updated" });
    expect(ev.rows[0]!.metadata).toEqual({ fields: "numbering_system,notes" });
  });

  it("can't be edited by other organizations even with raw SQL; rule values aren't writable yet", async () => {
    expect(await raw(f.devAdminId, f.devOrg, "update app.markets set currency = 'USD' where code = 'SA' returning code")).toEqual([]);
    expect(await code(raw(f.adminId, f.plat, "update app.market_rules set status = 'configured'"))).toMatch(/permission denied/);
  });
});

describe("audit filters", () => {
  it("filter by actor, organization and date", async () => {
    const byActor = await listAuditEvents(db, admin(), { actor: "ops admin", limit: 200 });
    expect(byActor.rows.length).toBeGreaterThan(0);
    expect(byActor.rows.every((r) => r.actorName === "Ops admin")).toBe(true);
    const byOrg = await listAuditEvents(db, admin(), { orgId: f.devOrg, limit: 200 });
    expect(byOrg.rows.every((r) => r.orgId === f.devOrg)).toBe(true);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
    expect((await listAuditEvents(db, admin(), { from: today, to: today, timeZone: "Asia/Dubai" })).rows.length).toBeGreaterThan(0);
    expect((await listAuditEvents(db, admin(), { from: "2020-01-01", to: "2020-01-02", timeZone: "Asia/Dubai" })).rows).toEqual([]);
  });

  it("can't widen an organization's view to another org", async () => {
    const { scope, rows } = await listAuditEvents(db, devAdmin(), { orgId: f.plat, limit: 200 });
    expect(scope).toBe("org");
    expect(rows.every((r) => r.orgId === f.devOrg)).toBe(true);
  });

  it("support staff have no audit access", async () => {
    expect(await code(listAuditEvents(db, support()))).toBe("forbidden:audit.view");
  });
});
