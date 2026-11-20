import type { Metadata } from "next";
import { getDictionary } from "@/i18n";
import { siteMeta } from "@/lib/site-meta";
import { requireLocale } from "@/server/guards";
import { MARKETS } from "@baytline/core";
import { DemoForm } from "@/components/site/DemoForm";
import { PageHero } from "@/components/site/sections";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const dict = await getDictionary(locale);
  const t = dict.site.pages.contact;
  return siteMeta({ locale, path: "/contact", title: `${t.title} · ${dict.brand.name}`, description: t.intro, brand: dict.brand.name });
}

export default async function ContactPage({ params }: Params) {
  const locale = requireLocale((await params).locale);
  const dict = await getDictionary(locale);
  const t = dict.site.pages.contact;
  return (
    <main id="main" className="bg-night text-sand">
      <PageHero eyebrow={t.eyebrow} title={t.title} intro={t.intro} />
      <section className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-8 md:py-24 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
        <div>
          <h2 className="font-display text-3xl text-gold-light">{t.nextTitle}</h2>
          <ol className="mt-6 space-y-5">
            {t.next.map((step, i) => (
              <li key={step} className="flex gap-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-gold/50 font-display text-lg text-gold-light">{i + 1}</span>
                <span className="pt-1.5 text-sand/90">{step}</span>
              </li>
            ))}
          </ol>
        </div>
        <div id="demo" className="rounded-3xl border border-hairline bg-night-2 p-6 sm:p-9">
          <DemoForm locale={locale} t={dict.site.demo} markets={MARKETS.map((m) => ({ code: m.code, name: dict.markets[m.code] }))} privacyHref={`/${locale}/privacy`} />
        </div>
      </section>
    </main>
  );
}
