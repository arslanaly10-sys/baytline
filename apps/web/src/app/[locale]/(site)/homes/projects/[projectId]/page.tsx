import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Buildings, CalendarBlank, MapPin, SealCheck } from "@phosphor-icons/react/dist/ssr";
import { IdentityError } from "@baytline/identity";
import { getPublicLocation, getPublicProject, listPublicMarkets } from "@baytline/marketplace";
import type { PlaceKind } from "@baytline/core";
import { LocationPanel } from "@/components/location/LocationPanel";
import { getDictionary } from "@/i18n";
import { format } from "@/i18n/format";
import { requireLocale } from "@/server/guards";
import { getDb } from "@/server/db";
import { siteMeta } from "@/lib/site-meta";
import { ago, calendarDay, list, marketLocale, price } from "@/lib/homes-format";
import { AvailabilityBadge } from "@/components/homes/Availability";
import { AskPanel } from "@/components/homes/AskPanel";
import { CompareToggle } from "@/components/homes/CompareToggle";
import { CompareTray } from "@/components/homes/CompareTray";

type Params = { params: Promise<{ locale: string; projectId: string }>; searchParams: Promise<{ unit?: string }> };

const load = (id: string) => getPublicProject(getDb(), id).catch((e) => {
  if (e instanceof IdentityError && e.code === "not_found") notFound();
  throw e;
});

export async function generateMetadata({ params }: Params) {
  const { locale: l, projectId } = await params;
  const locale = requireLocale(l);
  const dict = await getDictionary(locale);
  const p = await load(projectId);
  return siteMeta({ locale, path: `/homes/projects/${p.id}`, title: `${p.name} · ${dict.brand.name}`, description: list([p.location, p.city], locale), brand: dict.brand.name });
}

