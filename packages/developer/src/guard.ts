import { hasCapability, type Permission } from "@baytline/core";
import type { Client } from "@baytline/db";
import { IdentityError, requireContext, writeAudit, type Actor, type AuditInput, type OrgContext } from "@baytline/identity";

/**
 * Every developer-workspace read and write starts here: the actor's membership is
 * loaded from the database inside the same transaction, the active org must be a
 * developer, and the permission must be held. RLS (app.owns) then filters rows again.
 */
export async function requireDeveloper(c: Client, actor: Actor, permission: Permission): Promise<OrgContext> {
  const ctx = await requireContext(c, actor);
  if (ctx.org.type !== "developer") throw new IdentityError("not_found");
  if (!hasCapability(ctx.principal, permission)) throw new IdentityError("forbidden", permission);
  return ctx;
}

export function can(ctx: OrgContext, permission: Permission): boolean {
  return hasCapability(ctx.principal, permission);
}

export function audit(c: Client, actor: Actor, e: Omit<AuditInput, "actorUserId" | "orgId" | "outcome"> & { outcome?: AuditInput["outcome"] }) {
  return writeAudit(c, { outcome: "success", ...e, actorUserId: actor.userId, orgId: actor.orgId });
}

export { IdentityError };
