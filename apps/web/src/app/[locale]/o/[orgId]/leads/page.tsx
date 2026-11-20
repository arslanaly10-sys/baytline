import { notFound } from "next/navigation";
import { listInbox } from "@baytline/marketplace";
import { cxSection } from "@/server/cx-page";
import { getDb } from "@/server/db";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { InboxView } from "@/components/cx/Inbox";

/** Developers and brokerages: customer requests routed to them from public listings. */
export default async function LeadsPage({ params, searchParams }: { params: Promise<{ locale: string; orgId: string }>; searchParams: Promise<{ status?: string }> }) {
  const { locale, orgId } = await params;
  const { status } = await searchParams;
  const { page, allowed, section, actor, base, orgType } = await cxSection(locale, orgId, "leads");
  if (orgType !== "developer" && orgType !== "brokerage") notFound();
  if (!allowed) return <SectionShell page={page} section={section} allowed={false} />;
  const data = await listInbox(getDb(), actor, { status });
  return (
    <div className="space-y-8">
      <SectionHeader eyebrow={page.ctx.org.name} title={page.dict.cx.org.inbox.title} intro={page.dict.cx.org.inbox.intro} />
      <InboxView data={data} dict={page.dict} locale={page.locale} orgId={orgId} base={base} status={status} sectionPath="leads" />
    </div>
  );
}
