import Link from "next/link";
import { isRoleForOrgType, type OrgType } from "@baytline/core";
import { PASSWORD_MAX, PASSWORD_MIN, previewInvitation } from "@baytline/identity";
import { getDictionary } from "@/i18n";
import { format, splitAround } from "@/i18n/format";
import { requireLocale, signInPath } from "@/server/guards";
import { dbConfigured, getDb } from "@/server/db";
import { getSession } from "@/server/session";
import { acceptInviteAction, inviteSignUpAction, signOutAction } from "@/server/actions/auth";
import { ActionForm } from "@/components/forms/ActionForm";
import { buttonClass } from "@/lib/button";
import { Field } from "@/components/forms/Field";
import { StatePanel } from "@/components/ui/StatePanel";

export const metadata = { title: "Invitation", referrer: "no-referrer" };

export default async function Invite({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale: raw, token } = await params;
  const locale = requireLocale(raw);
  const dict = await getDictionary(locale);
  if (!dbConfigured()) return <StatePanel tone="warning" title={dict.welcome.notConfiguredTitle} body={dict.welcome.notConfiguredBody} />;

  const inv = await previewInvitation(getDb(), token);
  if (!inv || inv.state !== "pending") {
    const state = !inv || inv.state === "pending" ? "invalid" : inv.state;
    return <StatePanel title={dict.invite.states[state]} />;
  }

  const roleLabel = isRoleForOrgType(inv.role, inv.orgType as OrgType) ? dict.roles[inv.role] : inv.role;
  const session = await getSession();
  const here = `/${locale}/invite/${token}`;
  const forEmail = splitAround(dict.invite.forEmail, "email");

  return (
    <div>
      <h1 className="text-2xl">{format(dict.invite.title, { org: inv.orgName })}</h1>
      <p className="mt-2 text-ink-muted">{format(dict.invite.asRole, { role: roleLabel })}</p>
      <p className="mt-1 text-sm text-ink-muted">
        {forEmail[0]}
        <bdi dir="ltr" className="font-medium text-ink">{inv.email}</bdi>
        {forEmail[1]}
      </p>

      {session ? (
        session.user.email === inv.email ? (
          <ActionForm action={acceptInviteAction} submitLabel={dict.invite.accept} pendingLabel={dict.invite.accepting} className="mt-8">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="token" value={token} />
          </ActionForm>
        ) : (
          <div className="mt-8 space-y-4">
            <p className="rounded-control border-s-4 border-saffron bg-surface px-3 py-2 text-sm">
              {format(dict.invite.signedInAs, { email: session.user.email })} {dict.invite.wrongAccount}
            </p>
            <form action={signOutAction}>
              <input type="hidden" name="locale" value={locale} />
              <button type="submit" className={buttonClass("quiet")}>{dict.auth.signOut}</button>
            </form>
          </div>
        )
      ) : (
        <>
          <h2 className="mt-8 text-lg">{dict.invite.createAccount}</h2>
          <ActionForm action={inviteSignUpAction} submitLabel={dict.auth.create} pendingLabel={dict.auth.creating} className="mt-4">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="token" value={token} />
            <Field label={dict.auth.email} name="emailShown" value={inv.email} readOnly disabled dir="ltr" />
            <Field label={dict.auth.displayName} name="displayName" autoComplete="name" required maxLength={120} />
            <Field
              label={dict.auth.password}
              hint={dict.auth.passwordHint}
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN}
              maxLength={PASSWORD_MAX}
            />
          </ActionForm>
          <p className="mt-6 text-sm text-ink-muted">
            {dict.invite.haveAccount}{" "}
            <Link href={signInPath(locale, here)} className="text-gulf-strong underline underline-offset-4">{dict.invite.signInToAccept}</Link>
          </p>
        </>
      )}
    </div>
  );
}
