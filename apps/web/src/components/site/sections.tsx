import Link from "next/link";
import { AI_CAPABILITIES, AUTONOMY_LEVELS, MARKETS, type AiCategory } from "@baytline/core";
import type { Dictionary } from "@/i18n";
import { AUDIENCE_PHOTO, MARKET_PHOTO } from "@/lib/photos";
import { DemoForm } from "./DemoForm";
import { Photo } from "./Photo";

export type SectionProps = { dict: Dictionary; locale: "en" | "ar"; n: string; more?: string };

const CATEGORY_ORDER: AiCategory[] = ["conversations", "voice", "leads", "automation", "inventory", "property_management", "insights", "website"];
// What exists in the app today. Everything else is labelled "In development".
export const AVAILABLE_AUDIENCES = new Set(["developer"]);
export const sectionHead = "font-display text-4xl leading-[1.05] text-sand sm:text-5xl md:text-6xl";

export function Eyebrow({ n, children }: { n?: string; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-3 text-xs tracking-[0.2em] text-gold uppercase">
      {n && <span className="font-display text-base tracking-normal">{n}</span>}
      <span aria-hidden="true" className="h-px w-10 bg-gold/50" />
      {children}
    </p>
  );
}

export function Status({ available, label }: { available: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${available ? "border-gold/50 text-gold-light" : "border-hairline text-mist"}`}>
      <span aria-hidden="true" className={`size-1.5 rounded-full ${available ? "bg-gold-light" : "bg-mist/60"}`} />
      {label}
    </span>
  );
}


export function MoreLink({ href, label }: { href?: string; label: string }) {
  if (!href) return null;
  return (
    <Link href={href} className="mt-10 inline-flex items-center gap-2 text-gold-light underline-offset-4 hover:underline">
      {label}
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 8h10M9 4l4 4-4 4" /></svg>
    </Link>
  );
}

/** Opening block for the inner pages, with room under the fixed header. */
export function PageHero({ eyebrow, title, intro }: { eyebrow: string; title: string; intro: string }) {
  return (
    <header className="border-b border-hairline bg-[radial-gradient(ellipse_at_top,rgba(201,162,74,0.14),transparent_65%)]">
      <div className="mx-auto max-w-7xl px-4 pb-20 pt-36 sm:px-8 md:pb-24 md:pt-44">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-5 max-w-[20ch] font-display text-5xl leading-[1.02] text-sand sm:text-6xl md:text-7xl">{title}</h1>
        <p className="mt-6 max-w-[60ch] text-lg text-mist md:text-xl">{intro}</p>
      </div>
    </header>
  );
}

export function AudiencesSection({ dict, locale, n, more }: SectionProps) {
  const s = dict.site;
  const audiences = (["developer", "brokerage", "management", "personal"] as const).map((k) => ({ key: k, ...s.audiences[k] }));
  return (
    <section id="product" className="scroll-mt-20 border-t border-hairline">
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-8 md:py-32">
        <Eyebrow n={n}>{s.nav.product}</Eyebrow>
        <h2 className={`mt-5 max-w-[18ch] ${sectionHead}`}>{s.audiences.title}</h2>
        <p className="mt-5 max-w-[60ch] text-lg text-mist">{s.audiences.intro}</p>
        <div className="mt-14 grid gap-px overflow-hidden rounded-3xl border border-hairline bg-hairline md:grid-cols-2">
          {audiences.map((a) => (
            <article key={a.key} className="bg-night-2">
              <Photo slug={AUDIENCE_PHOTO[a.key]} alt={s.photos.alt[AUDIENCE_PHOTO[a.key]]} ratio="16 / 9" sizes="(min-width: 1280px) 620px, (min-width: 768px) 50vw, 100vw" />
              <div className="p-7 sm:p-9">
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
              </div>
            </article>
          ))}
        </div>
        <MoreLink href={more} label={s.pages.learnMore} />
      </div>
    </section>
  );
}

export function AiSection({ dict, locale, n, more }: SectionProps) {
  const s = dict.site;
  const byCategory = CATEGORY_ORDER.map((cat) => ({ cat, items: AI_CAPABILITIES.filter((c) => c.category === cat) }));
  return (
    <section id="ai" className="scroll-mt-20 border-t border-hairline bg-[radial-gradient(ellipse_at_top,rgba(201,162,74,0.10),transparent_60%)]">
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-8 md:py-32">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <Eyebrow n={n}>{s.nav.ai}</Eyebrow>
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
        <MoreLink href={more} label={s.pages.learnMore} />
      </div>
    </section>
  );
}

export function ControlSection({ dict, locale, n, more }: SectionProps) {
  const s = dict.site;
  return (
    <section id="control" className="scroll-mt-20 border-t border-hairline">
      <div className="mx-auto grid max-w-7xl gap-14 px-4 py-24 sm:px-8 md:py-32 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div>
          <Eyebrow n={n}>{s.nav.control}</Eyebrow>
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
        <MoreLink href={more} label={s.pages.learnMore} />
      </div>
    </section>
  );
}

export function MarketsSection({ dict, locale, n, more }: SectionProps) {
  const s = dict.site;
  return (
    <section id="markets" className="scroll-mt-20 border-t border-hairline">
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-8 md:py-32">
        <Eyebrow n={n}>{s.nav.markets}</Eyebrow>
        <h2 className={`mt-5 ${sectionHead}`}>{s.markets.title}</h2>
        <p className="mt-5 max-w-[62ch] text-lg text-mist">{s.markets.intro}</p>
        <ul className="mt-14 grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-hairline bg-hairline sm:grid-cols-3 lg:grid-cols-6">
          {MARKETS.map((m) => (
            <li key={m.code} className="bg-night-2">
              <Photo slug={MARKET_PHOTO[m.code]} alt={s.photos.alt[MARKET_PHOTO[m.code]]} ratio="4 / 5" sizes="(min-width: 1024px) 210px, (min-width: 640px) 33vw, 50vw" />
              <div className="p-5">
                <p className="font-display text-3xl text-gold-light" dir="ltr">{m.code}</p>
                <p className="mt-2 text-sand">{dict.markets[m.code]}</p>
                <p className="mt-1 text-sm text-mist"><bdi dir="ltr">{m.currency} · {m.timeZone.split("/")[1]}</bdi></p>
              </div>
            </li>
          ))}
        </ul>
        <MoreLink href={more} label={s.pages.learnMore} />
      </div>
    </section>
  );
}

export function SecuritySection({ dict, locale, n, more }: SectionProps) {
  const s = dict.site;
  return (
    <section id="security" className="scroll-mt-20 border-t border-hairline">
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-8 md:py-32">
        <Eyebrow n={n}>{s.nav.security}</Eyebrow>
        <h2 className={`mt-5 ${sectionHead}`}>{s.security.title}</h2>
        <div className="mt-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {(["isolation", "roles", "approvals", "audit"] as const).map((k, i) => (
            <div key={k} className="border-t border-gold/40 pt-5">
              <p className="font-display text-2xl text-gold">{String(i + 1).padStart(2, "0")}</p>
              <p className="mt-3 text-sand/90">{s.security.points[k]}</p>
            </div>
          ))}
        </div>
        <MoreLink href={more} label={s.pages.learnMore} />
      </div>
    </section>
  );
}

export function DemoSection({ dict, locale, n, more }: SectionProps) {
  const s = dict.site;
  return (
    <section id="demo" className="scroll-mt-20 border-t border-hairline bg-[radial-gradient(ellipse_at_bottom,rgba(201,162,74,0.12),transparent_65%)]">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 py-24 sm:px-8 md:py-32 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div>
          <Eyebrow n={n}>{s.nav.bookDemo}</Eyebrow>
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
        <MoreLink href={more} label={s.pages.learnMore} />
      </div>
    </section>
  );
}

