import "server-only";
import { notFound } from "next/navigation";
import { hasCapability, type Permission } from "@baytline/core";
import { IdentityError } from "@baytline/identity";
import { checkSection, loadOrgPage } from "./guards";

/**
 * Loader for property-management pages. 404 unless the active org is a property manager
 * and the section exists in its workspace; `allowed` says whether this role may open it.
 */
export async function pmSection(locale: string, orgId: string, sectionId: string) {
  const page = await loadOrgPage(locale, orgId);
  const { allowed, section } = await checkSection(page, sectionId);
  if (page.ctx.org.type !== "property_manager") notFound();
  const can = (p: Permission) => hasCapability(page.ctx.principal, p);
  const actor = { userId: page.session.user.id, orgId: page.ctx.org.id };
  return { page, allowed, section, can, actor, base: `/${page.locale}/o/${orgId}` };
}

/** Services throw not_found for records in other organizations; show the 404 page for those. */
export function orNotFound<T>(p: Promise<T>): Promise<T> {
  return p.catch((e) => {
    if (e instanceof IdentityError && e.code === "not_found") notFound();
    throw e;
  });
}
