import {
  assignableRoles,
  can,
  canChangeMember,
  canInvite,
  hasCapability,
  type MembershipStatus,
  type OrgType,
  type Role,
} from "@baytline/core";
import { isUuid, withAppTx, type Client, type Db } from "@baytline/db";
import { writeAudit } from "./audit";
import { requireContext, type Actor } from "./context";
import { newToken, sha256 } from "./crypto";
import { IdentityError } from "./errors";
import { normalizeEmail } from "./validation";

export const INVITATION_DAYS = 7;

export type MemberRow = {
  membershipId: string;
  userId: string;
  displayName: string;
  email: string;
  isPlaceholder: boolean;
  role: Role;
  status: MembershipStatus;
  joinedAt: Date;
  isSelf: boolean;
};

export type InvitationRow = {
  id: string;
  email: string;
  role: Role;
  state: "pending" | "expired";
  expiresAt: Date;
  invitedByName: string | null;
};

export type TeamView = {
  orgId: string;
  orgType: OrgType;
  canManage: boolean;
  assignableRoles: Role[];
  members: MemberRow[];
  invitations: InvitationRow[];
};

/** Members and open invitations of an organization (the actor's active org, or any org for platform operators). */
export async function getTeam(db: Db, actor: Actor, targetOrgId = actor.orgId): Promise<TeamView> {
  if (!isUuid(targetOrgId)) throw new IdentityError("not_found");
  return withAppTx(db, actor, async (c) => {
    const { principal } = await requireContext(c, actor);
    // Platform staff may view any organization's members; changing them needs platform.users.manage (canInvite/canChangeMember).
    const staff = hasCapability(principal, "platform.orgs.view");
    if (targetOrgId !== actor.orgId && !staff) throw new IdentityError("not_found");
    if (targetOrgId === actor.orgId && !can(principal, "org.members.view", { ownerOrgId: targetOrgId }) && !staff) {
      throw new IdentityError("forbidden", "org.members.view");
    }
    const org = await loadOrg(c, targetOrgId);

    const { rows: members } = await c.query(
      `select m.id, m.user_id, m.role, m.status, m.created_at, u.display_name, u.email, u.is_placeholder
         from app.memberships m join app.users u on u.id = m.user_id
        where m.org_id = $1 and m.status <> 'removed'
        order by m.status, u.display_name`,
      [targetOrgId],
    );
    const { rows: invites } = await c.query(
      `select i.id, i.email, i.role, i.expires_at, (i.expires_at < now()) as expired, u.display_name as invited_by_name
         from app.invitations i left join app.users u on u.id = i.invited_by
        where i.org_id = $1 and i.status = 'pending'
        order by i.created_at desc`,
      [targetOrgId],
    );
    const manage = canInvite(principal, org, assignableRoles(org.type)[0] ?? "").ok;
    return {
      orgId: targetOrgId,
      orgType: org.type,
      canManage: manage,
      assignableRoles: manage ? assignableRoles(org.type) : [],
      members: members.map((r) => ({
        membershipId: r.id,
        userId: r.user_id,
        displayName: r.display_name,
        email: r.email,
        isPlaceholder: r.is_placeholder,
        role: r.role,
        status: r.status,
        joinedAt: r.created_at,
        isSelf: r.user_id === actor.userId,
      })),
      invitations: invites.map((r) => ({
        id: r.id,
        email: r.email,
        role: r.role,
        state: r.expired ? "expired" : "pending",
        expiresAt: r.expires_at,
        invitedByName: r.invited_by_name,
      })),
    };
  });
}

async function loadOrg(c: Client, orgId: string): Promise<{ id: string; type: OrgType }> {
  const { rows } = await c.query<{ id: string; type: OrgType }>("select id, type from app.organizations where id = $1", [orgId]);
  if (!rows[0]) throw new IdentityError("not_found");
  return rows[0];
}

