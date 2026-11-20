import type { MarketCode, Membership, OrgType, Principal, Role } from "@baytline/core";
import { isUuid, withAppTx, type Client, type Db } from "@baytline/db";
import { IdentityError } from "./errors";

/** Who is acting and in which organization. Roles are never taken from the caller. */
export type Actor = { userId: string; orgId: string };

export type OrgSummary = {
  id: string;
  type: OrgType;
  name: string;
  market: MarketCode | null;
  status: "active" | "suspended";
};

export type MyMembership = OrgSummary & { membershipId: string; role: Role };

/** Active memberships in active organizations. RLS returns only the user's own rows. */
export async function loadMyMemberships(c: Client): Promise<MyMembership[]> {
  const { rows } = await c.query(
    `select m.id as membership_id, m.role, o.id, o.type, o.name, o.market, o.status
       from app.memberships m
       join app.organizations o on o.id = m.org_id
      where m.user_id = app.current_user_id() and m.status = 'active' and o.status = 'active'
      order by (o.type = 'individual'), o.name`,
  );
  return rows.map((r) => ({
    membershipId: r.membership_id,
    role: r.role,
    id: r.id,
    type: r.type,
    name: r.name,
    market: r.market,
    status: r.status,
  }));
}

export function principalFrom(userId: string, memberships: MyMembership[], activeOrgId: string): Principal {
  return {
    userId,
    actorKind: "human",
    activeOrgId,
    memberships: memberships.map((m): Membership => ({ orgId: m.id, orgType: m.type, roles: [m.role] })),
  };
}

export type OrgContext = { org: MyMembership; principal: Principal; memberships: MyMembership[] };

/**
 * Loads the actor's membership in actor.orgId from the database, inside the
 * caller's transaction. Throws not_found if the user isn't an active member.
 */
export async function requireContext(c: Client, actor: Actor): Promise<OrgContext> {
  if (!isUuid(actor.orgId)) throw new IdentityError("not_found");
  const memberships = await loadMyMemberships(c);
  const org = memberships.find((m) => m.id === actor.orgId);
  if (!org) throw new IdentityError("not_found");
  return { org, memberships, principal: principalFrom(actor.userId, memberships, actor.orgId) };
}

export async function listMyMemberships(db: Db, userId: string): Promise<MyMembership[]> {
  return withAppTx(db, { userId }, loadMyMemberships);
}

/** Null when the user isn't an active member: callers must respond with 404. */
export async function getOrgContext(db: Db, actor: Actor): Promise<OrgContext | null> {
  if (!isUuid(actor.orgId)) return null;
  return withAppTx(db, actor, async (c) => {
    try {
      return await requireContext(c, actor);
    } catch (e) {
      if (e instanceof IdentityError && e.code === "not_found") return null;
      throw e;
    }
  });
}
