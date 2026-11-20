import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { ROLES } from "@baytline/core";
import { createDb, withAppTx, type Db } from "@baytline/db";
import {
  acceptInvitation,
  createOrganization,
  getOrgContext,
  getTeam,
  IdentityError,
  inviteMember,
  listAuditEvents,
  listMyMemberships,
  requestPasswordReset,
  resetPassword,
  revokeInvitation,
  signIn,
  signOut,
  signUpCustomer,
  signUpFromInvitation,
  updateMembership,
  validateSession,
  type Mailer,
  type OutgoingMail,
} from "../src";
import { createBootstrapInvitation } from "../src/bootstrap";

let db: Db;
const PW = "a long test passphrase";

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof IdentityError ? `${e.code}${e.detail ? `:${e.detail}` : ""}` : `other:${(e as Error).message}`;
  }
};

/** Raw SQL as the app role with RLS settings, bypassing the service layer. */
const rawApp = <T>(userId: string, orgId: string | null, sql: string, args: unknown[] = []) =>
  withAppTx(db, { userId, orgId }, async (c) => (await c.query(sql, args)).rows as T[]);

// Shared fixtures, built up in order by the first describe block.
const f = {} as {
  platformOrg: string;
  opsId: string;
  devOrg: string;
  devAdminId: string;
  salesId: string;
  salesMembership: string;
  devAdminMembership: string;
  brkOrg: string;
  brkAdminId: string;
  customerId: string;
};

beforeAll(() => {
  db = createDb();
});
afterAll(async () => {
  await db.app.end();
  await db.auth.end();
});

describe("database reference data", () => {
  it("defines exactly the roles in @baytline/core", async () => {
    const owner = new pg.Client({ connectionString: process.env.DATABASE_OWNER_URL });
    await owner.connect();
    const { rows } = await owner.query<{ id: string; org_type: string }>("select id, org_type from app.roles order by id");
    await owner.end();
    const fromCore = Object.entries(ROLES).map(([id, r]) => ({ id, org_type: r.orgType })).sort((a, b) => a.id.localeCompare(b.id));
    expect(rows).toEqual(fromCore);
  });
});

describe("customer accounts", () => {
  it("signs up with a personal workspace and a working session", async () => {
    const s = await signUpCustomer(db, { email: "Buyer@Example.test ", password: PW, displayName: "Test buyer", locale: "en" });
    f.customerId = s.userId;
    const v = await validateSession(db, s.token);
    expect(v?.user.email).toBe("buyer@example.test");
    expect(v?.user.emailVerified).toBe(false);
    const ms = await listMyMemberships(db, s.userId);
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ type: "individual", role: "individual" });
    await signOut(db, s.token);
    expect(await validateSession(db, s.token)).toBeNull();
  });

  it("rejects short passwords and duplicate emails", async () => {
    expect(await code(signUpCustomer(db, { email: "x@example.test", password: "short", displayName: "X", locale: "en" }))).toBe("invalid_input:password_length");
    expect(await code(signUpCustomer(db, { email: "buyer@example.test", password: PW, displayName: "Dup", locale: "en" }))).toBe("conflict:email_taken");
  });

  it("gives one answer for unknown email and wrong password, then throttles", async () => {
    expect(await signIn(db, { email: "nobody@example.test", password: PW })).toEqual({ ok: false, reason: "invalid" });
    for (let i = 0; i < 5; i++) expect((await signIn(db, { email: "buyer@example.test", password: "wrong password!!" })).ok).toBe(false);
    // Correct password is still refused while throttled.
    expect(await signIn(db, { email: "buyer@example.test", password: PW })).toEqual({ ok: false, reason: "throttled" });
  });
});

