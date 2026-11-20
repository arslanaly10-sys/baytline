import type { Metadata } from "next";
import { getDictionary } from "@/i18n";
import { siteMeta } from "@/lib/site-meta";
import { requireLocale } from "@/server/guards";
import { PageHero } from "@/components/site/sections";
import { Photo } from "@/components/site/Photo";
import { PHOTOS } from "@/lib/photos";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const dict = await getDictionary(locale);
  return siteMeta({ locale, path: "/credits", title: `${dict.site.credits.title} · ${dict.brand.name}`, description: dict.site.credits.intro, brand: dict.brand.name, noindex: true });
}

export default async function CreditsPage({ params }: Params) {
  const dict = await getDictionary(requireLocale((await params).locale));
  const t = dict.site.credits;
  return (
    <main id="main" className="bg-night text-sand">
      <PageHero eyebrow={dict.site.footer.legal} title={t.title} intro={t.intro} />
      <ul className="mx-auto grid max-w-7xl gap-8 px-4 py-20 sm:grid-cols-2 sm:px-8 lg:grid-cols-3">
        {Object.values(PHOTOS).map((p) => (
          <li key={p.slug}>
            <Photo slug={p.slug} alt={dict.site.photos.alt[p.slug]} className="rounded-2xl" sizes="(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw" />
            <dl className="mt-4 space-y-1 text-sm">
              <div className="flex gap-2"><dt className="text-mist">{t.by}</dt><dd className="text-sand" dir="ltr">{p.by}</dd></div>
              <div className="flex gap-2"><dt className="text-mist">{t.licence}</dt><dd><a href={p.licenceUrl} className="text-gold-light underline underline-offset-2" dir="ltr">{p.licence}</a></dd></div>
              <div className="flex gap-2"><dt className="text-mist">{t.source}</dt><dd><a href={p.page} className="text-gold-light underline underline-offset-2" dir="ltr">{p.source}</a></dd></div>
            </dl>
            {p.adapted && <p className="mt-1 text-xs text-mist">{t.adapted}</p>}
          </li>
        ))}
      </ul>
    </main>
  );
}
