import { isMarketCode, type MarketCode, type OrgType } from "@baytline/core";
import { isUuid, withAppTx, type Db } from "@baytline/db";
import { IdentityError, writeAudit, type Actor } from "@baytline/identity";
import { likePattern, requirePlatform } from "./guard";

export type OrgStatus = "active" | "suspended";

export type OrgDirectoryRow = {
  id: string;
  type: OrgType;
  name: string;
  legalName: string | null;
  market: MarketCode | null;
  status: OrgStatus;
  createdAt: Date;
  activeMembers: number;
  suspendedMembers: number;
  pendingInvitations: number;
};

export type OrgSearch = { q?: string; type?: string; status?: string; market?: string; limit?: number };

const DIRECTORY_TYPES = ["platform", "developer", "property_manager", "brokerage"];

/**
 * Organization directory. Identity metadata only (names, counts); no business
 * records. Personal organizations are never listed here.
 */
export async function searchOrganizations(db: Db, actor: Actor, s: OrgSearch = {}): Promise<OrgDirectoryRow[]> {
  return withAppTx(db, actor, async (c) => {
    await requirePlatform(c, actor, "platform.orgs.view");
    const where = ["o.type <> 'individual'"];
    const args: unknown[] = [];
    if (s.q?.trim()) {
      const n = args.push(likePattern(s.q));
      where.push(`(o.name ilike $${n} or o.legal_name ilike $${n} or o.registration_ref ilike $${n})`);
    }
    if (s.type && DIRECTORY_TYPES.includes(s.type)) where.push(`o.type = $${args.push(s.type)}`);
    if (s.status === "active" || s.status === "suspended") where.push(`o.status = $${args.push(s.status)}`);
    if (s.market && isMarketCode(s.market)) where.push(`o.market = $${args.push(s.market)}`);
    const limit = Math.min(Math.max(s.limit ?? 100, 1), 500);
    const { rows } = await c.query(
      `select o.id, o.type, o.name, o.legal_name, o.market, o.status, o.created_at,
              count(*) filter (where m.status = 'active')::int as active_members,
              count(*) filter (where m.status = 'suspended')::int as suspended_members,
              (select count(*) from app.invitations i where i.org_id = o.id and i.status = 'pending' and i.expires_at > now())::int as pending
         from app.organizations o
         left join app.memberships m on m.org_id = o.id
        where ${where.join(" and ")}
        group by o.id
        order by (o.type = 'platform') desc, o.name
        limit ${limit}`,
      args,
    );
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      name: r.name,
      legalName: r.legal_name,
      market: r.market,
      status: r.status,
      createdAt: r.created_at,
      activeMembers: r.active_members,
      suspendedMembers: r.suspended_members,
      pendingInvitations: r.pending,
    }));
  });
}

export type OrgProfile = OrgDirectoryRow & {
  registrationRef: string | null;
  website: string | null;
  createdByName: string | null;
  updatedAt: Date | null;
  updatedByName: string | null;
};

export async function getOrganizationProfile(db: Db, actor: Actor, orgId: string): Promise<OrgProfile> {
  if (!isUuid(orgId)) throw new IdentityError("not_found");
  return withAppTx(db, actor, async (c) => {
    await requirePlatform(c, actor, "platform.orgs.view");
    const { rows } = await c.query(
      `select o.id, o.type, o.name, o.legal_name, o.registration_ref, o.website, o.market, o.status,
              o.created_at, o.updated_at, cu.display_name as created_by_name, uu.display_name as updated_by_name,
              (select count(*) from app.memberships m where m.org_id = o.id and m.status = 'active')::int as active_members,
              (select count(*) from app.memberships m where m.org_id = o.id and m.status = 'suspended')::int as suspended_members,
              (select count(*) from app.invitations i where i.org_id = o.id and i.status = 'pending' and i.expires_at > now())::int as pending
         from app.organizations o
         left join app.users cu on cu.id = o.created_by
         left join app.users uu on uu.id = o.updated_by
        where o.id = $1 and o.type <> 'individual'`,
      [orgId],
    );
    const r = rows[0];
    if (!r) throw new IdentityError("not_found");
    return {
      id: r.id,
      type: r.type,
      name: r.name,
      legalName: r.legal_name,
      registrationRef: r.registration_ref,
      website: r.website,
      market: r.market,
      status: r.status,
      createdAt: r.created_at,
      createdByName: r.created_by_name,
      updatedAt: r.updated_at,
      updatedByName: r.updated_by_name,
      activeMembers: r.active_members,
      suspendedMembers: r.suspended_members,
      pendingInvitations: r.pending,
    };
  });
}