describe("operator bootstrap and organization onboarding", () => {
  it("bootstraps the first platform admin from a one-time invitation", async () => {
    const { token, orgId } = await createBootstrapInvitation(process.env.DATABASE_OWNER_URL!, { email: "ops@example.test" });
    f.platformOrg = orgId;
    const s = await signUpFromInvitation(db, { token, password: PW, displayName: "Ops", locale: "en" });
    f.opsId = s.userId;
    expect(s.orgId).toBe(orgId);
    expect((await validateSession(db, s.token))?.user.emailVerified).toBe(true);
    // Single use.
    expect(await code(signUpFromInvitation(db, { token, password: PW, displayName: "Again", locale: "en" }))).toBe("invalid_input:invitation_invalid");
  });

  it("lets the platform admin create a developer org and invite its first admin", async () => {
    const r = await createOrganization(db, { userId: f.opsId, orgId: f.platformOrg }, { type: "developer", name: "Test Developer", market: "SA", adminEmail: "devadmin@example.test" });
    f.devOrg = r.orgId;
    const s = await signUpFromInvitation(db, { token: r.token, password: PW, displayName: "Dev admin", locale: "ar" });
    f.devAdminId = s.userId;
    const team = await getTeam(db, { userId: f.devAdminId, orgId: f.devOrg });
    expect(team.members.map((m) => m.role)).toEqual(["developer_admin"]);
    f.devAdminMembership = team.members[0]!.membershipId;
  });

  it("refuses org creation by non-operators", async () => {
    expect(await code(createOrganization(db, { userId: f.devAdminId, orgId: f.devOrg }, { type: "brokerage", name: "Nope", market: "AE", adminEmail: "n@example.test" }))).toBe("forbidden:platform.orgs.manage");
  });

  it("lets the developer admin invite a sales manager, and only roles of its org type", async () => {
    const actor = { userId: f.devAdminId, orgId: f.devOrg };
    expect(await code(inviteMember(db, actor, { email: "x@example.test", role: "brokerage_agent" }))).toBe("invalid_input:role_not_allowed_for_org");
    expect(await code(inviteMember(db, actor, { email: "x@example.test", role: "platform_admin" }))).toBe("invalid_input:role_not_allowed_for_org");
    const inv = await inviteMember(db, actor, { email: "sales@example.test", role: "developer_sales_manager" });
    const s = await signUpFromInvitation(db, { token: inv.token, password: PW, displayName: "Sales", locale: "en" });
    f.salesId = s.userId;
    f.salesMembership = (await getTeam(db, actor)).members.find((m) => m.userId === f.salesId)!.membershipId;
  });

  it("creates a brokerage for isolation tests", async () => {
    const r = await createOrganization(db, { userId: f.opsId, orgId: f.platformOrg }, { type: "brokerage", name: "Test Brokerage", market: "AE", adminEmail: "brkadmin@example.test" });
    f.brkOrg = r.orgId;
    f.brkAdminId = (await signUpFromInvitation(db, { token: r.token, password: PW, displayName: "Brk admin", locale: "en" })).userId;
  });
});

describe("invitations", () => {
  it("binds acceptance to the invited email", async () => {
    const inv = await inviteMember(db, { userId: f.devAdminId, orgId: f.devOrg }, { email: "someone-else@example.test", role: "developer_finance" });
    // The customer is signed in with a different address.
    expect(await code(acceptInvitation(db, f.customerId, inv.token))).toBe("invalid_input:invitation_email_mismatch");
    const failed = await rawApp<{ n: string }>(f.opsId, f.platformOrg, "select count(*) as n from app.audit_events where event_type = 'invitation.accept_failed'");
    expect(Number(failed[0]!.n)).toBeGreaterThan(0);
  });

  it("stops working once revoked", async () => {
    const actor = { userId: f.devAdminId, orgId: f.devOrg };
    const inv = await inviteMember(db, actor, { email: "revoked@example.test", role: "developer_finance" });
    await revokeInvitation(db, actor, inv.invitationId);
    expect(await code(signUpFromInvitation(db, { token: inv.token, password: PW, displayName: "R", locale: "en" }))).toBe("invalid_input:invitation_invalid");
  });

  it("refuses inviting someone who is already a member", async () => {
    expect(await code(inviteMember(db, { userId: f.devAdminId, orgId: f.devOrg }, { email: "sales@example.test", role: "developer_finance" }))).toBe("conflict:already_member");
  });
});

