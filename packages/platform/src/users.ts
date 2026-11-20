import { canManageAccount, type OrgType, type Role } from "@baytline/core";
import { isUuid, withAppTx, withAuthTx, type Db } from "@baytline/db";
import { IdentityError, writeAudit, type Actor } from "@baytline/identity";
import { likePattern, requirePlatform } from "./guard";

export type UserStatus = "active" | "disabled";

export type UserDirectoryRow = {
  id: string;
  displayName: string;
  email: string;
  status: UserStatus;
  emailVerified: boolean;
  isPlaceholder: boolean;
  createdAt: Date;
  activeMemberships: number;
};

export type UserSearch = { q?: string; status?: string; limit?: number };

export async function searchUsers(db: Db, actor: Actor, s: UserSearch = {}): Promise<UserDirectoryRow[]> {
  return withAppTx(db, actor, async (c) => {
    await requirePlatform(c, actor, "platform.users.view");
    const where: string[] = [];
    const args: unknown[] = [];
    if (s.q?.trim()) {
      const n = args.push(likePattern(s.q));
      where.push(`(u.display_name ilike $${n} or u.email ilike $${n})`);
    }
    if (s.status === "active" || s.status === "disabled") where.push(`u.status = $${args.push(s.status)}`);
    const limit = Math.min(Math.max(s.limit ?? 100, 1), 500);
    const { rows } = await c.query(
      `select u.id, u.display_name, u.email, u.status, u.email_verified_at, u.is_placeholder, u.created_at,
              count(m.id) filter (where m.status = 'active')::int as active_memberships
         from app.users u left join app.memberships m on m.user_id = u.id
        ${where.length ? `where ${where.join(" and ")}` : ""}
        group by u.id
        order by u.display_name
        limit ${limit}`,
      args,
    );
    return rows.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      email: r.email,
      status: r.status,
      emailVerified: r.email_verified_at !== null,
      isPlaceholder: r.is_placeholder,
      createdAt: r.created_at,
      activeMemberships: r.active_memberships,
    }));
  });
}

export type UserMembership = {
  membershipId: string;
  orgId: string;
  orgName: string;
  orgType: OrgType;
  orgStatus: "active" | "suspended";
  role: Role;
  status: "active" | "suspended" | "removed";
  since: Date;
};

export type UserProfile = UserDirectoryRow & {
  memberships: UserMembership[];
  /** From the auth store: counts and dates only, never tokens. */
  activeSessions: number;
  lastActiveAt: Date | null;
  /** Two-step sign-in is on (from the auth store; never the secret). */
  mfaEnrolled: boolean;
  isSelf: boolean;
  canManage: boolean;
};

export async function getUserProfile(db: Db, actor: Actor, userId: string): Promise<UserProfile> {
  if (!isUuid(userId)) throw new IdentityError("not_found");
  const base = await withAppTx(db, actor, async (c) => {
    const { principal } = await requirePlatform(c, actor, "platform.users.view");
    const { rows } = await c.query(
      "select id, display_name, email, status, email_verified_at, is_placeholder, created_at from app.users where id = $1",
      [userId],
    );
    const u = rows[0];
    if (!u) throw new IdentityError("not_found");
    const { rows: ms } = await c.query(
      `select m.id, m.org_id, o.name, o.type, o.status as org_status, m.role, m.status, m.created_at
         from app.memberships m join app.organizations o on o.id = m.org_id
        where m.user_id = $1
        order by (m.status = 'active') desc, (o.type = 'individual'), o.name`,
      [userId],
    );
    return {
      id: u.id,
      displayName: u.display_name,
      email: u.email,
      status: u.status as UserStatus,
      emailVerified: u.email_verified_at !== null,
      isPlaceholder: u.is_placeholder,
      createdAt: u.created_at,
      activeMemberships: ms.filter((m) => m.status === "active").length,
      memberships: ms.map((m) => ({
        membershipId: m.id,
        orgId: m.org_id,
        orgName: m.name,
        orgType: m.type,
        orgStatus: m.org_status,
        role: m.role,
        status: m.status,
        since: m.created_at,
      })),
      isSelf: userId === actor.userId,
      canManage: canManageAccount(principal, userId).ok,
    };
  });
  // Permission was checked above; the auth store answers only for this one user.
  const sessions = await withAuthTx(db, async (c) => {
    const { rows } = await c.query(
      `select count(*)::int as n, max(last_seen_at) as last,
              exists (select 1 from auth.mfa_factors f where f.user_id = $1 and f.confirmed_at is not null) as mfa
         from auth.sessions where user_id = $1 and expires_at > now()`,
      [userId],
    );
    return rows[0];
  });
  return { ...base, activeSessions: sessions.n, lastActiveAt: sessions.last, mfaEnrolled: sessions.mfa };
}

/** Disabling blocks sign-in and ends existing sessions on their next request. Never on yourself. */
export async function setUserStatus(db: Db, actor: Actor, userId: string, status: unknown): Promise<void> {
  if (!isUuid(userId)) throw new IdentityError("not_found");
  if (status !== "active" && status !== "disabled") throw new IdentityError("invalid_input", "status");
  const changed = await withAppTx(db, actor, async (c) => {
    const { principal } = await requirePlatform(c, actor, "platform.users.manage");
    const d = canManageAccount(principal, userId);
    if (!d.ok) throw new IdentityError("forbidden", d.reason);
    const { rows } = await c.query("select status from app.users where id = $1", [userId]);
    if (!rows[0]) throw new IdentityError("not_found");
    if (rows[0].status === status) return false;
    const res = await c.query("update app.users set status = $2 where id = $1", [userId, status]);
    if (res.rowCount !== 1) throw new IdentityError("forbidden", "rls");
    await writeAudit(c, {
      type: status === "disabled" ? "user.disabled" : "user.enabled",
      outcome: "success",
      actorUserId: actor.userId,
      target: { type: "user", id: userId },
    });
    return true;
  });
  // Sessions already stop working (validation requires an active account); this removes them outright.
  if (changed && status === "disabled") await deleteSessions(db, userId);
}

/** "Sign out everywhere" for someone else, e.g. after a lost device. */
export async function revokeUserSessions(db: Db, actor: Actor, userId: string): Promise<number> {
  if (!isUuid(userId)) throw new IdentityError("not_found");
  await withAppTx(db, actor, async (c) => {
    const { principal } = await requirePlatform(c, actor, "platform.users.manage");
    const d = canManageAccount(principal, userId);
    if (!d.ok) throw new IdentityError("forbidden", d.reason);
    const { rowCount } = await c.query("select 1 from app.users where id = $1", [userId]);
    if (!rowCount) throw new IdentityError("not_found");
  });
  const n = await deleteSessions(db, userId);
  await withAppTx(db, { userId: actor.userId }, (c) =>
    writeAudit(c, { type: "user.sessions_revoked", outcome: "success", actorUserId: actor.userId, target: { type: "user", id: userId }, metadata: { sessions: n } }),
  );
  return n;
}

async function deleteSessions(db: Db, userId: string): Promise<number> {
  return withAuthTx(db, async (c) => (await c.query("delete from auth.sessions where user_id = $1", [userId])).rowCount ?? 0);
}
