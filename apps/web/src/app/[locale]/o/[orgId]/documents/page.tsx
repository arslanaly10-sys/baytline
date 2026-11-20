import { hasCapability } from "@baytline/core";
import { listDocuments, listProjects } from "@baytline/developer";
import { actorOf, devSection } from "@/server/dev-page";
import { getDb } from "@/server/db";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { DocumentsPanel } from "@/components/dev/DocumentsPanel";

export default async function DocumentsPage({ params }: { params: Promise<{ locale: string; orgId: string }> }) {
  const { locale, orgId } = await params;
  const { page, allowed, section, isDeveloper } = await devSection(locale, orgId, "documents");
  if (!allowed || !isDeveloper) return <SectionShell page={page} section={section} allowed={allowed} />;
  const [docs, projects] = await Promise.all([listDocuments(getDb(), actorOf(page)), listProjects(getDb(), actorOf(page))]);
  return (
    <div className="space-y-8">
      <SectionHeader eyebrow={page.ctx.org.name} title={page.dict.workspaces.developer.sections.documents.label} />
      <DocumentsPanel dict={page.dict} locale={locale} orgId={orgId} docs={docs} canManage={hasCapability(page.ctx.principal, "document.manage")}
        project={{ choices: projects.map((p) => ({ id: p.id, name: p.name })) }} showProject />
    </div>
  );
}