describe("tenant isolation", () => {
  it("hides other orgs in the service layer (as not found)", async () => {
    expect(await getOrgContext(db, { userId: f.brkAdminId, orgId: f.devOrg })).toBeNull();
    expect(await code(getTeam(db, { userId: f.brkAdminId, orgId: f.devOrg }))).toBe("not_found");
    expect(await code(inviteMember(db, { userId: f.brkAdminId, orgId: f.brkOrg }, { orgId: f.devOrg, email: "a@example.test", role: "developer_admin" }))).toBe("not_found");
    expect(await code(updateMembership(db, { userId: f.brkAdminId, orgId: f.brkOrg }, f.salesMembership, { status: "removed" }))).toBe("not_found");
  });

  it("hides other orgs in the database even with hand-written SQL", async () => {
    // Brokerage admin claims the developer org as active org: RLS still returns nothing.
    for (const orgId of [f.brkOrg, f.devOrg]) {
      expect(await rawApp(f.brkAdminId, orgId, "select * from app.memberships where org_id = $1", [f.devOrg])).toEqual([]);
      expect(await rawApp(f.brkAdminId, orgId, "select id from app.invitations where org_id = $1", [f.devOrg])).toEqual([]);
      expect(await rawApp(f.brkAdminId, orgId, "select id from app.audit_events where org_id = $1", [f.devOrg])).toEqual([]);
      expect(await rawApp(f.brkAdminId, orgId, "select id from app.organizations where id = $1", [f.devOrg])).toEqual([]);
    }
    const users = await rawApp<{ email: string }>(f.brkAdminId, f.brkOrg, "select email from app.users");
    expect(users.map((u) => u.email).sort()).toEqual(["brkadmin@example.test"]);
    const updated = await rawApp(f.brkAdminId, f.brkOrg, "update app.memberships set status = 'removed' where org_id = $1 returning id", [f.devOrg]);
    expect(updated).toEqual([]);
  });

  it("returns nothing at all without an authenticated user", async () => {
    await withAppTx(db, { userId: null }, async (c) => {
      for (const t of ["users", "organizations", "memberships", "invitations", "audit_events"]) {
        expect((await c.query(`select 1 from app.${t}`)).rowCount).toBe(0);
      }
    });
  });

  it("never exposes credentials or sessions to the app role", async () => {
    expect(await code(rawApp(f.opsId, f.platformOrg, "select * from auth.credentials"))).toMatch(/permission denied/);
    expect(await code(rawApp(f.opsId, f.platformOrg, "select * from auth.sessions"))).toMatch(/permission denied/);
    expect(await code(rawApp(f.opsId, f.platformOrg, "select token_hash from app.invitations"))).toMatch(/permission denied/);
  });
});

describe("no self-escalation", () => {
  it("blocks changing your own role or status in the service layer", async () => {
    const actor = { userId: f.devAdminId, orgId: f.devOrg };
    expect(await code(updateMembership(db, actor, f.devAdminMembership, { role: "developer_finance" }))).toBe("forbidden:self_change");
    const sales = { userId: f.salesId, orgId: f.devOrg };
    expect(await code(updateMembership(db, sales, f.salesMembership, { role: "developer_admin" }))).toBe("forbidden:self_change");
  });

  it("blocks it in the database too", async () => {
    const rows = await rawApp(f.salesId, f.devOrg, "update app.memberships set role = 'developer_admin' where user_id = $1 returning id", [f.salesId]);
    expect(rows).toEqual([]);
    const role = await rawApp<{ role: string }>(f.devAdminId, f.devOrg, "select role from app.memberships where id = $1", [f.salesMembership]);
    expect(role[0]!.role).toBe("developer_sales_manager");
  });

  it("stops non-admins from managing others", async () => {
    expect(await code(updateMembership(db, { userId: f.salesId, orgId: f.devOrg }, f.devAdminMembership, { status: "suspended" }))).toBe("forbidden:no_permission");
    expect(await code(inviteMember(db, { userId: f.salesId, orgId: f.devOrg }, { email: "z@example.test", role: "developer_admin" }))).toBe("forbidden:no_permission");
  });

  it("keeps at least one administrator", async () => {
    const ops = { userId: f.opsId, orgId: f.platformOrg };
    expect(await code(updateMembership(db, ops, f.devAdminMembership, { role: "developer_finance" }))).toBe("last_admin");
    expect(await code(updateMembership(db, ops, f.devAdminMembership, { status: "removed" }))).toBe("last_admin");
  });
});

describe("membership changes take effect immediately", () => {
  it("removes access on suspension and restores it on reactivation", async () => {
    const admin = { userId: f.devAdminId, orgId: f.devOrg };
    await updateMembership(db, admin, f.salesMembership, { status: "suspended" });
    expect(await getOrgContext(db, { userId: f.salesId, orgId: f.devOrg })).toBeNull();
    await updateMembership(db, admin, f.salesMembership, { status: "active" });
    expect(await getOrgContext(db, { userId: f.salesId, orgId: f.devOrg })).not.toBeNull();
    await updateMembership(db, admin, f.salesMembership, { role: "developer_finance" });
    expect((await getOrgContext(db, { userId: f.salesId, orgId: f.devOrg }))?.org.role).toBe("developer_finance");
  });
});

