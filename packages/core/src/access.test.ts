import { describe, expect, it } from "vitest";
import { can, canApprove, hasCapability, type Principal } from "./access";
import { approverPermission, PERMISSIONS, ROLE_GRANTS, type Permission } from "./permissions";
import { ROLES, type Role } from "./roles";

const agent: Principal = {
  userId: "u-agent",
  actorKind: "human",
  activeOrgId: "brk-1",
  memberships: [{ orgId: "brk-1", orgType: "brokerage", roles: ["brokerage_agent"] }],
};

describe("organization boundaries", () => {
  it("denies access to another org's records", () => {
    expect(can(agent, "inventory.view", { ownerOrgId: "dev-1" })).toBe(false);
  });

  it("allows shared inventory only when explicitly shared with the active org", () => {
    expect(can(agent, "inventory.view", { ownerOrgId: "dev-1", sharedWithOrgIds: ["brk-1"] })).toBe(true);
    expect(can(agent, "inventory.view", { ownerOrgId: "dev-1", sharedWithOrgIds: ["brk-2"] })).toBe(false);
  });

  it("limits agents to leads assigned to them", () => {
    expect(can(agent, "lead.view", { ownerOrgId: "brk-1", assigneeUserId: "u-agent" })).toBe(true);
    expect(can(agent, "lead.view", { ownerOrgId: "brk-1", assigneeUserId: "u-other" })).toBe(false);
  });

  it("evaluates only the active membership", () => {
    const multi: Principal = {
      ...agent,
      memberships: [...agent.memberships, { orgId: "dev-1", orgType: "developer", roles: ["developer_admin"] }],
    };
    expect(can(multi, "price.change.approve", { ownerOrgId: "dev-1" })).toBe(false);
    expect(can({ ...multi, activeOrgId: "dev-1" }, "price.change.approve", { ownerOrgId: "dev-1" })).toBe(true);
  });

  it("denies when the active org is not one of the memberships", () => {
    expect(hasCapability({ ...agent, activeOrgId: "dev-1" }, "inventory.view")).toBe(false);
  });

  it("lets individuals browse only published listings", () => {
    const buyer: Principal = {
      userId: "u-buyer",
      actorKind: "human",
      activeOrgId: "ind-u-buyer",
      memberships: [{ orgId: "ind-u-buyer", orgType: "individual", roles: ["individual"] }],
    };
    expect(can(buyer, "listing.browse", { ownerOrgId: "dev-1", published: true })).toBe(true);
    expect(can(buyer, "listing.browse", { ownerOrgId: "dev-1" })).toBe(false);
  });
});

describe("AI and consequential actions", () => {
  it("restricts AI assistants to read-only, even for privileged users", () => {
    const ai: Principal = {
      userId: "u-dev",
      actorKind: "ai_assistant",
      activeOrgId: "dev-1",
      memberships: [{ orgId: "dev-1", orgType: "developer", roles: ["developer_admin"] }],
    };
    expect(can(ai, "inventory.view", { ownerOrgId: "dev-1" })).toBe(true);
    expect(can(ai, "price.change.approve", { ownerOrgId: "dev-1" })).toBe(false);
    expect(can(ai, "unit.hold.approve", { ownerOrgId: "dev-1" })).toBe(false);
    expect(hasCapability(ai, "lead.manage")).toBe(false);
  });

  it("requires a different person to approve", () => {
    const manager: Principal = {
      userId: "u-mgr",
      actorKind: "human",
      activeOrgId: "dev-1",
      memberships: [{ orgId: "dev-1", orgType: "developer", roles: ["developer_sales_manager"] }],
    };
    const req = { action: "unit.hold.request" as const, requestedBy: "u-mgr", resource: { ownerOrgId: "dev-1" } };
    expect(canApprove(manager, req)).toBe(false);
    expect(canApprove(manager, { ...req, requestedBy: "u-agent" })).toBe(true);
  });
});

describe("grant table integrity", () => {
  it("defines grants for every role and only known permissions", () => {
    for (const role of Object.keys(ROLES) as Role[]) {
      expect(ROLE_GRANTS[role]).toBeDefined();
      for (const [perm] of ROLE_GRANTS[role]) expect(PERMISSIONS[perm]).toBeDefined();
    }
  });

  it("gives every approval-gated action an approver role", () => {
    const granted = new Set(Object.values(ROLE_GRANTS).flatMap((gs) => gs.map(([p]) => p)));
    for (const p of Object.keys(PERMISSIONS) as Permission[]) {
      const approver = approverPermission(p);
      if (approver) expect(granted.has(approver)).toBe(true);
    }
  });
});
