import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { hasCapability, isUiLocale, workspaceForOrgType, type UiLocale, type WorkspaceSection } from "@baytline/core";
import { getOrgContext, IdentityError, recordDenied, recordOrgSwitch, type OrgContext, type ValidSession } from "@baytline/identity";
import { getDictionary, type Dictionary } from "@/i18n";
import { dbConfigured, getDb } from "./db";
import { getSession } from "./session";

/**
 * Authorization boundary for pages (layer 2 of 3 — see docs/identity.md):
 *   1. proxy.ts only handles locale, never access.
 *   2. Every page and server action resolves the session and the org
 *      membership from the database and checks capabilities.
 *   3. PostgreSQL row-level security filters every query again.
 */

export function signInPath(locale: UiLocale, next: string): string {
  return `/${locale}/sign-in?next=${encodeURIComponent(next)}`;
}

export function requireLocale(locale: string): UiLocale {
  if (!isUiLocale(locale)) notFound();
  return locale;
}

/** Signed-out visitors are sent to sign in, then back here. */
export async function requireSession(locale: UiLocale, returnTo: string): Promise<ValidSession> {
  if (!dbConfigured()) redirect(`/${locale}`);
  const session = await getSession();
  if (!session) redirect(signInPath(locale, returnTo));
  return session;
}

export type OrgPage = {
  locale: UiLocale;
  dict: Dictionary;
  session: ValidSession;
  ctx: OrgContext;
};

/**
 * Gate for everything under /o/[orgId]. Called by the layout AND by every page
 * (layouts don't re-run on client navigation, so pages can't rely on them).
 * Non-members get 404 and the attempt is recorded.
 */
export const loadOrgPage = cache(async (rawLocale: string, orgId: string): Promise<OrgPage> => {
  const locale = requireLocale(rawLocale);
  const session = await requireSession(locale, `/${locale}/o/${orgId}`);
  const db = getDb();
  const ctx = await getOrgContext(db, { userId: session.user.id, mfa: session.mfaVerified, orgId }).catch((e) => {
    // Platform workspaces need two-step sign-in: send staff to set it up, then back here.
    if (e instanceof IdentityError && e.detail === "mfa_required") redirect(`/${locale}/app/security?required=platform&next=${encodeURIComponent(`/${locale}/o/${orgId}`)}`);
    throw e;
  });
  if (!ctx) {
    await recordDenied(db, session.user.id, { orgId, resource: `/o/${orgId}`, reason: "not_a_member" });
    notFound();
  }
  await recordOrgSwitch(db, session, orgId);
  return { locale, session, ctx, dict: await getDictionary(locale) };
});

export type SectionAccess = { section: WorkspaceSection; allowed: boolean };

/** Unknown sections 404. Known sections the role can't use render an access-denied state, and are recorded. */
export const checkSection = cache(async (page: OrgPage, sectionId: string): Promise<SectionAccess> => {
  const section = workspaceForOrgType(page.ctx.org.type).sections.find((s) => s.id === sectionId);
  if (!section) notFound();
  const allowed = hasCapability(page.ctx.principal, section.requires);
  if (!allowed) {
    await recordDenied(getDb(), page.session.user.id, {
      orgId: page.ctx.org.id,
      resource: `/o/${page.ctx.org.id}/${sectionId}`,
      reason: `missing_${section.requires}`,
    });
  }
  return { section, allowed };
});