export default async function ProjectListingPage({ params, searchParams }: Params) {
  const { locale: l, projectId } = await params;
  const { unit } = await searchParams;
  const locale = requireLocale(l);
  const dict = await getDictionary(locale);
  const t = dict.cx;
  const [p, markets, loc] = await Promise.all([load(projectId), listPublicMarkets(getDb()), getPublicLocation(getDb(), projectId)]);
  const nl = marketLocale(locale, markets, p.market);
  const back = `/${locale}/homes/projects/${p.id}`;
  const trig = t.project.triggers;

  return (
    <main id="main" className="bg-night pb-24 text-sand">
      <header className="border-b border-hairline bg-[radial-gradient(ellipse_at_top,rgba(201,162,74,0.12),transparent_65%)]">
        <div className="mx-auto max-w-7xl px-4 pb-12 pt-32 sm:px-8 md:pt-40">
          <Link href={`/${locale}/homes`} className="inline-flex items-center gap-1.5 text-sm text-mist hover:text-sand"><ArrowLeft aria-hidden="true" className="size-4 rtl:-scale-x-100" />{t.project.back}</Link>
          <p className="mt-6 flex items-center gap-1.5 text-xs tracking-[0.14em] text-gold uppercase"><Buildings aria-hidden="true" className="size-4" />{t.projectStatuses[p.status as keyof typeof t.projectStatuses] ?? p.status}</p>
          <h1 className="mt-3 font-display text-5xl leading-[1.02] sm:text-6xl">{p.name}</h1>
          <p className="mt-4 flex items-center gap-1.5 text-lg text-mist"><MapPin aria-hidden="true" className="size-5" />{list([p.location, p.city], locale)}</p>
          <dl className="mt-8 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-sm text-mist">{t.project.facts.developer}</dt><dd className="mt-1">{p.ownerName}</dd></div>
            <div><dt className="text-sm text-mist">{t.project.facts.types}</dt><dd className="mt-1">{p.propertyTypes.map((x) => t.propertyTypes[x as keyof typeof t.propertyTypes] ?? x).join(locale === "ar" ? "، " : ", ")}</dd></div>
            <div>
              <dt className="text-sm text-mist">{t.project.facts.handover}</dt>
              <dd className="mt-1 flex items-center gap-1.5">{p.handoverDate ? <><CalendarBlank aria-hidden="true" className="size-4 text-mist" />{calendarDay(p.handoverDate, nl)}</> : "—"}</dd>
              {p.handoverDate && p.status !== "completed" && <dd className="mt-0.5 text-xs text-mist">{t.project.handoverEstimate}</dd>}
            </div>
            <div><dt className="text-sm text-mist">{t.project.facts.updated}</dt><dd className="mt-1">{ago(p.listingUpdatedAt, locale)}</dd></div>
          </dl>
          {p.description && <p className="mt-8 max-w-[70ch] whitespace-pre-line text-sand/90">{p.description}</p>}
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-14 px-4 py-12 sm:px-8">
        <section aria-labelledby="units-title">
          <h2 id="units-title" className="font-display text-4xl">{t.project.unitsTitle}</h2>
          <p className="mt-2 max-w-[70ch] text-mist">{t.project.unitsIntro}</p>
          <p className="mt-1 text-sm text-mist">{p.showPrices ? t.project.priceNote : t.project.pricesHidden}</p>
          {p.units.length === 0 ? (
            <div className="mt-6 rounded-3xl border-2 border-dashed border-hairline px-6 py-10 text-center">
              <p className="text-sand">{t.project.noUnits}</p>
              <a href="#ask" className="mt-4 inline-block rounded-full bg-gold px-5 py-2.5 text-sm font-medium text-night hover:bg-gold-light">{t.ask.title}</a>
            </div>
          ) : (
            <div className="mt-6 overflow-x-auto rounded-3xl border border-hairline">
              <table className="w-full min-w-[56rem] text-sm">
                <thead className="bg-night-2 text-mist">
                  <tr>
                    {(["unit", "type", "beds", "area", "price", "availability", "compare"] as const).map((c) => <th key={c} scope="col" className="px-4 py-3 text-start font-medium">{t.project.columns[c]}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {p.units.map((u) => (
                    <tr key={u.id} className={unit === u.id ? "bg-gold/5" : undefined}>
                      <th scope="row" className="px-4 py-4 text-start align-top font-medium">
                        <span className="flex items-center gap-1.5">{u.code}{u.verified && <SealCheck aria-label={t.project.verified} weight="fill" className="size-4 text-mangrove" />}</span>
                        {u.phaseName && <span className="block text-xs font-normal text-mist">{u.phaseName}{u.floor != null ? ` · ${t.project.columns.floor} ${u.floor}` : ""}</span>}
                        <Link href={`${back}?unit=${u.id}#ask`} className="mt-1 block text-xs font-normal text-gold-light underline-offset-4 hover:underline">{t.ask.title}</Link>
                      </th>
                      <td className="px-4 py-4 align-top">{t.propertyTypes[u.propertyType as keyof typeof t.propertyTypes] ?? u.propertyType}</td>
                      <td className="px-4 py-4 align-top">{u.bedrooms === 0 ? t.studio : u.bedrooms ?? "—"}</td>
                      <td className="px-4 py-4 align-top">{u.areaSqm ? format(t.sqm, { n: Number(u.areaSqm).toLocaleString(nl) }) : "—"}</td>
                      <td className="px-4 py-4 align-top">
                        {u.price ? <><span className="text-gold-light">{price(u.price.minor, u.price.currency, nl)}</span><span className="block text-xs text-mist">{calendarDay(u.price.effectiveFrom, nl)}</span></> : <span className="text-mist">{t.project.noPrice}</span>}
                      </td>
                      <td className="px-4 py-4 align-top">
                        <AvailabilityBadge a={u.availability} dict={dict} locale={locale} />
                        <span className="mt-1 block text-xs text-mist">{t.sources[u.sourceKind]} · {ago(u.lastUpdatedAt, locale)}</span>
                      </td>
                      <td className="px-4 py-4 align-top"><CompareToggle refId={`unit:${u.id}`} label={t.compare.add} addedLabel={t.compare.added} fullLabel={format(t.compare.full, { max: 4 })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {p.showPaymentPlans && (
          <section aria-labelledby="plans-title">
            <h2 id="plans-title" className="font-display text-4xl">{t.project.plansTitle}</h2>
            <p className="mt-2 max-w-[70ch] text-mist">{t.project.plansIntro}</p>
            {p.plans.length === 0 ? <p className="mt-6 text-mist">{t.project.noPlans}</p> : (
              <ul className="mt-6 grid gap-5 md:grid-cols-2">
                {p.plans.map((pl) => (
                  <li key={pl.id} className="rounded-3xl border border-hairline bg-night-2 p-6">
                    <h3 className="font-display text-2xl">{pl.name}</h3>
                    <p className="mt-1 text-xs text-mist">{calendarDay(pl.effectiveFrom, nl)}{pl.effectiveTo ? ` – ${calendarDay(pl.effectiveTo, nl)}` : ""} · {pl.currency}</p>
                    <ol className="mt-4 space-y-2 text-sm">
                      {pl.milestones.map((m) => (
                        <li key={m.seq} className="flex justify-between gap-4 border-b border-hairline pb-2">
                          <span>
                            {m.label}
                            <span className="block text-xs text-mist">
                              {m.trigger === "on_date" ? format(trig.on_date, { date: calendarDay(m.dueDate, nl) }) : m.trigger === "construction_progress" ? format(trig.construction_progress, { pct: Number(m.progressPercent) }) : m.trigger === "after_handover" ? format(trig.after_handover, { n: m.monthsAfterHandover ?? "" }) : trig[m.trigger as "on_booking" | "on_handover"]}
                            </span>
                          </span>
                          <span className="shrink-0 tabular-nums text-gold-light">{m.percent ? `${Number(m.percent)}%` : m.amountMinor ? price(m.amountMinor, pl.currency, nl) : ""}</span>
                        </li>
                      ))}
                    </ol>
                    {pl.handoverTerms && <p className="mt-4 text-sm text-mist"><span className="text-sand/90">{t.project.handoverTerms}: </span>{pl.handoverTerms}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {loc && (
          <section aria-labelledby="location-title" className="space-y-4">
            <h2 id="location-title" className="font-display text-4xl">{dict.loc.publicTitle}</h2>
            <p className="max-w-[70ch] text-mist">{dict.loc.publicIntro}</p>
            <LocationPanel dict={dict} locale={locale} intlLocale={nl} projectName={p.name} city={p.city}
              marketName={markets.find((m) => m.code === p.market)?.name[locale] ?? p.market}
              location={loc.address || loc.area || loc.coordinates ? loc : null}
              places={loc.places.map((x) => ({ ...x, kind: x.kind as PlaceKind }))} totalPlaces={loc.places.length}
              hiddenWithoutDistance={0} mode="public" />
          </section>
        )}

        <AskPanel dict={dict} locale={locale} listing={{ kind: "project", id: p.id }} units={p.units.map((u) => ({ id: u.id, label: u.code }))} preselectUnit={unit && p.units.some((u) => u.id === unit) ? unit : undefined} back={back} />
      </div>
      <CompareTray locale={locale} t={t.compare} />
    </main>
  );
}
