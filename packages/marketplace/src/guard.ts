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

/** Customers act in their personal workspace. */
export const requireCustomer = (c: Client, actor: Actor, permission: Permission) => requireOrg(c, actor, ["individual"], permission);

export const can = (ctx: OrgContext, p: Permission) => hasCapability(ctx.principal, p);

export function audit(c: Client, actor: Actor, e: Omit<AuditInput, "actorUserId" | "orgId" | "outcome">) {
  return writeAudit(c, { outcome: "success", ...e, actorUserId: actor.userId, orgId: actor.orgId });
}

/** Database raises domain errors by name; map the ones the UI explains. */
export function mapDbError(e: unknown): never {
  const msg = e instanceof Error ? e.message : "";
  if (msg === "listing_not_found" || msg === "not_found") throw new IdentityError("not_found");
  if (msg === "throttled") throw new IdentityError("conflict", "throttled");
  if (["slots", "related_enquiry", "appointment_closed", "route_not_shared", "sample_not_publishable", "unit"].includes(msg)) throw new IdentityError("invalid_input", msg);
  if (msg === "not_signed_in") throw new IdentityError("forbidden");
  throw e;
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
