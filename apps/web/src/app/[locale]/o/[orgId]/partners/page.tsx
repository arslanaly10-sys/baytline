import { brokerageDirectory, listProjects, listShares } from "@baytline/developer";
import { actorOf, devSection } from "@/server/dev-page";
import { getDb } from "@/server/db";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { SharesPanel } from "@/components/dev/SharesPanel";

export default async function PartnersPage({ params }: { params: Promise<{ locale: string; orgId: string }> }) {
  const { locale, orgId } = await params;
  const { page, allowed, section, isDeveloper } = await devSection(locale, orgId, "partners");
  if (!allowed || !isDeveloper) return <SectionShell page={page} section={section} allowed={allowed} />;
  const a = actorOf(page);
  const [{ shares, canManage }, brokerages, projects] = await Promise.all([listShares(getDb(), a), brokerageDirectory(getDb(), a), listProjects(getDb(), a)]);
  return (
    <div className="space-y-8">
      <SectionHeader eyebrow={page.ctx.org.name} title={page.dict.workspaces.developer.sections.partners.label} />
      <SharesPanel dict={page.dict} locale={locale} orgId={orgId} shares={shares} canManage={canManage} brokerages={brokerages}
        projects={projects.filter((p) => !p.isSample).map((p) => ({ id: p.id, name: p.name }))} groupBy="brokerage" />
    </div>
  );
}