const optional = (v: unknown, max: number, field: string): string | null => {
  const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  if (!s) return null;
  if (s.length > max) throw new IdentityError("invalid_input", field);
  return s;
};

export type OrgProfileInput = { name: unknown; legalName?: unknown; registrationRef?: unknown; website?: unknown; market: unknown };

/** Edits profile fields. Type can't change; status has its own action. */
export async function updateOrganizationProfile(db: Db, actor: Actor, orgId: string, input: OrgProfileInput): Promise<void> {
  if (!isUuid(orgId)) throw new IdentityError("not_found");
  const name = optional(input.name, 160, "name");
  if (!name) throw new IdentityError("invalid_input", "name");
  const legalName = optional(input.legalName, 200, "legal_name");
  const registrationRef = optional(input.registrationRef, 100, "registration_ref");
  const website = optional(input.website, 200, "website");
  if (website && !/^https:\/\/[^\s/]+\.[^\s]+$/.test(website)) throw new IdentityError("invalid_input", "website");
  const market = String(input.market);
  if (!isMarketCode(market)) throw new IdentityError("invalid_input", "market");

  await withAppTx(db, actor, async (c) => {
    await requirePlatform(c, actor, "platform.orgs.manage");
    const { rows } = await c.query(
      "select name, legal_name, registration_ref, website, market, type from app.organizations where id = $1 and type <> 'individual' for update",
      [orgId],
    );
    const before = rows[0];
    if (!before) throw new IdentityError("not_found");
    if (market !== before.market) {
      const ok = await c.query("select 1 from app.markets where code = $1 and status = 'enabled'", [market]);
      if (!ok.rowCount) throw new IdentityError("invalid_input", "market");
    }
    const next = { name, legal_name: legalName, registration_ref: registrationRef, website, market };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => (before[k] ?? null) !== next[k]);
    if (!changed.length) return;
    const res = await c.query(
      `update app.organizations set name = $2, legal_name = $3, registration_ref = $4, website = $5, market = $6,
              updated_at = now(), updated_by = $7 where id = $1`,
      [orgId, name, legalName, registrationRef, website, market, actor.userId],
    );
    if (res.rowCount !== 1) throw new IdentityError("forbidden", "rls");
    await writeAudit(c, {
      type: "org.updated",
      outcome: "success",
      actorUserId: actor.userId,
      orgId,
      target: { type: "organization", id: orgId },
      metadata: { fields: changed.join(",") },
    });
  });
}

/** Suspending an organization immediately removes every member's access to it (RLS checks org status). */
export async function setOrganizationStatus(db: Db, actor: Actor, orgId: string, status: unknown): Promise<void> {
  if (!isUuid(orgId)) throw new IdentityError("not_found");
  if (status !== "active" && status !== "suspended") throw new IdentityError("invalid_input", "status");
  await withAppTx(db, actor, async (c) => {
    await requirePlatform(c, actor, "platform.orgs.manage");
    const { rows } = await c.query("select type, status from app.organizations where id = $1 and type <> 'individual' for update", [orgId]);
    const org = rows[0];
    if (!org) throw new IdentityError("not_found");
    if (org.type === "platform") throw new IdentityError("forbidden", "platform_org");
    if (org.status === status) return;
    await c.query("update app.organizations set status = $2, updated_at = now(), updated_by = $3 where id = $1", [orgId, status, actor.userId]);
    await writeAudit(c, {
      type: status === "suspended" ? "org.suspended" : "org.reactivated",
      outcome: "success",
      actorUserId: actor.userId,
      orgId,
      target: { type: "organization", id: orgId },
    });
  });
}
