import type { Metadata } from "next";
import { getDictionary } from "@/i18n";
import { requireLocale } from "@/server/guards";
import { AiSection, ControlSection, Eyebrow, PageHero, sectionHead } from "@/components/site/sections";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const dict = await getDictionary(requireLocale((await params).locale));
  const t = dict.site.pages.product;
  return { title: { absolute: `${t.title} · ${dict.brand.name}` }, description: t.intro };
}

export default async function ProductPage({ params }: Params) {
  const locale = requireLocale((await params).locale);
  const dict = await getDictionary(locale);
  const t = dict.site.pages.product;
  return (
    <main id="main" className="bg-night text-sand">
      <PageHero eyebrow={t.eyebrow} title={t.title} intro={t.intro} />
      <section className="mx-auto max-w-7xl px-4 py-24 sm:px-8">
        <Eyebrow n="01">{t.eyebrow}</Eyebrow>
        <h2 className={`mt-5 ${sectionHead}`}>{t.pillars.title}</h2>
        <div className="mt-14 grid gap-px overflow-hidden rounded-3xl border border-hairline bg-hairline md:grid-cols-2">
          {t.pillars.items.map((it, i) => (
            <article key={it.h} className="bg-night-2 p-8">
              <p className="font-display text-2xl text-gold">{String(i + 1).padStart(2, "0")}</p>
              <h3 className="mt-3 font-display text-3xl text-sand">{it.h}</h3>
              <p className="mt-3 text-mist">{it.p}</p>
            </article>
          ))}
        </div>
      </section>
      <AiSection dict={dict} locale={locale} n="02" />
      <ControlSection dict={dict} locale={locale} n="03" more={`/${locale}/security`} />
    </main>
  );
}
