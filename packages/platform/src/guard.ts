import { hasCapability, type Permission } from "@baytline/core";
import type { Client } from "@baytline/db";
import { IdentityError, requireContext, type Actor, type OrgContext } from "@baytline/identity";

/**
 * Loads the actor's memberships from the database (inside the caller's
 * transaction) and requires a platform capability. Callers never pass roles in.
 */
export async function requirePlatform(c: Client, actor: Actor, permission: Permission): Promise<OrgContext> {
  const ctx = await requireContext(c, actor);
  if (ctx.org.type !== "platform" || !hasCapability(ctx.principal, permission)) {
    throw new IdentityError("forbidden", permission);
  }
  return ctx;
}

/** Escapes LIKE wildcards so search text is matched literally. */
export function likePattern(q: string): string {
  return `%${q.trim().slice(0, 100).replace(/[\\%_]/g, (ch) => "\\" + ch)}%`;
}
