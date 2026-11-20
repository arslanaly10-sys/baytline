import { workspaceForOrgType } from "@baytline/core";
import { getMarketsConfig, timeZoneOf } from "@/server/markets";
import { getTeam } from "@baytline/identity";
import { checkSection, loadOrgPage } from "@/server/guards";
import { getDb } from "@/server/db";
import { sectionDescription, sectionLabel } from "@/lib/sections";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { TeamPanel } from "@/components/team/TeamPanel";

export default async function TeamPage({ params }: { params: Promise<{ locale: string; orgId: string }> }) {
  const { locale, orgId } = await params;
  const page = await loadOrgPage(locale, orgId);
  const { allowed } = await checkSection(page, "team");
  const ws = page.dict.workspaces[workspaceForOrgType(page.ctx.org.type).id];
  const header = <SectionHeader eyebrow={page.ctx.org.name} title={sectionLabel(ws, "team")} intro={sectionDescription(ws, "team")} />;
  if (!allowed) return <div className="space-y-10">{header}<AccessDenied dict={page.dict} orgName={page.ctx.org.name} /></div>;

  const team = await getTeam(getDb(), { userId: page.session.user.id, orgId });
  const timeZone = timeZoneOf(await getMarketsConfig(), page.ctx.org.market);
  return (
    <div className="space-y-10">
      {header}
      <TeamPanel dict={page.dict} locale={page.locale} team={team} actorOrgId={orgId} targetOrgName={page.ctx.org.name} timeZone={timeZone} />
    </div>
  );
}
