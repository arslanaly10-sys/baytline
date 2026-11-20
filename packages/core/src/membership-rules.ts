import { can, hasCapability, type Principal } from "./access";
import { ROLES, type OrgType, type Role } from "./roles";

export type MembershipStatus = "active" | "suspended" | "removed";
export type OrgRef = { id: string; type: OrgType };

/** Roles that can be granted inside an organization of this type. */
export function assignableRoles(orgType: OrgType): Role[] {
  if (orgType === "individual") return []; // personal organizations are never shared
  return (Object.keys(ROLES) as Role[]).filter((r) => ROLES[r].orgType === orgType);
}

export function isRoleForOrgType(role: string, orgType: OrgType): role is Role {
  return (assignableRoles(orgType) as string[]).includes(role);
}

export type Denial =
  | "no_permission"
  | "self_change"
  | "role_not_allowed_for_org"
  | "personal_org";

export type Decision = { ok: true } | { ok: false; reason: Denial };
const deny = (reason: Denial): Decision => ({ ok: false, reason });
const allow: Decision = { ok: true };

/**
 * Inviting: org administrators for their own org; platform administrators
 * (platform.users.manage) for any org, e.g. to replace a lost administrator.
 */
export function canInvite(p: Principal, org: OrgRef, role: string): Decision {
  if (org.type === "individual") return deny("personal_org");
  const allowed = can(p, "org.members.manage", { ownerOrgId: org.id }) || hasCapability(p, "platform.users.manage");
  if (!allowed) return deny("no_permission");
  if (!isRoleForOrgType(role, org.type)) return deny("role_not_allowed_for_org");
  return allow;
}

/** Changing someone's role or status. Nobody may change their own membership. */
export function canChangeMember(p: Principal, org: OrgRef, targetUserId: string, newRole?: string): Decision {
  if (org.type === "individual") return deny("personal_org");
  if (targetUserId === p.userId) return deny("self_change");
  const allowed = can(p, "org.members.manage", { ownerOrgId: org.id }) || hasCapability(p, "platform.users.manage");
  if (!allowed) return deny("no_permission");
  if (newRole !== undefined && !isRoleForOrgType(newRole, org.type)) return deny("role_not_allowed_for_org");
  return allow;
}

/** Audit history: platform-wide for platform audit roles, otherwise the active org only. */
export function auditScope(p: Principal, orgId: string): "platform" | "org" | null {
  if (!can(p, "audit.view", { ownerOrgId: orgId })) return null;
  const m = p.memberships.find((x) => x.orgId === p.activeOrgId);
  return m?.orgType === "platform" ? "platform" : "org";
}

/** Account-level actions (disable, sign out everywhere): platform administrators, never on themselves. */
export function canManageAccount(p: Principal, targetUserId: string): Decision {
  if (targetUserId === p.userId) return deny("self_change");
  return hasCapability(p, "platform.users.manage") ? allow : deny("no_permission");
}
