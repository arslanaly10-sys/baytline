import { brokerageDirectory, listShares } from "@baytline/developer";
import { actorOf, projectSection } from "@/server/dev-page";
import { getDb } from "@/server/db";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ProjectFrame } from "@/components/dev/parts";
import { SharesPanel } from "@/components/dev/SharesPanel";

export default async function ProjectPartners({ params }: { params: Promise<{ locale: string; orgId: string; projectId: string }> }) {
  const { locale, orgId, projectId } = await params;
  const { page, project, allowed, can, marketLocale } = await projectSection(locale, orgId, projectId, "partner.view");
  if (!allowed) return <AccessDenied dict={page.dict} orgName={page.ctx.org.name} />;
  const [{ shares, canManage }, brokerages] = await Promise.all([listShares(getDb(), actorOf(page), { projectId }), brokerageDirectory(getDb(), actorOf(page))]);
  return (
    <ProjectFrame dict={page.dict} base={`/${locale}/o/${orgId}`} project={project} can={can}>
      <SharesPanel dict={page.dict} locale={marketLocale} orgId={orgId} shares={shares} canManage={canManage} brokerages={brokerages}
        projects={project.isSample ? [] : [{ id: project.id, name: project.name }]} groupBy="brokerage" />
    </ProjectFrame>
  );
}
