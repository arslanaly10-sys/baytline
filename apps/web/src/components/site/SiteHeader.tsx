import Link from "next/link";
import type { UiLocale } from "@baytline/core";
import type { Dictionary } from "@/i18n";
import { BrandMark } from "@/components/ui/BrandMark";
import { LocaleSwitch } from "./LocaleSwitch";

type Props = { dict: Dictionary; locale: UiLocale };

export function SiteHeader({ dict, locale }: Props) {
  const t = dict.site.nav;
  const home = `/${locale}`;
  const links = [
    { href: `${home}/homes`, label: dict.cx.navHomes },
    { href: `${home}/product`, label: t.product },
    { href: `${home}/solutions`, label: t.solutions },
    { href: `${home}/pricing`, label: t.pricing },
    { href: `${home}/security`, label: t.security },
  ];
  return (
    <header className="fixed inset-x-0 top-0 z-40 bg-gradient-to-b from-night/85 to-night/0">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-4 sm:gap-6 sm:px-8">
        <Link href={home} aria-label={t.home} className="flex items-center gap-2.5 text-gold">
          <BrandMark className="size-9" />
          <span className="hidden whitespace-nowrap text-lg font-medium tracking-tight text-sand sm:inline">{dict.brand.name}</span>
        </Link>
        <nav aria-label={t.menu} className="hidden flex-1 items-center justify-center gap-7 text-sm text-sand/80 lg:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-gold-light">{l.label}</Link>
          ))}
        </nav>
        <div className="ms-auto flex items-center gap-1.5 sm:gap-3 lg:ms-0">
          <LocaleSwitch locale={locale} />
          <Link href={`/${locale}/sign-in`} className="hidden text-sm text-sand/80 hover:text-gold-light sm:inline">{t.signIn}</Link>
          <Link href={`${home}/contact`} className="whitespace-nowrap rounded-full bg-gold px-3 py-2 text-xs font-medium text-night hover:bg-gold-light sm:px-4 sm:text-sm">{t.bookDemo}</Link>
          <details className="relative lg:hidden">
            <summary className="flex size-10 cursor-pointer list-none items-center justify-center rounded-full border border-hairline text-sand" aria-label={t.menu}>
              <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </summary>
            <nav aria-label={t.menu} className="absolute end-0 mt-2 w-56 rounded-2xl border border-hairline bg-night-2 p-2 shadow-xl">
              {[...links, { href: `/${locale}/sign-in`, label: t.signIn }].map((l) => (
                <Link key={l.href} href={l.href} className="block rounded-xl px-3 py-2.5 text-sm text-sand hover:bg-panel">{l.label}</Link>
              ))}
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
