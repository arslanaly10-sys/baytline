import type { Metadata } from "next";
import { getDictionary } from "@/i18n";
import { siteMeta } from "@/lib/site-meta";
import { requireLocale } from "@/server/guards";
import { SkylineFilm, type FilmText } from "@/components/site/skyline/SkylineFilm";
import { AiSection, AudiencesSection, ControlSection, DemoSection, MarketsSection, SecuritySection } from "@/components/site/sections";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const dict = await getDictionary(locale);
  return siteMeta({ locale, path: "", title: `${dict.brand.name}: ${dict.site.film.c1.title}`, description: dict.site.film.c1.body, brand: dict.brand.name });
}

export default async function HomePage({ params }: Params) {
  const locale = requireLocale((await params).locale);
  const dict = await getDictionary(locale);
  const s = dict.site;
  const f = s.film;
  const film: FilmText = {
    chapters: [f.c1, f.c2, f.c3, f.c4],
    finale: f.c5,
    previewLabel: f.previewLabel,
    preview: f.preview,
    sound: s.sound,
    skip: s.skipFilm,
    ctaHref: "#demo",
    secondaryHref: "#product",
  };
  const p = { dict, locale };
  const to = (page: string) => `/${locale}/${page}`;
  return (
    <main id="main" className="bg-night text-sand">
      <SkylineFilm t={film} />
      <AudiencesSection {...p} n="01" more={to("solutions")} />
      <AiSection {...p} n="02" more={to("product")} />
      <ControlSection {...p} n="03" />
      <MarketsSection {...p} n="04" />
      <SecuritySection {...p} n="05" more={to("security")} />
      <DemoSection {...p} n="06" />
    </main>
  );
}
