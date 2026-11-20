import { approverPermission, PERMISSIONS, ROLE_GRANTS, type Permission, type Scope } from "./permissions";
import type { OrgType, Role } from "./roles";

export type Membership = {
  orgId: string;
  orgType: OrgType;
  roles: readonly Role[];
};

export type ActorKind = "human" | "ai_assistant" | "integration";

export type Principal = {
  userId: string;
  /** Who is acting. An AI assistant acts on behalf of `userId` with reduced powers. */
  actorKind: ActorKind;
  memberships: readonly Membership[];
  /** Every check is evaluated against this one org only — never a union of all memberships. */
  activeOrgId: string;
};

/** The minimum a resource must expose for an access decision. */
export type ResourceRef = {
  ownerOrgId: string;
  sharedWithOrgIds?: readonly string[];
  assigneeUserId?: string;
  subjectUserId?: string;
  /** True only once a listing has passed publishing rules (incl. provenance checks). */
  published?: boolean;
};

export function activeMembership(p: Principal): Membership | undefined {
  return p.memberships.find((m) => m.orgId === p.activeOrgId);
}

function scopesFor(p: Principal, permission: Permission): Scope[] {
  const m = activeMembership(p);
  if (!m) return [];
  return m.roles.flatMap((role) =>
    ROLE_GRANTS[role].filter(([perm]) => perm === permission).map(([, scope]) => scope),
  );
}

function actorMayUse(p: Principal, permission: Permission): boolean {
  const { effect } = PERMISSIONS[permission];
  // AI assistants may only read on the user's behalf. Drafts they produce are
  // separate objects that a human reviews and sends.
  if (p.actorKind === "ai_assistant") return effect === "read";
  // Integrations write through dedicated, source-specific ingestion paths, never via role grants.
  if (p.actorKind === "integration") return false;
  return true;
}

/** Coarse check: does the active membership hold this capability at all? Used for navigation. */
export function hasCapability(p: Principal, permission: Permission): boolean {
  return actorMayUse(p, permission) && scopesFor(p, permission).length > 0;
}

function scopeMatches(scope: Scope, p: Principal, r: ResourceRef): boolean {
  const inOrg = r.ownerOrgId === p.activeOrgId;
  const shared = inOrg || (r.sharedWithOrgIds?.includes(p.activeOrgId) ?? false);
  switch (scope) {
    case "platform":
      return true;
    case "org":
      return inOrg;
    case "shared":
      return shared;
    case "assigned":
      return shared && r.assigneeUserId === p.userId;
    case "self":
      return r.subjectUserId === p.userId;
    case "public":
      return r.published === true;
  }
}

/** Fine-grained check against a specific record. Deny by default. */
export function can(p: Principal, permission: Permission, resource: ResourceRef): boolean {
  if (!actorMayUse(p, permission)) return false;
  return scopesFor(p, permission).some((s) => scopeMatches(s, p, resource));
}

export type ApprovalRequest = {
  action: Permission;
  requestedBy: string;
  resource: ResourceRef;
};

export function requiresApproval(permission: Permission): boolean {
  return approverPermission(permission) !== undefined;
}

/** Approval needs the approver permission on the record AND a different person (separation of duties). */
export function canApprove(p: Principal, req: ApprovalRequest): boolean {
  const approver = approverPermission(req.action);
  if (!approver) return false;
  if (p.userId === req.requestedBy) return false;
  return can(p, approver, req.resource);
}
