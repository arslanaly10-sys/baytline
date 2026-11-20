import { redirect } from "next/navigation";
import { cxSection } from "@/server/cx-page";
import { SectionShell } from "@/components/ui/SectionShell";

/** Discovery lives on the public site so it works signed in or out; this section points there. */
export default async function DiscoverPage({ params }: { params: Promise<{ locale: string; orgId: string }> }) {
  const { locale, orgId } = await params;
  const { page, allowed, section } = await cxSection(locale, orgId, "discover");
  if (!allowed) return <SectionShell page={page} section={section} allowed={false} />;
  redirect(`/${page.locale}/homes`);
}