describe("audit history", () => {
  it("shows org admins only their own org's events", async () => {
    const { scope, rows } = await listAuditEvents(db, { userId: f.devAdminId, orgId: f.devOrg }, { limit: 200 });
    expect(scope).toBe("org");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.orgId === f.devOrg)).toBe(true);
    expect(rows.map((r) => r.eventType)).toEqual(expect.arrayContaining(["org.created", "invitation.created", "invitation.accepted", "membership.role_changed", "membership.suspended", "access.denied"]));
  });

  it("is restricted by permission", async () => {
    // Developer finance has audit.view; brokerage admins can't see developer events at all.
    expect(await code(listAuditEvents(db, { userId: f.brkAdminId, orgId: f.devOrg }))).toBe("not_found");
    const customerOrg = (await listMyMemberships(db, f.customerId))[0]!.id;
    expect(await code(listAuditEvents(db, { userId: f.customerId, orgId: customerOrg }))).toBe("forbidden:audit.view");
  });

  it("shows platform audit roles everything, including sign-in outcomes", async () => {
    const { scope, rows } = await listAuditEvents(db, { userId: f.opsId, orgId: f.platformOrg }, { limit: 200 });
    expect(scope).toBe("platform");
    const types = new Set(rows.map((r) => r.eventType));
    for (const t of ["auth.sign_up", "auth.sign_in.failed", "auth.sign_in.throttled", "auth.sign_out", "org.created"]) expect(types).toContain(t);
  });

  it("is append-only and holds no secrets", async () => {
    expect(await code(rawApp(f.opsId, f.platformOrg, "update app.audit_events set outcome = 'success'"))).toMatch(/permission denied/);
    expect(await code(rawApp(f.opsId, f.platformOrg, "delete from app.audit_events"))).toMatch(/permission denied/);
    const owner = new pg.Client({ connectionString: process.env.DATABASE_OWNER_URL });
    await owner.connect();
    expect(await code(owner.query("delete from app.audit_events"))).toMatch(/append-only/);
    const { rows } = await owner.query<{ blob: string }>("select string_agg(metadata::text || coalesce(target_id,''), ' ') as blob from app.audit_events");
    await owner.end();
    expect(rows[0]!.blob).not.toMatch(/@|scrypt\$|passphrase/);
  });
});

describe("account recovery", () => {
  const outbox: OutgoingMail[] = [];
  const mailer: Mailer = { configured: true, kind: "dev-console", send: async (m) => void outbox.push(m) };
  const resetUrl = (t: string) => `http://localhost/en/reset-password?token=${t}`;

  it("says plainly when email isn't configured", async () => {
    const none: Mailer = { configured: false, kind: "none", send: async () => {} };
    expect(await requestPasswordReset(db, { email: "sales@example.test", mailer: none, resetUrl })).toEqual({ delivery: "email_not_configured" });
  });

  it("answers the same for unknown addresses and sends nothing", async () => {
    expect(await requestPasswordReset(db, { email: "ghost@example.test", mailer, resetUrl })).toEqual({ delivery: "sent_if_account_exists" });
    expect(outbox).toHaveLength(0);
  });

  it("resets once, signs out everywhere, and the old password stops working", async () => {
    const before = await signIn(db, { email: "sales@example.test", password: PW });
    expect(before.ok).toBe(true);
    await requestPasswordReset(db, { email: "sales@example.test", mailer, resetUrl });
    const token = new URL(outbox[0]!.text.match(/http\S+/)![0]).searchParams.get("token")!;
    await resetPassword(db, { token, password: "a brand new passphrase" });
    if (before.ok) expect(await validateSession(db, before.session.token)).toBeNull();
    expect((await signIn(db, { email: "sales@example.test", password: PW })).ok).toBe(false);
    expect((await signIn(db, { email: "sales@example.test", password: "a brand new passphrase" })).ok).toBe(true);
    expect(await code(resetPassword(db, { token, password: "another passphrase!" }))).toBe("invalid_input:token_invalid");
  });
});
