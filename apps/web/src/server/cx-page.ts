import "server-only";
import { checkSection, loadOrgPage } from "./guards";

/** Loader for milestone-7 workspace pages; 404 if the section isn't in this workspace. */
export async function cxSection(locale: string, orgId: string, sectionId: string) {
  const page = await loadOrgPage(locale, orgId);
  const { allowed, section } = await checkSection(page, sectionId);
  const actor = { userId: page.session.user.id, orgId: page.ctx.org.id };
  return { page, allowed, section, actor, base: `/${page.locale}/o/${orgId}`, orgType: page.ctx.org.type };
}
