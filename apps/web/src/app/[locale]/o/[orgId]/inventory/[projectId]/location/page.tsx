import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocationProfile } from "@baytline/developer";
import { IdentityError } from "@baytline/identity";
import { cxSection } from "@/server/cx-page";
import { getDb } from "@/server/db";
import { findMarket, formattingLocale, getMarketsConfig } from "@/server/markets";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { LocationPanel } from "@/components/location/LocationPanel";

/** A brokerage's read-only view of a shared project's location, only when the share includes it. */
export default async function PartnerLocationPage({ params, searchParams }: { params: Promise<{ locale: string; orgId: string; projectId: string }>; searchParams: Promise<{ kind?: string; category?: string; maxDistance?: string }> }) {
  const { locale, orgId, projectId } = await params;
  const filters = await searchParams;
  const { page, allowed, section, actor, base, orgType } = await cxSection(locale, orgId, "inventory");
  if (orgType !== "brokerage") notFound();
  if (!allowed) return <SectionShell page={page} section={section} allowed={false} />;
  const profile = await getLocationProfile(getDb(), actor, projectId, filters).catch((e) => {
    if (e instanceof IdentityError && (e.code === "not_found" || e.code === "forbidden")) notFound();
    throw e;
  });
  const market = findMarket(await getMarketsConfig(), profile.project.market);
  return (
    <div className="space-y-8">
      <p><Link href={`${base}/inventory`} className="text-sm text-gulf-strong underline underline-offset-4">{page.dict.workspaces.brokerage.sections.inventory.label}</Link></p>
      <SectionHeader eyebrow={profile.project.city} title={profile.project.name} intro={page.dict.loc.intro} />
      <LocationPanel dict={page.dict} locale={page.locale} intlLocale={formattingLocale(page.locale, market)} projectName={profile.project.name} city={profile.project.city}
        marketName={market?.name[page.locale] ?? profile.project.market} location={profile.location} places={profile.places} totalPlaces={profile.totalPlaces}
        hiddenWithoutDistance={profile.hiddenWithoutDistance} mode="partner" filterPath={`${base}/inventory/${projectId}/location`} filters={filters} />
    </div>
  );
}
