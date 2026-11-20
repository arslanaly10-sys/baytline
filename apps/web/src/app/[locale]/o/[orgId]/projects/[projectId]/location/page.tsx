import { getLocationProfile } from "@baytline/developer";
import { actorOf, projectSection } from "@/server/dev-page";
import { getDb } from "@/server/db";
import { findMarket, formattingLocale, getMarketsConfig } from "@/server/markets";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ProjectFrame } from "@/components/dev/parts";
import { LocationPanel } from "@/components/location/LocationPanel";

type Search = { kind?: string; category?: string; maxDistance?: string };

export default async function ProjectLocationPage({ params, searchParams }: { params: Promise<{ locale: string; orgId: string; projectId: string }>; searchParams: Promise<Search> }) {
  const { locale, orgId, projectId } = await params;
  const filters = await searchParams;
  const { page, project, allowed, can } = await projectSection(locale, orgId, projectId, "area_profile.view");
  if (!allowed) return <AccessDenied dict={page.dict} orgName={page.ctx.org.name} />;
  const [profile, markets] = await Promise.all([getLocationProfile(getDb(), actorOf(page), projectId, filters), getMarketsConfig()]);
  const market = findMarket(markets, project.market);
  const base = `/${page.locale}/o/${orgId}/projects/${projectId}`;
  return (
    <ProjectFrame dict={page.dict} base={`/${locale}/o/${orgId}`} project={project} can={can}>
      <p className="max-w-[75ch] text-sm text-ink-muted">{page.dict.loc.intro}</p>
      <LocationPanel
        dict={page.dict} locale={page.locale} intlLocale={formattingLocale(page.locale, market)} projectName={project.name} city={project.city}
        marketName={market?.name[page.locale] ?? project.market} location={profile.location} places={profile.places} totalPlaces={profile.totalPlaces}
        hiddenWithoutDistance={profile.hiddenWithoutDistance} mode="owner" canManage={profile.canManage && !project.isSample} canVerify={profile.canVerify && !project.isSample}
        filterPath={`${base}/location`} filters={filters} hidden={{ locale: page.locale, orgId, projectId }}
        sharing={{ partners: profile.sharedWithPartners ?? 0, publicOn: profile.shownPublicly ?? false, sharesHref: `${base}/partners`, publicHref: `${base}/listing` }}
      />
    </ProjectFrame>
  );
}
