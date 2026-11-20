import { describe, expect, it } from "vitest";
import type { Principal } from "./access";
import { assignableRoles, auditScope, canChangeMember, canInvite, canManageAccount } from "./membership-rules";

const p = (userId: string, orgId: string, orgType: Principal["memberships"][number]["orgType"], role: Principal["memberships"][number]["roles"][number]): Principal => ({
  userId,
  actorKind: "human",
  activeOrgId: orgId,
  memberships: [{ orgId, orgType, roles: [role] }],
});

const brk = { id: "brk-1", type: "brokerage" as const };
const admin = p("u-admin", "brk-1", "brokerage", "brokerage_admin");
const agent = p("u-agent", "brk-1", "brokerage", "brokerage_agent");
const platform = p("u-ops", "plat", "platform", "platform_admin");

describe("membership rules", () => {
  it("lets org admins invite only roles of their org type", () => {
    expect(canInvite(admin, brk, "brokerage_agent")).toEqual({ ok: true });
    expect(canInvite(admin, brk, "developer_admin")).toEqual({ ok: false, reason: "role_not_allowed_for_org" });
    expect(canInvite(admin, brk, "platform_admin")).toEqual({ ok: false, reason: "role_not_allowed_for_org" });
  });

  it("denies agents and other orgs' admins", () => {
    expect(canInvite(agent, brk, "brokerage_agent").ok).toBe(false);
    expect(canInvite(admin, { id: "brk-2", type: "brokerage" }, "brokerage_agent").ok).toBe(false);
  });

  it("lets platform operators invite the first admin of any org", () => {
    expect(canInvite(platform, { id: "dev-9", type: "developer" }, "developer_admin")).toEqual({ ok: true });
  });

  it("never allows changing your own membership", () => {
    expect(canChangeMember(admin, brk, "u-admin", "brokerage_agent")).toEqual({ ok: false, reason: "self_change" });
    expect(canChangeMember(admin, brk, "u-agent", "brokerage_manager")).toEqual({ ok: true });
    expect(canChangeMember(agent, brk, "u-admin", "brokerage_agent")).toEqual({ ok: false, reason: "no_permission" });
  });

  it("never shares personal organizations", () => {
    expect(assignableRoles("individual")).toEqual([]);
    expect(canInvite(platform, { id: "ind-1", type: "individual" }, "individual").ok).toBe(false);
  });

  it("keeps support staff read-only", () => {
    const support = p("u-sup", "plat", "platform", "platform_support");
    expect(canInvite(support, { id: "dev-9", type: "developer" }, "developer_admin").ok).toBe(false);
    expect(canChangeMember(support, brk, "u-agent", "brokerage_manager").ok).toBe(false);
    expect(canManageAccount(support, "u-agent").ok).toBe(false);
    expect(canManageAccount(platform, "u-agent")).toEqual({ ok: true });
    expect(canManageAccount(platform, "u-ops")).toEqual({ ok: false, reason: "self_change" });
  });

  it("scopes audit history", () => {
    expect(auditScope(platform, "plat")).toBe("platform");
    expect(auditScope(admin, "brk-1")).toBe("org");
    expect(auditScope(agent, "brk-1")).toBeNull();
  });
});

import { ROLE_GRANTS } from "./permissions";
import { TENANT_CONTACT_ROLES } from "./management";
describe("tenant contact visibility", () => {
  it("matches the roles the database allows", () => {
    const holders = Object.entries(ROLE_GRANTS).filter(([, gs]) => gs.some(([p]) => p === "tenant.contact.view")).map(([r]) => r).sort();
    expect(holders).toEqual([...TENANT_CONTACT_ROLES].sort());
  });
});
