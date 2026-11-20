import "server-only";
import { notFound } from "next/navigation";
import { hasCapability, type Permission } from "@baytline/core";
import { getProject, type ProjectDetail } from "@baytline/developer";
import { IdentityError } from "@baytline/identity";
import { checkSection, loadOrgPage, type OrgPage } from "./guards";
import { getDb } from "./db";
import { findMarket, getMarketsConfig } from "./markets";

/**
 * Loader for developer-workspace pages. Section names like "inventory" and "approvals"
 * also exist in other workspaces; those orgs get the shared "not built yet" shell.
 */
export async function devSection(locale: string, orgId: string, sectionId: string) {
  const page = await loadOrgPage(locale, orgId);
  const { allowed, section } = await checkSection(page, sectionId); // 404 if the section isn't in this workspace
  return { page, allowed, section, isDeveloper: page.ctx.org.type === "developer" };
}

export type ProjectPage = { page: OrgPage; project: ProjectDetail; allowed: boolean; can: (p: Permission) => boolean; marketLocale: string };

/** For /projects/[projectId]/...: the project must belong to the active developer, else 404. */
export async function projectSection(locale: string, orgId: string, projectId: string, need: Permission): Promise<ProjectPage> {
  const page = await loadOrgPage(locale, orgId);
  const { allowed: canProjects } = await checkSection(page, "projects");
  if (page.ctx.org.type !== "developer") notFound();
  const can = (p: Permission) => hasCapability(page.ctx.principal, p);
  if (!canProjects) return { page, project: null as never, allowed: false, can, marketLocale: page.locale };
  const project = await getProject(getDb(), { userId: page.session.user.id, orgId }, projectId).catch((e) => {
    if (e instanceof IdentityError && e.code === "not_found") notFound();
    throw e;
  });
  const market = findMarket(await getMarketsConfig(), project.market);
  return { page, project, allowed: can(need), can, marketLocale: market ? `${page.locale}-u-nu-${market.numberingSystem}` : page.locale };
}

export function actorOf(page: OrgPage) {
  return { userId: page.session.user.id, orgId: page.ctx.org.id };
}
