import Link from "next/link";
import type { UiLocale } from "@baytline/core";
import type { Dictionary } from "@/i18n";
import { BrandMark } from "@/components/ui/BrandMark";

export function SiteFooter({ dict, locale }: { dict: Dictionary; locale: UiLocale }) {
  const t = dict.site.footer;
  const n = dict.site.nav;
  const home = `/${locale}`;
  return (
    <footer className="border-t border-hairline bg-night">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-8 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
        <div>
          <div className="flex items-center gap-2.5 text-gold">
            <BrandMark className="size-9" />
            <span className="text-lg font-medium text-sand">{dict.brand.name}</span>
          </div>
          <p className="mt-3 max-w-[32ch] text-sm text-mist">{t.tagline}</p>
        </div>
        <nav aria-label={t.product}>
          <h2 className="text-sm text-sand">{t.product}</h2>
          <ul className="mt-3 space-y-2 text-sm text-mist">
            {[["/product", n.product], ["/solutions", n.solutions], ["/pricing", n.pricing], ["/security", n.security]].map(([h, l]) => (
              <li key={h}><Link href={`${home}${h}`} className="hover:text-gold-light">{l}</Link></li>
            ))}
          </ul>
        </nav>
        <nav aria-label={t.company}>
          <h2 className="text-sm text-sand">{t.company}</h2>
          <ul className="mt-3 space-y-2 text-sm text-mist">
            <li><Link href={`${home}/contact`} className="hover:text-gold-light">{n.bookDemo}</Link></li>
            <li><Link href={`/${locale}/sign-in`} className="hover:text-gold-light">{n.signIn}</Link></li>
          </ul>
        </nav>
        <nav aria-label={t.legal}>
          <h2 className="text-sm text-sand">{t.legal}</h2>
          <ul className="mt-3 space-y-2 text-sm text-mist">
            <li><Link href={`/${locale}/privacy`} className="hover:text-gold-light">{t.privacy}</Link></li>
            <li><Link href={`/${locale}/terms`} className="hover:text-gold-light">{t.terms}</Link></li>
          </ul>
          <p className="mt-3 text-xs text-mist/80">{t.draftNote}</p>
        </nav>
      </div>
      <p className="mx-auto flex max-w-7xl flex-wrap gap-x-4 gap-y-1 px-4 pb-8 text-xs text-mist sm:px-8">
        <span>{t.rights}</span>
        <span>{dict.site.photos.creditLine} <Link href={`/${locale}/credits`} className="underline underline-offset-2 hover:text-gold-light">{dict.site.photos.creditLink}</Link></span>
      </p>
    </footer>
  );
}
