import Link from "next/link";
import { notFound } from "next/navigation";
import { hasCapability } from "@baytline/core";
import { getTeam, IdentityError } from "@baytline/identity";
import { getOrganizationProfile } from "@baytline/platform";
import { format } from "@/i18n/format";
import { checkSection, loadOrgPage } from "@/server/guards";
import { getDb } from "@/server/db";
import { findMarket, formattingLocale, getMarketsConfig, marketOptions, timeZoneOf } from "@/server/markets";
import { setOrgStatusAction, updateOrgProfileAction } from "@/server/actions/platform";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { Chip } from "@/components/ui/Chip";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { ActionForm } from "@/components/forms/ActionForm";
import { ConfirmAction } from "@/components/forms/ConfirmAction";
import { Field, SelectField } from "@/components/forms/Field";
import { TeamPanel } from "@/components/team/TeamPanel";

/**
 * One organization, as platform staff see it: profile, status and members.
 * Identity metadata only; business records from later milestones are never shown here.
 */
export default async function OrganizationDetail({ params }: { params: Promise<{ locale: string; orgId: string; targetOrgId: string }> }) {
  const { locale, orgId, targetOrgId } = await params;
  const page = await loadOrgPage(locale, orgId);
  const { allowed } = await checkSection(page, "organizations");
  const { dict } = page;
  if (!allowed) return <AccessDenied dict={dict} orgName={page.ctx.org.name} />;

  const actor = { userId: page.session.user.id, orgId };
  const notFoundOn = (e: unknown): never => {
    if (e instanceof IdentityError && e.code === "not_found") notFound();
    throw e;
  };
  const [org, team, markets] = await Promise.all([
    getOrganizationProfile(getDb(), actor, targetOrgId).catch(notFoundOn),
    getTeam(getDb(), actor, targetOrgId).catch(notFoundOn),
    getMarketsConfig(),
  ]);
  const canManage = hasCapability(page.ctx.principal, "platform.orgs.manage");
  const market = findMarket(markets, org.market);
  const date = new Intl.DateTimeFormat(formattingLocale(page.locale, market), { dateStyle: market?.dateStyle ?? "medium", timeZone: timeZoneOf(markets, org.market) });
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="targetOrgId" value={org.id} />
    </>
  );
  const facts: [string, React.ReactNode][] = [
    [dict.orgs.type, dict.orgTypes[org.type]],
    [dict.orgs.market, market?.name[page.locale] ?? dict.admin.notSet],
    [dict.orgs.columns.members, org.activeMembers],
    [dict.orgs.suspendedMembers, org.suspendedMembers],
    [dict.orgs.columns.invitations, org.pendingInvitations],
  ];

  return (
    <div className="space-y-10">
      <p>
        <Link href={`/${locale}/o/${orgId}/organizations`} className="text-sm text-gulf-strong underline underline-offset-4">{dict.orgs.allOrgs}</Link>
      </p>
      <SectionHeader eyebrow={dict.orgTypes[org.type]} title={org.name} intro={org.legalName ?? undefined}>
        <Chip tone={org.status === "active" ? "good" : "attention"}>{dict.orgs.status[org.status]}</Chip>
      </SectionHeader>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-line bg-line sm:grid-cols-5">
        {facts.map(([k, v]) => (
          <div key={k} className="bg-surface px-4 py-3">
            <dt className="text-xs text-ink-muted">{k}</dt>
            <dd className="mt-0.5 font-medium tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-ink-muted">
        {format(dict.orgs.addedOn, { date: date.format(org.createdAt) })}.{" "}
        {org.updatedAt && org.updatedByName ? format(dict.admin.updated, { date: date.format(org.updatedAt), name: org.updatedByName }) : dict.admin.neverEdited}
      </p>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="profile" className="rounded-panel border border-line bg-surface p-5 sm:p-6">
          <h2 id="profile" className="text-lg">{dict.orgs.profileTitle}</h2>
          <p className="mt-1 text-sm text-ink-muted">{dict.orgs.asProvided}</p>
          {canManage ? (
            <ActionForm action={updateOrgProfileAction} submitLabel={dict.orgs.saveProfile} pendingLabel={dict.team.saving} className="mt-5">
              {hidden}
              <Field label={dict.orgs.name} name="name" defaultValue={org.name} required maxLength={160} />
              <Field label={dict.orgs.legalName} name="legalName" defaultValue={org.legalName ?? ""} maxLength={200} />
              <Field label={dict.orgs.registrationRef} name="registrationRef" defaultValue={org.registrationRef ?? ""} maxLength={100} dir="ltr" />
              <Field label={dict.orgs.website} hint={dict.orgs.websiteHint} name="website" type="url" defaultValue={org.website ?? ""} maxLength={200} dir="ltr" pattern="https://.+" />
              <SelectField label={dict.orgs.market} name="market" defaultValue={org.market ?? ""} options={marketOptions(markets, page.locale, { enabledOnly: true, current: org.market })} />
              <p className="text-xs text-ink-muted">{dict.orgs.typeFixed}</p>
            </ActionForm>
          ) : (
            <dl className="mt-5 space-y-3 text-sm">
              {([[dict.orgs.legalName, org.legalName], [dict.orgs.registrationRef, org.registrationRef], [dict.orgs.website, org.website]] as const).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-ink-muted">{k}</dt>
                  <dd dir="auto">{v ?? dict.admin.notSet}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <section aria-labelledby="status" className="space-y-3">
          <h2 id="status" className="text-lg">{dict.orgs.statusTitle}</h2>
          {/* Stated in words, so the result of suspending or reactivating is always visible after the page updates. */}
          {org.type !== "platform" && (
            <p role="status" className={`rounded-control border-s-4 bg-surface px-3 py-2 text-sm ${org.status === "active" ? "border-mangrove" : "border-saffron"}`}>
              {org.status === "active" ? dict.orgs.statusActive : dict.orgs.statusSuspended}
            </p>
          )}
          {org.type === "platform" ? (
            <p className="text-sm text-ink-muted">{dict.orgs.platformNoSuspend}</p>
          ) : !canManage ? (
            <p className="text-sm text-ink-muted">{dict.admin.readOnly}</p>
          ) : org.status === "active" ? (
            <ConfirmAction trigger={dict.orgs.suspend} hint={dict.orgs.suspendHint} confirmLabel={dict.orgs.suspendConfirm} pendingLabel={dict.team.saving} action={setOrgStatusAction}>
              {hidden}
              <input type="hidden" name="status" value="suspended" />
            </ConfirmAction>
          ) : (
            <ActionForm action={setOrgStatusAction} variant="quiet" submitLabel={dict.orgs.reactivate} pendingLabel={dict.team.saving}>
              {hidden}
              <input type="hidden" name="status" value="active" />
            </ActionForm>
          )}
        </section>
      </div>

      <TeamPanel dict={dict} locale={page.locale} team={team} actorOrgId={orgId} targetOrgName={org.name} timeZone={timeZoneOf(markets, org.market)} />
    </div>
  );
}
