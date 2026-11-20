import { hasCapability, isMarketCode, type OrgType, type Role } from "@baytline/core";
import { withAppTx, type Db } from "@baytline/db";
import { writeAudit } from "./audit";
import { requireContext, type Actor } from "./context";
import { IdentityError } from "./errors";
import { insertInvitation } from "./members";
import { cleanName, normalizeEmail } from "./validation";

/** Organization types a platform operator can create. Platform and personal orgs are created by the system. */
export const CREATABLE_ORG_TYPES = ["developer", "property_manager", "brokerage"] as const satisfies readonly OrgType[];
export type CreatableOrgType = (typeof CREATABLE_ORG_TYPES)[number];

const FIRST_ADMIN_ROLE: Record<CreatableOrgType, Role> = {
  developer: "developer_admin",
  property_manager: "pm_admin",
  brokerage: "brokerage_admin",
};

/**
 * Creates a business organization and invites its first administrator.
 * Directory listing and profile editing live in @baytline/platform.
 */
export async function createOrganization(
  db: Db,
  actor: Actor,
  input: { type: unknown; name: unknown; market: unknown; adminEmail: unknown },
): Promise<{ orgId: string; token: string; adminEmail: string }> {
  const type = String(input.type);
  if (!(CREATABLE_ORG_TYPES as readonly string[]).includes(type)) throw new IdentityError("invalid_input", "type");
  const market = String(input.market);
  if (!isMarketCode(market)) throw new IdentityError("invalid_input", "market");
  const name = cleanName(input.name, 160);
  const adminEmail = normalizeEmail(input.adminEmail);

  return withAppTx(db, actor, async (c) => {
    const { principal } = await requireContext(c, actor);
    if (!hasCapability(principal, "platform.orgs.manage")) throw new IdentityError("forbidden", "platform.orgs.manage");
    // Disabled markets can't take new organizations.
    const enabled = await c.query("select 1 from app.markets where code = $1 and status = 'enabled'", [market]);
    if (!enabled.rowCount) throw new IdentityError("invalid_input", "market");
    const { rows } = await c.query<{ id: string }>(
      "insert into app.organizations (type, name, market, created_by) values ($1, $2, $3, $4) returning id",
      [type, name, market, actor.userId],
    );
    const orgId = rows[0]!.id;
    await writeAudit(c, { type: "org.created", outcome: "success", actorUserId: actor.userId, orgId, target: { type: "organization", id: orgId }, metadata: { orgType: type, market } });
    const { token } = await insertInvitation(c, {
      orgId,
      email: adminEmail,
      role: FIRST_ADMIN_ROLE[type as CreatableOrgType],
      invitedBy: actor.userId,
      actorOrgId: actor.orgId,
    });
    return { orgId, token, adminEmail };
  });
}
