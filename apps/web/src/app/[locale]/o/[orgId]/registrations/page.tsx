import { notFound } from "next/navigation";
import { listRegistrations } from "@baytline/leads";
import { cxSection } from "@/server/cx-page";
import { getDb } from "@/server/db";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { RegistrationsView } from "@/components/crm/RegistrationsView";

/** Client registrations: a developer's review queue. */
export default async function Page({ params }: { params: Promise<{ locale: string; orgId: string }> }) {
  const { locale, orgId } = await params;
  const { page, allowed, section, actor, base, orgType } = await cxSection(locale, orgId, "registrations");
  if (orgType !== "developer") notFound();
  if (!allowed) return <SectionShell page={page} section={section} allowed={false} />;
  const data = await listRegistrations(getDb(), actor);
  const t = page.dict.crm.registrations;
  return (
    <div className="space-y-8">
      <SectionHeader eyebrow={page.ctx.org.name} title={data.side === "developer" ? t.titleDeveloper : t.titleBrokerage} intro={data.side === "developer" ? t.introDeveloper : t.introBrokerage} />
      <RegistrationsView dict={page.dict} locale={page.locale} orgId={orgId} base={base} {...data} />
    </div>
  );
}
