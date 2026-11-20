import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, House, MapPin } from "@phosphor-icons/react/dist/ssr";
import { IdentityError } from "@baytline/identity";
import { getPublicRental, listPublicMarkets } from "@baytline/marketplace";
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

type Params = { params: Promise<{ locale: string; unitId: string }> };

const load = (id: string) => getPublicRental(getDb(), id).catch((e) => {
  if (e instanceof IdentityError && e.code === "not_found") notFound();
  throw e;
});

export async function generateMetadata({ params }: Params) {
  const { locale: l, unitId } = await params;
  const locale = requireLocale(l);
  const dict = await getDictionary(locale);
  const r = await load(unitId);
  return siteMeta({ locale, path: `/homes/rentals/${r.id}`, title: `${r.propertyName} · ${dict.brand.name}`, description: list([r.areaLabel, r.city], locale), brand: dict.brand.name });
}

export default async function RentalListingPage({ params }: Params) {
  const { locale: l, unitId } = await params;
  const locale = requireLocale(l);
  const dict = await getDictionary(locale);
  const t = dict.cx;
  const [r, markets] = await Promise.all([load(unitId), listPublicMarkets(getDb())]);
  const nl = marketLocale(locale, markets, r.market);
  const f = t.rental.facts;
  return (
    <main id="main" className="bg-night pb-24 text-sand">
      <header className="border-b border-hairline bg-[radial-gradient(ellipse_at_top,rgba(201,162,74,0.12),transparent_65%)]">
        <div className="mx-auto max-w-7xl px-4 pb-12 pt-32 sm:px-8 md:pt-40">
          <Link href={`/${locale}/homes?purpose=rent`} className="inline-flex items-center gap-1.5 text-sm text-mist hover:text-sand"><ArrowLeft aria-hidden="true" className="size-4 rtl:-scale-x-100" />{t.project.back}</Link>
          <p className="mt-6 flex items-center gap-1.5 text-xs tracking-[0.14em] text-gold uppercase"><House aria-hidden="true" className="size-4" />{t.propertyTypes[r.unitType as keyof typeof t.propertyTypes] ?? r.unitType}</p>
          <h1 className="mt-3 font-display text-5xl leading-[1.02] sm:text-6xl">{r.propertyName}</h1>
          <p className="mt-4 flex items-center gap-1.5 text-lg text-mist"><MapPin aria-hidden="true" className="size-5" />{list([r.areaLabel, r.city], locale)}</p>
          <div className="mt-8 flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="font-display text-4xl text-gold-light">{price(r.rent.minor, r.rent.currency, nl)} <span className="font-sans text-base text-mist">{t.frequencies[r.rent.frequency as keyof typeof t.frequencies]}</span></p>
              <p className="mt-1 text-sm text-mist">{t.rental.rentNote}</p>
            </div>
            <div className="flex flex-col items-start gap-3">
              <AvailabilityBadge a={r.availability} dict={dict} locale={locale} />
              {r.noticeGiven && <p className="text-sm text-saffron">{t.availability.noticeGiven}</p>}
              <CompareToggle refId={`rental:${r.id}`} label={t.compare.add} addedLabel={t.compare.added} fullLabel={format(t.compare.full, { max: 4 })} />
            </div>
          </div>
          <dl className="mt-10 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-sm text-mist">{f.beds}</dt><dd className="mt-1">{r.bedrooms === 0 ? t.studio : r.bedrooms ?? "—"}</dd></div>
            <div><dt className="text-sm text-mist">{f.area}</dt><dd className="mt-1">{r.areaSqm ? format(t.sqm, { n: Number(r.areaSqm).toLocaleString(nl) }) : "—"}</dd></div>
            <div><dt className="text-sm text-mist">{f.floor}</dt><dd className="mt-1">{r.floor ?? "—"}</dd></div>
            <div><dt className="text-sm text-mist">{f.availableFrom}</dt><dd className="mt-1">{r.availableFrom ? calendarDay(r.availableFrom, nl) : t.rental.now}</dd></div>
            <div><dt className="text-sm text-mist">{f.manager}</dt><dd className="mt-1">{r.ownerName}</dd></div>
            <div><dt className="text-sm text-mist">{f.updated}</dt><dd className="mt-1">{ago(r.lastUpdatedAt, locale)}</dd></div>
          </dl>
          {r.description && <p className="mt-8 max-w-[70ch] whitespace-pre-line text-sand/90">{r.description}</p>}
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-8">
        <AskPanel dict={dict} locale={locale} listing={{ kind: "rental", id: r.id }} back={`/${locale}/homes/rentals/${r.id}`} />
      </div>
      <CompareTray locale={locale} t={t.compare} />
    </main>
  );
}
