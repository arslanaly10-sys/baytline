import Link from "next/link";
import { redirect } from "next/navigation";
import { workspaceForOrgType } from "@baytline/core";
import { listMyMemberships } from "@baytline/identity";
import { getDictionary } from "@/i18n";
import { requireLocale } from "@/server/guards";
import { dbConfigured, getDb } from "@/server/db";
import { getSession } from "@/server/session";
import { openPersonalWorkspaceAction, signOutAction } from "@/server/actions/auth";
import { ActionForm } from "@/components/forms/ActionForm";
import { buttonClass } from "@/lib/button";
import { BrandMark } from "@/components/ui/BrandMark";
import { PlaceholderBadge } from "@/components/ui/PlaceholderBadge";
import { StatePanel } from "@/components/ui/StatePanel";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";

/** Workspace picker: organization selection (or straight in when there's only one). Signed-out visitors go to sign-in. */
export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const dict = await getDictionary(locale);
  const configured = dbConfigured();
  const session = configured ? await getSession() : null;
  if (configured && !session) redirect(`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/app`)}`);
  const memberships = session ? await listMyMemberships(getDb(), session.user.id) : [];
  if (session && memberships.length === 1) redirect(`/${locale}/o/${memberships[0]!.id}`);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-14">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 text-gulf">
          <BrandMark className="size-8" />
          <span className="text-xl font-medium tracking-tight text-ink">{dict.brand.name}</span>
        </div>
        <div className="flex items-center gap-4">
          <LocaleSwitcher current={locale} label={dict.common.language} />
          {session && (
            <form action={signOutAction}>
              <input type="hidden" name="locale" value={locale} />
              <button type="submit" className="text-sm text-ink-muted underline underline-offset-4">{dict.auth.signOut}</button>
            </form>
          )}
        </div>
      </header>

      <main id="main" className="mt-14 sm:mt-20">
        {!configured ? (
          <StatePanel tone="warning" title={dict.welcome.notConfiguredTitle} body={dict.welcome.notConfiguredBody} />
        ) : !session ? (
          <section>
            <h1 className="max-w-[24ch] text-2xl leading-snug sm:text-3xl">{dict.welcome.title}</h1>
            <p className="mt-4 max-w-[60ch] text-ink-muted">{dict.welcome.intro}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={`/${locale}/sign-in`} className={buttonClass("primary")}>{dict.auth.signIn}</Link>
              <Link href={`/${locale}/sign-up`} className={buttonClass("quiet")}>{dict.auth.createCustomer}</Link>
            </div>
          </section>
        ) : memberships.length === 0 ? (
          <StatePanel title={dict.select.emptyTitle} body={dict.select.emptyBody}>
            <ActionForm action={openPersonalWorkspaceAction} submitLabel={dict.select.openPersonal} pendingLabel={dict.select.opening}>
              <input type="hidden" name="locale" value={locale} />
            </ActionForm>
          </StatePanel>
        ) : (
          <section aria-labelledby="select-title">
            <div className="flex flex-wrap items-center gap-3">
              <h1 id="select-title" className="text-2xl">{dict.select.title}</h1>
              {session.user.isPlaceholder && <PlaceholderBadge label={dict.states.placeholder} hint={dict.states.placeholderHint} />}
            </div>
            <p className="mt-2 max-w-[60ch] text-ink-muted">{dict.select.intro}</p>
            <ul className="mt-8 divide-y divide-line overflow-hidden rounded-panel border border-line bg-surface">
              {memberships.map((m) => (
                <li key={m.id}>
                  <Link href={`/${locale}/o/${m.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-gulf-tint">
                    <span>
                      <span className="block font-medium text-gulf-strong">{m.type === "individual" ? dict.workspaces.personal.name : m.name}</span>
                      <span className="block text-sm text-ink-muted">
                        {dict.workspaces[workspaceForOrgType(m.type).id].name}, {dict.roles[m.role]}
                      </span>
                    </span>
                    {session.lastOrgId === m.id && (
                      <span className="rounded-chip bg-gulf-tint px-2 py-0.5 text-xs text-gulf-strong">{dict.select.lastUsed}</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
