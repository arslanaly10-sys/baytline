import Link from "next/link";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import { IdentityError } from "@baytline/identity";
import { listPublicMarkets, PUBLIC_PROPERTY_TYPES, searchListings, type SearchFilters, type SearchResult } from "@baytline/marketplace";
import { getDictionary } from "@/i18n";
import { format } from "@/i18n/format";
import { requireLocale } from "@/server/guards";
import { getDb } from "@/server/db";
import { siteMeta } from "@/lib/site-meta";
import { ProjectCard, RentalCard } from "@/components/homes/Cards";
import { CompareTray } from "@/components/homes/CompareTray";
import { SiteField, SiteSelect } from "@/components/homes/fields";

type Params = { params: Promise<{ locale: string }>; searchParams: Promise<SearchFilters> };

export async function generateMetadata({ params }: Params) {
  const locale = requireLocale((await params).locale);
  const dict = await getDictionary(locale);
  return siteMeta({ locale, path: "/homes", title: `${dict.cx.search.title} · ${dict.brand.name}`, description: dict.cx.search.intro, brand: dict.brand.name });
}

export default async function HomesPage({ params, searchParams }: Params) {
  const locale = requireLocale((await params).locale);
  const q = await searchParams;
  const dict = await getDictionary(locale);
  const t = dict.cx.search;
  const purpose = q.purpose === "rent" ? "rent" : "buy";
  const markets = await listPublicMarkets(getDb());
  let result: SearchResult | null = null;
  let inputError: string | null = null;
  try {
    result = await searchListings(getDb(), { ...q, purpose });
  } catch (e) {
    if (!(e instanceof IdentityError && e.code === "invalid_input")) throw e;
    inputError = dict.cx.errors[(e.detail ?? "generic") as keyof typeof dict.cx.errors] ?? dict.cx.errors.generic;
  }
  const filtered = Boolean(q.market || q.q || q.type || q.minBedrooms || q.minPrice || q.maxPrice || q.availability);
  const base = `/${locale}/homes`;
  const count = result ? (result.purpose === "buy" ? result.projects.length : result.rentals.length) : 0;
  const currency = markets.find((m) => m.code === q.market)?.currency;

  return (
    <main id="main" className="bg-night pb-24 text-sand">
      <header className="border-b border-hairline bg-[radial-gradient(ellipse_at_top,rgba(201,162,74,0.12),transparent_65%)]">
        <div className="mx-auto max-w-7xl px-4 pb-10 pt-32 sm:px-8 md:pt-40">
          <h1 className="font-display text-5xl leading-[1.02] sm:text-6xl">{t.title}</h1>
          <p className="mt-4 max-w-[62ch] text-lg text-mist">{t.intro}</p>
          <nav aria-label={t.purposeLabel} className="mt-8 inline-flex rounded-full border border-hairline p-1">
            {(["buy", "rent"] as const).map((p) => (
              <Link key={p} href={`${base}?purpose=${p}`} aria-current={purpose === p ? "page" : undefined}
                className={`rounded-full px-5 py-2 text-sm ${purpose === p ? "bg-gold font-medium text-night" : "text-sand hover:text-gold-light"}`}>{t.purpose[p]}</Link>
            ))}
          </nav>
          <form method="get" role="search" className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <input type="hidden" name="purpose" value={purpose} />
            <SiteSelect label={t.fields.market} name="market" defaultValue={q.market ?? ""} options={[{ value: "", label: t.anyMarket }, ...markets.map((m) => ({ value: m.code, label: m.name[locale] }))]} />
            <SiteField label={t.fields.q} name="q" type="search" defaultValue={q.q ?? ""} maxLength={100} />
            <SiteSelect label={t.fields.type} name="type" defaultValue={q.type ?? ""} options={[{ value: "", label: t.any }, ...PUBLIC_PROPERTY_TYPES.map((x) => ({ value: x, label: dict.cx.propertyTypes[x] }))]} />
            <SiteSelect label={t.fields.bedrooms} name="minBedrooms" defaultValue={q.minBedrooms ?? ""} options={[{ value: "", label: t.any }, { value: "0", label: dict.cx.studio }, ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n}+` }))]} />
            <SiteField label={`${t.fields.minPrice}${currency ? ` (${currency})` : ""}`} name="minPrice" inputMode="decimal" defaultValue={q.minPrice ?? ""} />
            <SiteField label={`${t.fields.maxPrice}${currency ? ` (${currency})` : ""}`} name="maxPrice" inputMode="decimal" defaultValue={q.maxPrice ?? ""} />
            <SiteSelect label={t.fields.availability} name="availability" defaultValue={q.availability ?? ""} options={[{ value: "", label: t.availabilityAny }, { value: "confirmed", label: t.availabilityConfirmed }]} />
            <div className="flex items-end gap-3">
              <button type="submit" className="inline-flex items-center gap-2 rounded-full bg-gold px-5 py-2.5 text-sm font-medium text-night hover:bg-gold-light"><MagnifyingGlass aria-hidden="true" weight="bold" className="size-4" />{t.submit}</button>
              {filtered && <Link href={`${base}?purpose=${purpose}`} className="py-2.5 text-sm text-mist underline underline-offset-4 hover:text-sand">{t.clear}</Link>}
            </div>
          </form>
          <div aria-live="polite" className="mt-4 space-y-2 text-sm">
            {inputError && <p role="alert" className="rounded-xl border-s-4 border-coral bg-panel px-3 py-2">{inputError}</p>}
            {result?.priceFilter === "needs_market" && <p className="text-saffron">{t.priceNeedsMarket}</p>}
            {purpose === "rent" && result?.priceFilter === "applied" && <p className="text-mist">{t.rentPriceNote}</p>}
          </div>
        </div>
      </header>

      <section aria-label={t.title} className="mx-auto max-w-7xl px-4 py-10 sm:px-8">
        {result && <p className="text-sm text-mist" aria-live="polite">{format(purpose === "buy" ? t.projects : t.rentals, { n: count })}</p>}
        {result && count === 0 ? (
          <div className="mt-6 rounded-3xl border-2 border-dashed border-hairline px-6 py-14 text-center">
            <p className="text-lg text-sand">{filtered ? t.noMatches : t.noListings}</p>
            {filtered && <p className="mt-2 text-mist">{t.tryBroader}</p>}
            {filtered && <Link href={`${base}?purpose=${purpose}`} className="mt-5 inline-block rounded-full border border-sand/30 px-5 py-2.5 text-sm hover:border-gold-light">{t.clear}</Link>}
          </div>
        ) : result ? (
          <ul className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {result.purpose === "buy"
              ? result.projects.map((p) => <li key={p.id}><ProjectCard p={p} dict={dict} locale={locale} markets={markets} /></li>)
              : result.rentals.map((r) => <li key={r.id}><RentalCard r={r} dict={dict} locale={locale} markets={markets} /></li>)}
          </ul>
        ) : null}
      </section>
      <CompareTray locale={locale} t={dict.cx.compare} />
    </main>
  );
}
