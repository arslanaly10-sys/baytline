import type { Metadata } from "next";
import { getDictionary } from "@/i18n";
import { siteMeta } from "@/lib/site-meta";
import { requireLocale } from "@/server/guards";
import Link from "next/link";
import { PageHero } from "@/components/site/sections";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const dict = await getDictionary(locale);
  const t = dict.site.pages.pricing;
  return siteMeta({ locale, path: "/pricing", title: `${t.title} · ${dict.brand.name}`, description: t.intro, brand: dict.brand.name });
}

export default async function PricingPage({ params }: Params) {
  const locale = requireLocale((await params).locale);
  const dict = await getDictionary(locale);
  const s = dict.site;
  const t = s.pages.pricing;
  const plans = (["developer", "brokerage", "management", "personal"] as const).map((k) => ({ key: k, ...t.plans[k] }));
  return (
    <main id="main" className="bg-night text-sand">
      <PageHero eyebrow={t.eyebrow} title={t.title} intro={t.intro} />
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-8 md:py-24">
        <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {plans.map((p) => (
            <li key={p.key} className="flex flex-col rounded-3xl border border-hairline bg-night-2 p-7 hover:border-gold/50">
              <h2 className="font-display text-3xl text-sand">{p.name}</h2>
              <p className="mt-2 min-h-12 text-sm text-mist">{p.for}</p>
              <p className="mt-6 font-display text-2xl text-gold-light">{"price" in p ? p.price : s.pages.talkToSales}</p>
              <p className="mt-6 text-xs tracking-[0.14em] text-mist uppercase">{t.includes}</p>
              <ul className="mt-3 flex-1 space-y-2.5 text-sm text-sand/90">
                {p.items.map((it) => (
                  <li key={it} className="flex gap-2.5">
                    <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-0.5 size-4 shrink-0 text-gold" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m3 8.5 3 3 7-7" /></svg>
                    {it}
                  </li>
                ))}
              </ul>
              {"price" in p ? (
                <Link href={`/${locale}/sign-up`} className="mt-8 rounded-full border border-sand/30 px-5 py-2.5 text-center text-sm text-sand hover:border-gold-light">{dict.auth.createCustomer}</Link>
              ) : (
                <Link href={`/${locale}/contact`} className="mt-8 rounded-full bg-gold px-5 py-2.5 text-center text-sm font-medium text-night hover:bg-gold-light">{s.pages.talkToSales}</Link>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-8 text-sm text-mist">{t.aiNote}</p>
      </section>
      <section className="border-t border-hairline">
        <div className="mx-auto max-w-3xl px-4 py-20 sm:px-8">
          <h2 className="font-display text-4xl text-sand">{t.faqTitle}</h2>
          <dl className="mt-8 divide-y divide-hairline border-y border-hairline">
            {t.faq.map((f) => (
              <div key={f.q} className="py-6">
                <dt className="text-lg text-sand">{f.q}</dt>
                <dd className="mt-2 text-mist">{f.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </main>
  );
}
