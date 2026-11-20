import Link from "next/link";
import { Bed, Buildings, CalendarBlank, CheckCircle, House, MapPin, Ruler } from "@phosphor-icons/react/dist/ssr";
import type { UiLocale } from "@baytline/core";
import type { PublicMarket, PublicProjectCard, PublicRental } from "@baytline/marketplace";
import type { Dictionary } from "@/i18n";
import { format } from "@/i18n/format";
import { ago, calendarDay, list, marketLocale, price } from "@/lib/homes-format";
import { AvailabilityBadge } from "./Availability";
import { CompareToggle } from "./CompareToggle";

const card = "group relative flex h-full flex-col rounded-3xl border border-hairline bg-night-2 p-6 transition-colors duration-150 hover:border-gold/50";

export function ProjectCard({ p, dict, locale, markets }: { p: PublicProjectCard; dict: Dictionary; locale: UiLocale; markets: PublicMarket[] }) {
  const t = dict.cx;
  const nl = marketLocale(locale, markets, p.market);
  return (
    <article className={card}>
      <p className="flex items-center gap-1.5 text-xs tracking-[0.14em] text-gold uppercase"><Buildings aria-hidden="true" className="size-4" />{t.projectStatuses[p.status as keyof typeof t.projectStatuses] ?? p.status}</p>
      <h2 className="mt-3 font-display text-3xl leading-tight text-sand">
        <Link href={`/${locale}/homes/projects/${p.id}`} className="after:absolute after:inset-0 focus-visible:outline-none">{p.name}</Link>
      </h2>
      <p className="mt-2 flex items-center gap-1.5 text-sm text-mist"><MapPin aria-hidden="true" className="size-4 shrink-0" />{list([p.location, p.city], locale)}</p>
      <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div><dt className="sr-only">{t.project.columns.price}</dt><dd className="font-display text-2xl text-gold-light">{p.priceFrom ? format(t.search.from, { price: price(p.priceFrom, p.currency, nl) }) : <span className="text-base text-mist">{t.search.priceOnRequest}</span>}</dd></div>
        <div><dt className="sr-only">{t.project.columns.beds}</dt><dd className="flex items-center gap-1.5 text-sand/90"><Bed aria-hidden="true" className="size-4 text-mist" />{p.bedrooms ? (p.bedrooms.min === p.bedrooms.max ? (p.bedrooms.min === 0 ? t.studio : format(t.beds, { n: p.bedrooms.min })) : format(t.bedsRange, { min: p.bedrooms.min, max: p.bedrooms.max })) : "—"}</dd></div>
        <div className="col-span-2 text-mist">{p.propertyTypes.map((x) => t.propertyTypes[x as keyof typeof t.propertyTypes] ?? x).join(locale === "ar" ? "، " : ", ")}</div>
      </dl>
      <div className="mt-5 space-y-1.5 text-sm">
        <p className="text-sand/90">{format(t.search.unitsMatch, { n: p.matchingUnits })}</p>
        <p className={`flex items-center gap-1.5 ${p.confirmedAvailable ? "text-mangrove" : "text-mist"}`}>{p.confirmedAvailable ? <><CheckCircle aria-hidden="true" weight="bold" className="size-4" />{format(t.search.confirmedCount, { n: p.confirmedAvailable })}</> : t.search.noneConfirmed}</p>
        {p.handoverDate && <p className="flex items-center gap-1.5 text-mist"><CalendarBlank aria-hidden="true" className="size-4" />{format(t.search.handover, { date: calendarDay(p.handoverDate, nl) })}</p>}
      </div>
      <p className="mt-auto pt-5 text-xs text-mist">{format(t.listedBy, { name: p.ownerName })} · {format(t.updated, { when: ago(p.listingUpdatedAt, locale) })}</p>
    </article>
  );
}

export function RentalCard({ r, dict, locale, markets }: { r: PublicRental; dict: Dictionary; locale: UiLocale; markets: PublicMarket[] }) {
  const t = dict.cx;
  const nl = marketLocale(locale, markets, r.market);
  return (
    <article className={`${card} relative`}>
      <p className="flex items-center gap-1.5 text-xs tracking-[0.14em] text-gold uppercase"><House aria-hidden="true" className="size-4" />{t.propertyTypes[r.unitType as keyof typeof t.propertyTypes] ?? r.unitType}</p>
      <h2 className="mt-3 font-display text-3xl leading-tight text-sand">
        <Link href={`/${locale}/homes/rentals/${r.id}`} className="after:absolute after:inset-0 focus-visible:outline-none">{r.propertyName}</Link>
      </h2>
      <p className="mt-2 flex items-center gap-1.5 text-sm text-mist"><MapPin aria-hidden="true" className="size-4 shrink-0" />{list([r.areaLabel, r.city], locale)}</p>
      <p className="mt-5 font-display text-2xl text-gold-light">{price(r.rent.minor, r.rent.currency, nl)} <span className="font-sans text-sm text-mist">{t.frequencies[r.rent.frequency as keyof typeof t.frequencies]}</span></p>
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-sand/90">
        <span className="flex items-center gap-1.5"><Bed aria-hidden="true" className="size-4 text-mist" />{r.bedrooms === 0 ? t.studio : r.bedrooms != null ? format(t.beds, { n: r.bedrooms }) : "—"}</span>
        {r.areaSqm && <span className="flex items-center gap-1.5"><Ruler aria-hidden="true" className="size-4 text-mist" />{format(t.sqm, { n: Number(r.areaSqm).toLocaleString(nl) })}</span>}
      </p>
      <div className="mt-4"><AvailabilityBadge a={r.availability} dict={dict} locale={locale} /></div>
      <div className="relative z-10 mt-auto flex items-center justify-between gap-3 pt-5">
        <p className="text-xs text-mist">{format(t.listedBy, { name: r.ownerName })}</p>
        <CompareToggle refId={`rental:${r.id}`} label={t.compare.add} addedLabel={t.compare.added} fullLabel={format(t.compare.full, { max: 4 })} />
      </div>
    </article>
  );
}
