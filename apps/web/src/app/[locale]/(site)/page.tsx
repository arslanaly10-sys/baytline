import type { Metadata } from "next";
import { AI_CAPABILITIES, AUTONOMY_LEVELS, MARKETS, type AiCategory } from "@baytline/core";
import { getDictionary } from "@/i18n";
import { requireLocale } from "@/server/guards";
import { SkylineFilm, type FilmText } from "@/components/site/skyline/SkylineFilm";
import { DemoForm } from "@/components/site/DemoForm";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const dict = await getDictionary(requireLocale((await params).locale));
  return { title: { absolute: `${dict.brand.name}: ${dict.site.film.c1.title}` }, description: dict.site.film.c1.body };
}

const CATEGORY_ORDER: AiCategory[] = ["conversations", "voice", "leads", "automation", "inventory", "property_management", "insights", "website"];
// What exists in the app today. Everything else is labelled "In development".
const AVAILABLE_AUDIENCES = new Set(["developer"]);

function Eyebrow({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-3 text-xs tracking-[0.2em] text-gold uppercase">
      <span className="font-display text-base tracking-normal">{n}</span>
      <span aria-hidden="true" className="h-px w-10 bg-gold/50" />
      {children}
    </p>
  );
}

function Status({ available, label }: { available: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${available ? "border-gold/50 text-gold-light" : "border-hairline text-mist"}`}>
      <span aria-hidden="true" className={`size-1.5 rounded-full ${available ? "bg-gold-light" : "bg-mist/60"}`} />
      {label}
    </span>
  );
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

  const audiences = (["developer", "brokerage", "management", "personal"] as const).map((k) => ({ key: k, ...s.audiences[k] }));
  const byCategory = CATEGORY_ORDER.map((cat) => ({ cat, items: AI_CAPABILITIES.filter((c) => c.category === cat) }));
  const sectionHead = "font-display text-4xl leading-[1.05] text-sand sm:text-5xl md:text-6xl";

  return (
    <main id="main" className="bg-night text-sand">
      <SkylineFilm t={film} />

      {/* Audiences */}
      <section id="product" className="scroll-mt-20 border-t border-hairline">
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-8 md:py-32">
          <Eyebrow n="01">{s.nav.product}</Eyebrow>
          <h2 className={`mt-5 max-w-[18ch] ${sectionHead}`}>{s.audiences.title}</h2>
          <p className="mt-5 max-w-[60ch] text-lg text-mist">{s.audiences.intro}</p>
          <div className="mt-14 grid gap-px overflow-hidden rounded-3xl border border-hairline bg-hairline md:grid-cols-2">
            {audiences.map((a) => (
              <article key={a.key} className="bg-night-2 p-7 sm:p-9">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-display text-3xl text-sand">{a.name}</h3>
                  <Status available={AVAILABLE_AUDIENCES.has(a.key)} label={AVAILABLE_AUDIENCES.has(a.key) ? s.status.available : s.status.building} />
                </div>
                <ul className="mt-6 space-y-3 text-mist">
                  {a.points.map((p) => (
                    <li key={p} className="flex gap-3">
                      <span aria-hidden="true" className="mt-2.5 h-px w-4 shrink-0 bg-gold" />
                      {p}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* AI catalogue */}
      <section id="ai" className="scroll-mt-20 border-t border-hairline bg-[radial-gradient(ellipse_at_top,rgba(201,162,74,0.10),transparent_60%)]">
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-8 md:py-32">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <Eyebrow n="02">{s.nav.ai}</Eyebrow>
              <h2 className={`mt-5 max-w-[16ch] ${sectionHead}`}>{s.ai.title}</h2>
            </div>
            <Status available={false} label={s.status.building} />
          </div>
          <p className="mt-5 max-w-[62ch] text-lg text-mist">{s.ai.intro}</p>
          <div className="mt-14 grid gap-x-10 gap-y-14 md:grid-cols-2 xl:grid-cols-4">
            {byCategory.map(({ cat, items }) => (
              <div key={cat}>
                <h3 className="border-b border-gold/40 pb-3 text-sm tracking-[0.14em] text-gold-light uppercase">{s.ai.categories[cat]}</h3>
                <dl className="mt-5 space-y-5">
                  {items.map((c) => {
                    const t = s.ai.capabilities[c.id as keyof typeof s.ai.capabilities];
                    return (
                      <div key={c.id}>
                        <dt className="text-sand">{t.name}</dt>
                        <dd className="mt-1 text-sm leading-relaxed text-mist">{t.desc}</dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Control ladder */}
      <section id="control" className="scroll-mt-20 border-t border-hairline">
        <div className="mx-auto grid max-w-7xl gap-14 px-4 py-24 sm:px-8 md:py-32 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div>
            <Eyebrow n="03">{s.nav.control}</Eyebrow>
            <h2 className={`mt-5 ${sectionHead}`}>{s.control.title}</h2>
            <p className="mt-5 max-w-[52ch] text-lg text-mist">{s.control.intro}</p>
            <div className="mt-10 rounded-3xl border border-gold/30 bg-panel p-7">
              <h3 className="font-display text-2xl text-gold-light">{s.control.rules.title}</h3>
              <ul className="mt-4 space-y-3 text-sand/90">
                {(["binding", "disclose", "quiet", "consent"] as const).map((k) => (
                  <li key={k} className="flex gap-3">
                    <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-1 size-4 shrink-0 text-gold" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m3 8.5 3 3 7-7" /></svg>
                    {s.control.rules[k]}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <ol className="relative space-y-3">
            {AUTONOMY_LEVELS.map((lvl, i) => (
              <li key={lvl} className="flex items-stretch gap-5">
                <div className="flex w-14 shrink-0 flex-col items-center">
                  <span className="flex size-12 items-center justify-center rounded-full border border-gold/50 font-display text-xl text-gold-light" style={{ background: `rgba(201,162,74,${0.04 + i * 0.07})` }}>
                    {i}
                  </span>
                  {i < AUTONOMY_LEVELS.length - 1 && <span aria-hidden="true" className="w-px flex-1 bg-gradient-to-b from-gold/50 to-hairline" />}
                </div>
                <div className="flex-1 pb-6 pt-2">
                  <h3 className="text-xl text-sand">{s.control.levels[lvl].name}</h3>
                  <p className="mt-1 text-mist">{s.control.levels[lvl].desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Markets */}
      <section id="markets" className="scroll-mt-20 border-t border-hairline">
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-8 md:py-32">
          <Eyebrow n="04">{s.nav.markets}</Eyebrow>
          <h2 className={`mt-5 ${sectionHead}`}>{s.markets.title}</h2>
          <p className="mt-5 max-w-[62ch] text-lg text-mist">{s.markets.intro}</p>
          <ul className="mt-14 grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-hairline bg-hairline sm:grid-cols-3 lg:grid-cols-6">
            {MARKETS.map((m) => (
              <li key={m.code} className="bg-night-2 p-6">
                <p className="font-display text-4xl text-gold-light" dir="ltr">{m.code}</p>
                <p className="mt-3 text-sand">{dict.markets[m.code]}</p>
                <p className="mt-1 text-sm text-mist" dir="ltr">{m.currency} · {m.timeZone.split("/")[1]}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Security */}
      <section id="security" className="scroll-mt-20 border-t border-hairline">
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-8 md:py-32">
          <Eyebrow n="05">{s.nav.security}</Eyebrow>
          <h2 className={`mt-5 ${sectionHead}`}>{s.security.title}</h2>
          <div className="mt-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            {(["isolation", "roles", "approvals", "audit"] as const).map((k, i) => (
              <div key={k} className="border-t border-gold/40 pt-5">
                <p className="font-display text-2xl text-gold">{String(i + 1).padStart(2, "0")}</p>
                <p className="mt-3 text-sand/90">{s.security.points[k]}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Demo */}
      <section id="demo" className="scroll-mt-20 border-t border-hairline bg-[radial-gradient(ellipse_at_bottom,rgba(201,162,74,0.12),transparent_65%)]">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-24 sm:px-8 md:py-32 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div>
            <Eyebrow n="06">{s.nav.bookDemo}</Eyebrow>
            <h2 className={`mt-5 ${sectionHead}`}>{s.demo.title}</h2>
            <p className="mt-5 max-w-[46ch] text-lg text-mist">{s.demo.intro}</p>
          </div>
          <div className="rounded-3xl border border-hairline bg-night-2 p-6 sm:p-9">
            <DemoForm
              locale={locale}
              t={s.demo}
              markets={MARKETS.map((m) => ({ code: m.code, name: dict.markets[m.code] }))}
              privacyHref={`/${locale}/privacy`}
            />
          </div>
        </div>
      </section>
    </main>
  );
}
