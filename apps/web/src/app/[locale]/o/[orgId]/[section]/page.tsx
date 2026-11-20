import { checkSection, loadOrgPage } from "@/server/guards";
import { SectionShell } from "@/components/ui/SectionShell";

/** Sections that aren't built yet. Built ones have their own routes. */
export default async function SectionPage({ params }: { params: Promise<{ locale: string; orgId: string; section: string }> }) {
  const { locale, orgId, section } = await params;
  const page = await loadOrgPage(locale, orgId);
  const access = await checkSection(page, section);
  return <SectionShell page={page} section={access.section} allowed={access.allowed} />;
}