/** Shared by inviteMember and createOrganization. Assumes permission is already checked. */
export async function insertInvitation(
  c: Client,
  a: { orgId: string; email: string; role: Role; invitedBy: string | null; actorOrgId: string },
): Promise<{ invitationId: string; token: string }> {
  const existing = await c.query(
    `select 1 from app.memberships m join app.users u on u.id = m.user_id
      where m.org_id = $1 and u.email = $2 and m.status <> 'removed'`,
    [a.orgId, a.email],
  );
  if (existing.rowCount) throw new IdentityError("conflict", "already_member");
  // A newer invitation replaces an older pending one for the same address.
  await c.query(
    "update app.invitations set status = 'revoked', revoked_at = now(), revoked_by = $3 where org_id = $1 and email = $2 and status = 'pending'",
    [a.orgId, a.email, a.invitedBy],
  );
  const token = newToken();
  const { rows } = await c.query<{ id: string }>(
    `insert into app.invitations (org_id, email, role, token_hash, invited_by, expires_at)
     values ($1, $2, $3, $4, $5, now() + make_interval(days => $6)) returning id`,
    [a.orgId, a.email, a.role, sha256(token), a.invitedBy, INVITATION_DAYS],
  );
  const invitationId = rows[0]!.id;
  await writeAudit(c, {
    type: "invitation.created",
    outcome: "success",
    actorUserId: a.invitedBy,
    orgId: a.orgId,
    target: { type: "invitation", id: invitationId },
    metadata: { role: a.role },
  });
  return { invitationId, token };
}

/** Returns the raw token exactly once, so the caller can show or email the link. */
export async function inviteMember(
  db: Db,
  actor: Actor,
  input: { orgId?: string; email: unknown; role: unknown },
): Promise<{ invitationId: string; token: string; email: string }> {
  const email = normalizeEmail(input.email);
  const orgId = input.orgId ?? actor.orgId;
  if (!isUuid(orgId)) throw new IdentityError("not_found");
  const result = await withAppTx(db, actor, async (c) => {
    const { principal } = await requireContext(c, actor);
    const org = await loadOrg(c, orgId); // not_found when RLS hides the org
    const decision = canInvite(principal, org, String(input.role));
    if (!decision.ok) return { denied: decision.reason } as const;
    const r = await insertInvitation(c, { orgId, email, role: input.role as Role, invitedBy: actor.userId, actorOrgId: actor.orgId });
    return { ...r, email };
  });
  if ("denied" in result && result.denied) {
    await auditDenial(db, actor.userId, orgId, { type: "action", id: "invitation.create" }, { reason: result.denied });
    throw denialError(result.denied);
  }
  return result;
}

export async function revokeInvitation(db: Db, actor: Actor, invitationId: string): Promise<void> {
  if (!isUuid(invitationId)) throw new IdentityError("not_found");
  await withAppTx(db, actor, async (c) => {
    const { principal } = await requireContext(c, actor);
    const { rows } = await c.query<{ org_id: string; type: OrgType; role: string }>(
      `select i.org_id, o.type, i.role from app.invitations i join app.organizations o on o.id = i.org_id
        where i.id = $1 and i.status = 'pending' for update of i`,
      [invitationId],
    );
    const inv = rows[0];
    if (!inv) throw new IdentityError("not_found");
    const d = canInvite(principal, { id: inv.org_id, type: inv.type }, inv.role);
    if (!d.ok) throw new IdentityError("forbidden", d.reason);
    await c.query("update app.invitations set status = 'revoked', revoked_at = now(), revoked_by = $2 where id = $1", [invitationId, actor.userId]);
    await writeAudit(c, { type: "invitation.revoked", outcome: "success", actorUserId: actor.userId, orgId: inv.org_id, target: { type: "invitation", id: invitationId } });
  });
}

type MembershipChange = { role: unknown } | { status: "active" | "suspended" | "removed" };
type ChangeEvent = "membership.role_changed" | "membership.suspended" | "membership.reactivated" | "membership.removed";

/**
 * Change another member's role or status. Permission check and update happen in
 * one transaction; RLS independently blocks anyone changing their own row.
 */
