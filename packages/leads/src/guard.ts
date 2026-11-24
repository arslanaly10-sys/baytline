import { hasCapability, type Permission } from "@baytline/core";
import type { Client } from "@baytline/db";
import { fields, IdentityError, requireContext, writeAudit, type Actor, type AuditInput, type OrgContext } from "@baytline/identity";

export const f = fields;
export { IdentityError };

/** Active org must be of one of these types, and the role must hold the permission. Otherwise 404/forbidden. */
export async function requireOrg(c: Client, actor: Actor, types: readonly string[], permission: Permission): Promise<OrgContext> {
  const ctx = await requireContext(c, actor);
  if (!types.includes(ctx.org.type)) throw new IdentityError("not_found");
  if (!hasCapability(ctx.principal, permission)) throw new IdentityError("forbidden", permission);
  return ctx;
}

export const LEAD_ORGS = ["developer", "brokerage"] as const;

/** Developers and brokerages work leads, viewings and deals. */
export const requireLeadOrg = (c: Client, actor: Actor, permission: Permission) => requireOrg(c, actor, LEAD_ORGS, permission);

export const can = (ctx: OrgContext, p: Permission) => hasCapability(ctx.principal, p);

export function audit(c: Client, actor: Actor, e: Omit<AuditInput, "actorUserId" | "orgId" | "outcome">) {
  return writeAudit(c, { outcome: "success", ...e, actorUserId: actor.userId, orgId: actor.orgId });
}

/** Database raises domain errors by name; map the ones the UI explains. */
export function mapDbError(e: unknown): never {
  const msg = e instanceof Error ? e.message : "";
  if (msg === "not_found") throw new IdentityError("not_found");
  if (msg === "forbidden") throw new IdentityError("forbidden");
  if (["already_registered", "already_protected"].includes(msg)) throw new IdentityError("conflict", msg);
  if ((e as { code?: string })?.code === "23505") throw new IdentityError("conflict", "duplicate");
  if (["project_not_shared", "not_pending", "protection_days", "decision_note_required", "decision", "deal_not_won", "no_protection",
       "own_submission", "unit", "registration", "org_mismatch", "assignee_not_member"].includes(msg)) {
    throw new IdentityError(msg === "own_submission" ? "forbidden" : "invalid_input", msg);
  }
  throw e;
}

/** Runs a statement that may raise a domain error, inside a savepoint so the transaction can continue to report it. */
export async function guarded<T>(c: Client, fn: () => Promise<T>): Promise<T> {
  await c.query("savepoint g");
  try {
    const r = await fn();
    await c.query("release savepoint g");
    return r;
  } catch (e) {
    await c.query("rollback to savepoint g");
    return mapDbError(e);
  }
}

const PHONE = /^\+?[0-9 ()-]{6,24}$/;
export function validPhone(v: unknown, required: boolean): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) {
    if (required) throw new IdentityError("invalid_input", "phone_required");
    return null;
  }
  if (!PHONE.test(s)) throw new IdentityError("invalid_input", "phone");
  return s;
}

export const like = (q: string) => `%${q.trim().slice(0, 100).replace(/[\\%_]/g, (ch) => "\\" + ch)}%`;
