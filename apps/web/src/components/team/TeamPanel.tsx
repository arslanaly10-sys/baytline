import type { UiLocale } from "@baytline/core";
import type { TeamView } from "@baytline/identity";
import type { Dictionary } from "@/i18n";
import { format } from "@/i18n/format";
import { changeRoleAction, inviteAction, revokeInvitationAction, setMemberStatusAction } from "@/server/actions/team";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, SelectField } from "@/components/forms/Field";
import { PlaceholderBadge } from "@/components/ui/PlaceholderBadge";

type Props = {
  dict: Dictionary;
  locale: UiLocale;
  team: TeamView;
  /** The org the actor is working in (for the server action's membership check). */
  actorOrgId: string;
  targetOrgName: string;
  timeZone: string;
};

/**
 * Members and invitations. Controls only appear when the server says the actor can
 * manage this org, and every action re-checks on the server and in the database.
 */
export function TeamPanel({ dict, locale, team, actorOrgId, targetOrgName, timeZone }: Props) {
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone });
  const roleOptions = team.assignableRoles.map((r) => ({ value: r, label: dict.roles[r] }));
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgId" value={actorOrgId} />
    </>
  );

  return (
    <div className="space-y-12">
      {!team.canManage && <p className="rounded-control border-s-4 border-gulf bg-surface px-3 py-2 text-sm">{dict.team.readOnly}</p>}

      <section aria-labelledby="members-title">
        <h2 id="members-title" className="text-lg">{dict.team.members}</h2>
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {team.members.map((m) => (
            <li key={m.membershipId} className="grid gap-3 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{m.displayName}</span>
                  {m.isSelf && <span className="rounded-chip bg-gulf-tint px-1.5 text-xs text-gulf-strong">{dict.team.you}</span>}
                  {m.isPlaceholder && <PlaceholderBadge label={dict.states.placeholder} hint={dict.states.placeholderHint} />}
                  {m.status === "suspended" && (
                    <span className="rounded-chip border border-saffron px-1.5 text-xs">{dict.team.status.suspended}</span>
                  )}
                </p>
                <p className="truncate text-sm text-ink-muted">
                  <bdi dir="ltr">{m.email}</bdi>
                </p>
                <p className="text-sm text-ink-muted">
                  {dict.roles[m.role]}. {format(dict.team.joined, { date: date.format(m.joinedAt) })}
                </p>
              </div>

              {team.canManage && !m.isSelf && (
                <div className="flex flex-wrap items-start gap-3">
                  <ActionForm action={changeRoleAction} layout="inline" variant="quiet" submitLabel={dict.team.save} pendingLabel={dict.team.saving}>
                    {hidden}
                    <input type="hidden" name="membershipId" value={m.membershipId} />
                    <SelectField label={dict.team.role} hideLabel name="role" defaultValue={m.role} options={roleOptions} />
                  </ActionForm>
                  <ActionForm
                    action={setMemberStatusAction}
                    layout="inline"
                    variant="quiet"
                    submitLabel={m.status === "active" ? dict.team.suspend : dict.team.reactivate}
                    pendingLabel={dict.team.saving}
                  >
                    {hidden}
                    <input type="hidden" name="membershipId" value={m.membershipId} />
                    <input type="hidden" name="status" value={m.status === "active" ? "suspended" : "active"} />
                  </ActionForm>
                  <details className="group">
                    <summary className="cursor-pointer list-none rounded-control px-2 py-2 text-sm text-coral underline-offset-4 hover:underline">
                      {dict.team.remove}
                    </summary>
                    <ActionForm action={setMemberStatusAction} layout="inline" variant="danger" submitLabel={dict.team.confirmRemove} pendingLabel={dict.team.saving} className="mt-2">
                      {hidden}
                      <input type="hidden" name="membershipId" value={m.membershipId} />
                      <input type="hidden" name="status" value="removed" />
                    </ActionForm>
                  </details>
                </div>
              )}
              {team.canManage && m.isSelf && <p className="text-sm text-ink-muted">{dict.team.selfNote}</p>}
            </li>
          ))}
        </ul>
      </section>

      {team.canManage && (
        <div className="grid gap-8 lg:grid-cols-2">
          <section aria-labelledby="invite-title" className="rounded-panel border border-line bg-surface p-5 sm:p-6">
            <h2 id="invite-title" className="text-lg">{dict.team.inviteTitle}</h2>
            <p className="mt-1 text-sm text-ink-muted">{format(dict.team.inviteIntro, { org: targetOrgName })}</p>
            <ActionForm action={inviteAction} submitLabel={dict.team.invite} pendingLabel={dict.team.inviting} className="mt-5">
              {hidden}
              <input type="hidden" name="targetOrgId" value={team.orgId} />
              <input type="hidden" name="orgName" value={targetOrgName} />
              <Field label={dict.auth.email} name="email" type="email" required dir="ltr" autoComplete="off" />
              {/* Default to the least-privileged role: granting admin should be a deliberate choice. */}
              <SelectField label={dict.team.role} name="role" options={roleOptions} defaultValue={team.assignableRoles.at(-1)} />
            </ActionForm>
          </section>

          <section aria-labelledby="invitations-title">
            <h2 id="invitations-title" className="text-lg">{dict.team.invitations}</h2>
            {team.invitations.length === 0 ? (
              <p className="mt-3 text-sm text-ink-muted">{dict.team.noInvitations}</p>
            ) : (
              <ul className="mt-3 divide-y divide-line border-y border-line">
                {team.invitations.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0 text-sm">
                      <p className="truncate font-medium"><bdi dir="ltr">{i.email}</bdi></p>
                      <p className="text-ink-muted">
                        {dict.roles[i.role]}.{" "}
                        {i.state === "expired" ? dict.team.expired : format(dict.team.expires, { date: date.format(i.expiresAt) })}
                        {i.invitedByName && <>. {format(dict.team.invitedBy, { name: i.invitedByName })}</>}
                      </p>
                    </div>
                    <ActionForm action={revokeInvitationAction} layout="inline" variant="quiet" submitLabel={dict.team.revoke} pendingLabel={dict.team.saving}>
                      {hidden}
                      <input type="hidden" name="invitationId" value={i.id} />
                    </ActionForm>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
