import { hasCapability, type Permission } from "@baytline/core";
import type { Client } from "@baytline/db";
import { fields, IdentityError, requireContext, writeAudit, type Actor, type AuditInput, type OrgContext } from "@baytline/identity";

/**
 * Every property-management read and write starts here: membership loaded from the
 * database in the same transaction, active org must be a property manager, permission
 * must be held. RLS (app.owns) filters rows again underneath.
 */
export async function requireManagement(c: Client, actor: Actor, permission: Permission): Promise<OrgContext> {
  const ctx = await requireContext(c, actor);
  if (ctx.org.type !== "property_manager") throw new IdentityError("not_found");
  if (!hasCapability(ctx.principal, permission)) throw new IdentityError("forbidden", permission);
  return ctx;
}

export const can = (ctx: OrgContext, p: Permission) => hasCapability(ctx.principal, p);

export function audit(c: Client, actor: Actor, e: Omit<AuditInput, "actorUserId" | "orgId" | "outcome">) {
  return writeAudit(c, { outcome: "success", ...e, actorUserId: actor.userId, orgId: actor.orgId });
}

/** LIKE pattern with wildcards escaped, so search text is literal. */
export const like = (q: string) => `%${q.trim().slice(0, 100).replace(/[\\%_]/g, (ch) => "\\" + ch)}%`;

/** Maps database constraint/trigger errors to the codes the UI translates. */
export async function mapDbError(c: Client, e: unknown): Promise<never> {
  const err = (e ?? {}) as { code?: string; message?: string; constraint?: string };
  const known: Record<string, string> = {
    assignee_not_member: "assignee",
    unit_not_in_property: "unit",
    org_mismatch: "not_found",
  };
  if (err.message && known[err.message]) {
    await c.query("rollback to savepoint s").catch(() => {});
    if (err.message === "org_mismatch") throw new IdentityError("not_found");
    throw new IdentityError("invalid_input", known[err.message]);
  }
  if (err.code === "23505") {
    await c.query("rollback to savepoint s").catch(() => {});
    throw new IdentityError("conflict", "duplicate");
  }
  throw e;
}

export const f = fields;
export { IdentityError };
