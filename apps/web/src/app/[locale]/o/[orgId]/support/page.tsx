import { notFound } from "next/navigation";
import { listMyRequests, listSupportQueue } from "@baytline/marketplace";
import { cxSection } from "@/server/cx-page";
import { getDb } from "@/server/db";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { MySupport } from "@/components/cx/MyRequests";
import { SupportQueue } from "@/components/cx/Inbox";

/** Customers: ask for help and see replies. Platform support staff: the queue. */
export default async function SupportPage({ params, searchParams }: { params: Promise<{ locale: string; orgId: string }>; searchParams: Promise<{ status?: string }> }) {
  const { locale, orgId } = await params;
  const { status } = await searchParams;
  const { page, allowed, section, actor, orgType } = await cxSection(locale, orgId, "support");
  if (!allowed) return <SectionShell page={page} section={section} allowed={false} />;
  const { dict } = page;
  if (orgType === "individual") {
    const mine = await listMyRequests(getDb(), actor);
    return (
      <div className="space-y-8">
        <SectionHeader eyebrow={page.session.user.displayName} title={dict.cx.my.support.title} intro={dict.cx.my.support.intro} />
        <MySupport items={mine.support} enquiries={mine.enquiries} dict={dict} locale={page.locale} orgId={orgId} />
      </div>
    );
  }
  if (orgType !== "platform") notFound();
  const items = await listSupportQueue(getDb(), actor, { status });
  return (
    <div className="space-y-8">
      <SectionHeader eyebrow={page.ctx.org.name} title={dict.cx.org.support.title} intro={dict.cx.org.support.intro} />
      <SupportQueue items={items} dict={dict} locale={page.locale} orgId={orgId} />
    </div>
  );
}