export async function updateMembership(db: Db, actor: Actor, membershipId: string, change: MembershipChange): Promise<void> {
  if (!isUuid(membershipId)) throw new IdentityError("not_found");
  const result = await withAppTx(db, actor, async (c) => {
    const { principal } = await requireContext(c, actor);
    // No FOR UPDATE: RLS would hide your own row and mask the clearer self_change denial.
    // The UPDATE takes the row lock, and the last-admin trigger re-checks under it.
    const { rows } = await c.query<{ org_id: string; type: OrgType; user_id: string; role: Role; status: MembershipStatus }>(
      `select m.org_id, o.type, m.user_id, m.role, m.status
         from app.memberships m join app.organizations o on o.id = m.org_id
        where m.id = $1`,
      [membershipId],
    );
    const m = rows[0];
    if (!m || m.status === "removed") throw new IdentityError("not_found");
    const newRole = "role" in change ? String(change.role) : undefined;
    const d = canChangeMember(principal, { id: m.org_id, type: m.type }, m.user_id, newRole);
    if (!d.ok) {
      return { denied: d.reason, orgId: m.org_id, attempted: newRole !== undefined ? "role_change" : `status_${(change as { status: string }).status}` } as const;
    }

    let event: ChangeEvent;
    let from: string;
    let to: string;
    if (newRole !== undefined) {
      [event, from, to] = ["membership.role_changed", m.role, newRole];
    } else {
      to = (change as { status: MembershipStatus }).status;
      from = m.status;
      event = to === "active" ? "membership.reactivated" : to === "suspended" ? "membership.suspended" : "membership.removed";
    }
    if (from === to) return { done: true } as const;

    await c.query("savepoint change");
    try {
      const res = await c.query(
        `update app.memberships set ${event === "membership.role_changed" ? "role" : "status"} = $2, updated_at = now(), updated_by = $3
          where id = $1 and status <> 'removed'`,
        [membershipId, to, actor.userId],
      );
      // RLS filters silently; never report success for a change that didn't happen.
      if (res.rowCount !== 1) throw new IdentityError("forbidden", "rls");
    } catch (e) {
      if (e instanceof Error && e.message === "last_admin") {
        await c.query("rollback to savepoint change");
        return { lastAdmin: true } as const;
      }
      throw e;
    }
    await writeAudit(c, {
      type: event,
      outcome: "success",
      actorUserId: actor.userId,
      orgId: m.org_id,
      target: { type: "membership", id: membershipId },
      metadata: { from, to, subjectUserId: m.user_id },
    });
    return { done: true } as const;
  });

  if ("denied" in result && result.denied) {
    await auditDenial(db, actor.userId, result.orgId!, { type: "membership", id: membershipId }, { reason: result.denied, attempted: result.attempted! });
    throw denialError(result.denied);
  }
  if ("lastAdmin" in result) throw new IdentityError("last_admin");
}

async function auditDenial(
  db: Db,
  userId: string,
  orgId: string,
  target: { type: string; id: string },
  metadata: Record<string, string>,
): Promise<void> {
  // Separate transaction: the denied operation's own transaction is rolled back.
  await withAppTx(db, { userId }, (c) =>
    writeAudit(c, { type: "access.denied", outcome: "denied", actorUserId: userId, orgId, target, metadata }),
  );
}

function denialError(reason: string): IdentityError {
  return new IdentityError(reason === "role_not_allowed_for_org" ? "invalid_input" : "forbidden", reason);
}

export type AcceptFailure = "invitation_invalid" | "invitation_email_mismatch" | "invitation_self" | "already_member";

/** Accepts for the signed-in user. The database checks token, expiry and email match. */
export async function acceptInvitation(db: Db, userId: string, token: string): Promise<string> {
  if (typeof token !== "string" || token.length > 100) throw new IdentityError("invalid_input", "invitation_invalid");
  try {
    return await withAppTx(db, { userId }, async (c) => {
      const { rows } = await c.query<{ org_id: string }>("select org_id from app.accept_invitation($1)", [sha256(token)]);
      return rows[0]!.org_id;
    });
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    if (["invitation_invalid", "invitation_email_mismatch", "invitation_self", "already_member"].includes(code)) {
      await withAppTx(db, { userId }, (c) =>
        writeAudit(c, { type: "invitation.accept_failed", outcome: "denied", actorUserId: userId, metadata: { reason: code } }),
      );
      throw new IdentityError("invalid_input", code);
    }
    throw e;
  }
}
