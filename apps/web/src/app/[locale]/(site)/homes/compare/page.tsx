import Link from "next/link";
import { Fragment } from "react";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import { compareListings, listPublicMarkets, parseCompareRefs, type CompareItem, type Fact } from "@baytline/marketplace";
import { getDictionary } from "@/i18n";
import { format } from "@/i18n/format";
import { requireLocale } from "@/server/guards";
import { getDb } from "@/server/db";
import { siteMeta } from "@/lib/site-meta";
import { ago, calendarDay, marketLocale, price } from "@/lib/homes-format";
import { AvailabilityBadge } from "@/components/homes/Availability";
import { CompareToggle } from "@/components/homes/CompareToggle";

type Params = { params: Promise<{ locale: string }>; searchParams: Promise<{ items?: string }> };

export async function generateMetadata({ params }: Params) {
  const locale = requireLocale((await params).locale);
  const dict = await getDictionary(locale);
  return siteMeta({ locale, path: "/homes/compare", title: `${dict.cx.compare.title} · ${dict.brand.name}`, description: dict.cx.compare.intro, brand: dict.brand.name, noindex: true });
}

const BASIS_TONE = { confirmed: "text-mangrove", owner_reported: "text-sand/80", estimate: "text-saffron", missing: "text-mist" } as const;

export default async function ComparePage({ params, searchParams }: Params) {
  const locale = requireLocale((await params).locale);
  const dict = await getDictionary(locale);
  const t = dict.cx;
  const refs = parseCompareRefs((await searchParams).items);
  const [items, markets] = await Promise.all([compareListings(getDb(), refs), listPublicMarkets(getDb())]);
  const dropped = refs.length - items.length;

  const cell = <T,>(it: CompareItem, f: Fact<T>, show: (v: T) => React.ReactNode) => (
    <td className="px-4 py-4 align-top">
      {f.value !== null ? <span className="block">{show(f.value)}</span> : <span className="block text-mist">—</span>}
      <span className={`mt-1 block text-xs ${BASIS_TONE[f.basis]}`}>{t.compare.basis[f.basis]}</span>
    </td>
  );
  const nl = (it: CompareItem) => marketLocale(locale, markets, it.market);
  const rows: [string, (it: CompareItem) => React.ReactNode][] = [
    [t.compare.rows.price, (it) => cell(it, it.price, (v) => <span className="text-gold-light">{price(v.minor, v.currency, nl(it))}{v.frequency ? ` ${t.frequencies[v.frequency as keyof typeof t.frequencies]}` : ""}</span>)],
    [t.compare.rows.location, (it) => cell(it, it.location, (v) => v)],
    [t.compare.rows.type, (it) => cell(it, it.propertyType, (v) => t.propertyTypes[v as keyof typeof t.propertyTypes] ?? v)],
    [t.compare.rows.area, (it) => cell(it, it.areaSqm, (v) => format(t.sqm, { n: Number(v).toLocaleString(nl(it)) }))],
    [t.compare.rows.beds, (it) => cell(it, it.bedrooms, (v) => (v === 0 ? t.studio : v))],
    [t.compare.rows.handover, (it) => cell(it, it.handover, (v) => (v.completed ? t.compare.completed : calendarDay(v.date, nl(it))))],
    [t.compare.rows.lease, (it) => cell(it, it.lease, (v) => format(t.compare.leaseValue, { frequency: t.frequencies[v.frequency as keyof typeof t.frequencies], from: v.availableFrom ? format(t.compare.leaseFrom, { date: calendarDay(v.availableFrom, nl(it)) }) : "" }))],
    [t.compare.rows.plans, (it) => cell(it, it.paymentPlans, (v) => <>{format(t.compare.plansValue, { n: v.length })}<span className="block text-xs text-mist">{v.map((p) => p.name).join(", ")}</span></>)],
    [t.compare.rows.availability, (it) => <td className="px-4 py-4 align-top"><AvailabilityBadge a={it.availability} dict={dict} locale={locale} /></td>],
    [t.compare.rows.owner, (it) => <td className="px-4 py-4 align-top">{it.ownerName}</td>],
    [t.compare.rows.updated, (it) => <td className="px-4 py-4 align-top text-mist">{ago(it.lastUpdatedAt, locale)}</td>],
  ];

  return (
    <main id="main" className="bg-night pb-24 text-sand">
      <div className="mx-auto max-w-7xl px-4 pb-12 pt-32 sm:px-8 md:pt-40">
        <Link href={`/${locale}/homes`} className="inline-flex items-center gap-1.5 text-sm text-mist hover:text-sand"><ArrowLeft aria-hidden="true" className="size-4 rtl:-scale-x-100" />{t.project.back}</Link>
        <h1 className="mt-6 font-display text-5xl leading-[1.02] sm:text-6xl">{t.compare.title}</h1>
        <p className="mt-4 max-w-[70ch] text-lg text-mist">{t.compare.intro}</p>
        {dropped > 0 && <p role="status" className="mt-4 text-saffron">{format(t.compare.dropped, { n: dropped })}</p>}
        {items.length === 0 ? (
          <div className="mt-10 rounded-3xl border-2 border-dashed border-hairline px-6 py-14 text-center">
            <p className="text-lg">{t.compare.empty}</p>
            <Link href={`/${locale}/homes`} className="mt-5 inline-block rounded-full bg-gold px-5 py-2.5 text-sm font-medium text-night hover:bg-gold-light">{t.navHomes}</Link>
          </div>
        ) : (
          <>
            <div className="mt-10 overflow-x-auto rounded-3xl border border-hairline">
              <table className="w-full text-sm" style={{ minWidth: `${12 + items.length * 14}rem` }}>
                <thead className="bg-night-2">
                  <tr>
                    <td className="w-44 px-4 py-4" />
                    {items.map((it) => (
                      <th key={it.ref} scope="col" className="px-4 py-4 text-start align-top">
                        <Link href={it.href.kind === "unit" ? `/${locale}/homes/projects/${it.href.projectId}?unit=${it.href.unitId}` : `/${locale}/homes/rentals/${it.href.id}`} className="font-display text-xl text-sand underline-offset-4 hover:underline">{it.title}</Link>
                        <div className="mt-2"><CompareToggle refId={it.ref} label={t.compare.add} addedLabel={t.compare.remove} fullLabel={format(t.compare.full, { max: 4 })} /></div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {rows.map(([label, render]) => (
                    <tr key={label}>
                      <th scope="row" className="px-4 py-4 text-start align-top font-medium text-mist">{label}</th>
                      {items.map((it) => <Fragment key={it.ref}>{render(it)}</Fragment>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 max-w-[80ch] text-xs text-mist">{t.compare.legend}</p>
          </>
        )}
      </div>
    </main>
  );
}
