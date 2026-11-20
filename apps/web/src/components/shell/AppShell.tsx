import Link from "next/link";
import { hasCapability, workspaceForOrgType, type MarketCode, type UiLocale } from "@baytline/core";
import type { MarketConfig } from "@baytline/platform";
import type { OrgContext, ValidSession } from "@baytline/identity";
import type { Dictionary } from "@/i18n";
import { signOutAction } from "@/server/actions/auth";
import { BrandMark } from "@/components/ui/BrandMark";
import { PlaceholderBadge } from "@/components/ui/PlaceholderBadge";
import { sectionLabel } from "@/lib/sections";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { MarketSwitcher } from "./MarketSwitcher";
import { SectionNav, type NavItem } from "./SectionNav";

type Props = {
  dict: Dictionary;
  locale: UiLocale;
  session: ValidSession;
  ctx: OrgContext;
  market: MarketCode;
  markets: MarketConfig[];
  children: React.ReactNode;
};

/** Navigation mirrors permissions for convenience only; every page re-checks on the server. */
export function AppShell({ dict, locale, session, ctx, market, markets, children }: Props) {
  const { user } = session;
  const base = `/${locale}/o/${ctx.org.id}`;
  const workspace = workspaceForOrgType(ctx.org.type);
  const wsDict = dict.workspaces[workspace.id];

  const navItems: NavItem[] = [
    { href: base, label: dict.common.overview },
    ...workspace.sections
      .filter((s) => hasCapability(ctx.principal, s.requires))
      .map((s) => ({ href: `${base}/${s.id}`, label: sectionLabel(wsDict, s.id) })),
  ];

  const orgLabel = (m: OrgContext["memberships"][number]) => (m.type === "individual" ? dict.workspaces.personal.name : m.name);

  const signOut = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <a href={`/${locale}/app/security`} className="text-sm underline-offset-4 hover:underline">{dict.sec.mfa.title}</a>
      <form action={signOutAction}>
        <input type="hidden" name="locale" value={locale} />
        <button type="submit" className="text-sm underline-offset-4 hover:underline">
          {dict.auth.signOut}
        </button>
      </form>
    </div>
  );

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[17rem_1fr] md:bg-[linear-gradient(to_right,var(--rail)_17rem,transparent_17rem)] md:rtl:bg-[linear-gradient(to_left,var(--rail)_17rem,transparent_17rem)]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2">
        {dict.common.skipToContent}
      </a>

      <aside className="border-line bg-rail text-rail-ink md:border-e md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:overflow-y-auto">
        <Link href={`/${locale}/app`} className="flex items-center gap-2.5 px-4 pt-4 pb-3 md:px-5 md:pt-6">
          <BrandMark className="size-7 text-[var(--focus)]" />
          <span className="text-lg font-medium tracking-tight">{dict.brand.name}</span>
        </Link>

        <nav aria-label={dict.common.switchWorkspace} className="px-4 pb-3 md:px-5 md:pb-6">
          <ul className="flex gap-2 overflow-x-auto md:flex-col md:gap-1">
            {ctx.memberships.map((m) => {
              const active = m.id === ctx.org.id;
              return (
                <li key={m.id} className="shrink-0">
                  <Link
                    href={`/${locale}/o/${m.id}`}
                    aria-current={active ? "true" : undefined}
                    className={`block rounded-control border px-3 py-2 ${
                      active ? "border-gulf/50 bg-rail-active" : "border-transparent text-rail-muted hover:border-rail-muted/30"
                    }`}
                  >
                    <span className="block text-sm font-medium text-rail-ink">{orgLabel(m)}</span>
                    <span className="block text-xs text-rail-muted">{dict.roles[m.role]}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-rail-muted/20 px-2 py-3 md:flex-1 md:px-3">
          <SectionNav items={navItems} label={dict.common.mainNav} />
        </div>

        <div className="hidden space-y-1 px-5 py-4 md:block">
          <p className="text-sm font-medium">{user.displayName}</p>
          <p className="truncate text-xs text-rail-muted" dir="ltr">{user.email}</p>
          <div className="text-rail-muted hover:text-rail-ink">{signOut}</div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="flex flex-wrap items-center gap-3 border-b border-line bg-canvas px-4 py-3 sm:px-8">
          {user.isPlaceholder && <PlaceholderBadge label={dict.states.placeholder} hint={dict.states.placeholderHint} />}
          <div className="ms-auto flex flex-wrap items-center gap-3">
            <MarketSwitcher
              current={market}
              label={dict.common.market}
              options={markets.filter((m) => m.status === "enabled" || m.code === market).map((m) => ({ code: m.code, name: m.name[locale], currency: m.currency }))}
            />
            <LocaleSwitcher current={locale} label={dict.common.language} />
            <div className="text-ink-muted md:hidden">{signOut}</div>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
