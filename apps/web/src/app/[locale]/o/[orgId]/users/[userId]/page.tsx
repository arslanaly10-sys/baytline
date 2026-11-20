import Link from "next/link";
import { notFound } from "next/navigation";
import { assignableRoles, hasCapability } from "@baytline/core";
import { CREATABLE_ORG_TYPES, IdentityError } from "@baytline/identity";
import { getUserProfile, searchOrganizations } from "@baytline/platform";
import { format } from "@/i18n/format";
import { checkSection, loadOrgPage } from "@/server/guards";
import { getDb } from "@/server/db";
import { getMarketsConfig, timeZoneOf } from "@/server/markets";
import { revokeSessionsAction, setUserStatusAction } from "@/server/actions/platform";
import { changeRoleAction, inviteAction, setMemberStatusAction } from "@/server/actions/team";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { Chip } from "@/components/ui/Chip";
import { PlaceholderBadge } from "@/components/ui/PlaceholderBadge";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { ActionForm } from "@/components/forms/ActionForm";
import { resetUserMfaAction } from "@/server/actions/security";
import { ConfirmAction } from "@/components/forms/ConfirmAction";
import { SelectField } from "@/components/forms/Field";

export default async function UserDetail({ params }: { params: Promise<{ locale: string; orgId: string; userId: string }> }) {
  const { locale, orgId, userId } = await params;
  const page = await loadOrgPage(locale, orgId);
  const { allowed } = await checkSection(page, "users");
  const { dict } = page;
  if (!allowed) return <AccessDenied dict={dict} orgName={page.ctx.org.name} />;

  const actor = { userId: page.session.user.id, mfa: page.session.mfaVerified, orgId };
  const user = await getUserProfile(getDb(), actor, userId).catch((e) => {
    if (e instanceof IdentityError && e.code === "not_found") notFound();
    throw e;
  });
  const canManage = user.canManage; // platform.users.manage and not yourself, decided on the server
  const orgs = canManage ? (await searchOrganizations(getDb(), actor, { status: "active" })).filter((o) => o.type !== "platform" || hasCapability(page.ctx.principal, "org.members.manage")) : [];
  const markets = await getMarketsConfig();
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: timeZoneOf(markets, page.ctx.org.market) });
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="userId" value={user.id} />
    </>
  );
  const auditHref = `/${locale}/o/${orgId}/audit?actor=${encodeURIComponent(user.email)}`;

  return (
    <div className="space-y-10">
      <p>
        <Link href={`/${locale}/o/${orgId}/users`} className="text-sm text-gulf-strong underline underline-offset-4">{dict.workspaces.admin.sections.users.label}</Link>
      </p>
      <SectionHeader eyebrow={dict.users.account} title={user.displayName}>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={user.status === "active" ? "good" : "problem"}>{dict.users.status[user.status]}</Chip>
          <Chip tone={user.emailVerified ? "neutral" : "muted"}>{user.emailVerified ? dict.users.verified : dict.states.unverified}</Chip>
          {user.isPlaceholder && <PlaceholderBadge label={dict.states.placeholder} hint={dict.states.placeholderHint} />}
        </div>
      </SectionHeader>

      <dl className="grid gap-px overflow-hidden rounded-panel border border-line bg-line sm:grid-cols-5">
        {([
          [dict.auth.email, <bdi key="e" dir="ltr">{user.email}</bdi>],
          [dict.users.columns.created, date.format(user.createdAt)],
          [dict.users.sessions, user.activeSessions],
          [dict.users.lastActive, user.lastActiveAt ? date.format(user.lastActiveAt) : dict.users.never],
          [dict.sec.reset.title, user.mfaEnrolled ? dict.sec.reset.on : dict.sec.reset.off],
        ] as const).map(([k, v]) => (
          <div key={k} className="min-w-0 bg-surface px-4 py-3">
            <dt className="text-xs text-ink-muted">{k}</dt>
            <dd className="mt-0.5 truncate font-medium tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {hasCapability(page.ctx.principal, "audit.view") && (
        <p><Link href={auditHref} className="text-sm text-gulf-strong underline underline-offset-4">{dict.users.viewAudit}</Link></p>
      )}

      <section aria-labelledby="account-actions" className="space-y-3">
        <h2 id="account-actions" className="text-lg">{dict.users.account}</h2>
        <p role="status" className={`rounded-control border-s-4 bg-surface px-3 py-2 text-sm ${user.status === "active" ? "border-mangrove" : "border-coral"}`}>
          {user.status === "active" ? dict.users.accountActive : dict.users.accountDisabled}
        </p>
        {user.isSelf ? (
          <p className="text-sm text-ink-muted">{dict.users.selfNote}</p>
        ) : !canManage ? (
          <p className="text-sm text-ink-muted">{dict.admin.readOnly}</p>
        ) : (
          <div className="flex flex-wrap items-start gap-3">
            {user.status === "active" ? (
              <ConfirmAction trigger={dict.users.disable} hint={dict.users.disableHint} confirmLabel={dict.users.disableConfirm} pendingLabel={dict.team.saving} action={setUserStatusAction}>
                {hidden}
                <input type="hidden" name="status" value="disabled" />
              </ConfirmAction>
            ) : (
              <ActionForm action={setUserStatusAction} variant="quiet" submitLabel={dict.users.enable} pendingLabel={dict.team.saving}>
                {hidden}
                <input type="hidden" name="status" value="active" />
              </ActionForm>
            )}
            {user.mfaEnrolled && (
              <ConfirmAction trigger={dict.sec.reset.reset} hint={dict.sec.reset.hint} confirmLabel={dict.sec.reset.reset} pendingLabel={dict.team.saving} action={resetUserMfaAction}>
                {hidden}
              </ConfirmAction>
            )}
            {user.activeSessions > 0 && (
              <ActionForm action={revokeSessionsAction} variant="quiet" submitLabel={dict.users.revoke} pendingLabel={dict.team.saving}>
                {hidden}
              </ActionForm>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="memberships">
        <h2 id="memberships" className="text-lg">{dict.users.memberships}</h2>
        {user.memberships.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">{dict.users.noMemberships}</p>
        ) : (
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {user.memberships.map((m) => {
              const personal = m.orgType === "individual";
              const controls = canManage && !personal && m.status !== "removed";
              const mHidden = (
                <>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="orgId" value={orgId} />
                  <input type="hidden" name="membershipId" value={m.membershipId} />
                </>
              );
              return (
                <li key={m.membershipId} className="grid gap-3 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                  <div>
                    <p className="flex flex-wrap items-center gap-2">
                      {personal ? (
                        <span className="font-medium">{dict.users.personalWorkspace}</span>
                      ) : (
                        <Link href={`/${locale}/o/${orgId}/organizations/${m.orgId}`} className="font-medium text-gulf-strong underline-offset-4 hover:underline">{m.orgName}</Link>
                      )}
                      {m.status !== "active" && <Chip tone={m.status === "removed" ? "muted" : "attention"}>{dict.team.status[m.status]}</Chip>}
                      {m.orgStatus === "suspended" && <Chip tone="attention">{dict.users.orgSuspended}</Chip>}
                    </p>
                    <p className="text-sm text-ink-muted">
                      {dict.orgTypes[m.orgType]}. {dict.roles[m.role]}. {format(dict.users.since, { date: date.format(m.since) })}
                    </p>
                  </div>
                  {controls && (
                    <div className="flex flex-wrap items-start gap-3">
                      <ActionForm action={changeRoleAction} layout="inline" variant="quiet" submitLabel={dict.team.save} pendingLabel={dict.team.saving}>
                        {mHidden}
                        <SelectField label={dict.team.role} hideLabel name="role" defaultValue={m.role} options={assignableRoles(m.orgType).map((r) => ({ value: r, label: dict.roles[r] }))} />
                      </ActionForm>
                      <ActionForm action={setMemberStatusAction} layout="inline" variant="quiet" submitLabel={m.status === "active" ? dict.team.suspend : dict.team.reactivate} pendingLabel={dict.team.saving}>
                        {mHidden}
                        <input type="hidden" name="status" value={m.status === "active" ? "suspended" : "active"} />
                      </ActionForm>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {canManage && user.status === "active" && orgs.length > 0 && (
        <section aria-labelledby="invite" className="max-w-xl rounded-panel border border-line bg-surface p-5 sm:p-6">
          <h2 id="invite" className="text-lg">{dict.users.inviteTitle}</h2>
          <p className="mt-1 text-sm text-ink-muted">{dict.users.inviteIntro}</p>
          <ActionForm action={inviteAction} submitLabel={dict.team.invite} pendingLabel={dict.team.inviting} className="mt-5">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="orgId" value={orgId} />
            <input type="hidden" name="email" value={user.email} />
            <SelectField label={dict.users.organization} name="targetOrgId" options={orgs.map((o) => ({ value: o.id, label: `${o.name} (${dict.orgTypes[o.type]})` }))} />
            {/* Roles grouped by organization type; the server rejects a role that doesn't fit the chosen organization. */}
            <label className="block">
              <span className="block text-sm font-medium text-ink">{dict.team.role}</span>
              <select name="role" className="mt-1 block w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink">
                {([...CREATABLE_ORG_TYPES, "platform"] as const).map((t) => (
                  <optgroup key={t} label={dict.orgTypes[t]}>
                    {assignableRoles(t).slice().reverse().map((r) => (
                      <option key={r} value={r}>{dict.roles[r]}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          </ActionForm>
        </section>
      )}
    </div>
  );
}
