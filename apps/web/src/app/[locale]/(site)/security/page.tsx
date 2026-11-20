import type { Metadata } from "next";
import { getDictionary } from "@/i18n";
import { requireLocale } from "@/server/guards";
import { PageHero } from "@/components/site/sections";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const dict = await getDictionary(requireLocale((await params).locale));
  const t = dict.site.pages.security;
  return { title: { absolute: `${t.title} · ${dict.brand.name}` }, description: t.intro };
}

export default async function SecurityPage({ params }: Params) {
  const locale = requireLocale((await params).locale);
  const dict = await getDictionary(locale);
  const t = dict.site.pages.security;
  return (
    <main id="main" className="bg-night text-sand">
      <PageHero eyebrow={t.eyebrow} title={t.title} intro={t.intro} />
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-8 md:py-24">
        <div className="grid gap-px overflow-hidden rounded-3xl border border-hairline bg-hairline md:grid-cols-2">
          {t.groups.map((g, i) => (
            <article key={g.h} className="bg-night-2 p-8">
              <p className="font-display text-2xl text-gold">{String(i + 1).padStart(2, "0")}</p>
              <h2 className="mt-3 font-display text-3xl text-sand">{g.h}</h2>
              <ul className="mt-5 space-y-3 text-mist">
                {g.items.map((it) => (
                  <li key={it} className="flex gap-3"><span aria-hidden="true" className="mt-2.5 h-px w-4 shrink-0 bg-gold" />{it}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
        <p role="note" className="mt-10 max-w-[70ch] border-s-2 border-gold/60 ps-4 text-sand/90">{t.honesty}</p>
      </section>
    </main>
  );
}
