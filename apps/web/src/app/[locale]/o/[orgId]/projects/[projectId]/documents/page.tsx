import { listDocuments } from "@baytline/developer";
import { actorOf, projectSection } from "@/server/dev-page";
import { getDb } from "@/server/db";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ProjectFrame } from "@/components/dev/parts";
import { DocumentsPanel } from "@/components/dev/DocumentsPanel";

export default async function ProjectDocuments({ params }: { params: Promise<{ locale: string; orgId: string; projectId: string }> }) {
  const { locale, orgId, projectId } = await params;
  const { page, project, allowed, can, marketLocale } = await projectSection(locale, orgId, projectId, "document.view");
  if (!allowed) return <AccessDenied dict={page.dict} orgName={page.ctx.org.name} />;
  const docs = await listDocuments(getDb(), actorOf(page), { projectId });
  return (
    <ProjectFrame dict={page.dict} base={`/${locale}/o/${orgId}`} project={project} can={can}>
      <DocumentsPanel dict={page.dict} locale={marketLocale} orgId={orgId} docs={docs} canManage={can("document.manage")} project={{ id: projectId }} />
    </ProjectFrame>
  );
}
