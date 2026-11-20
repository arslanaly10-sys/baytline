import { notFound } from "next/navigation";
import { listInbox, listMyRequests } from "@baytline/marketplace";
import { cxSection } from "@/server/cx-page";
import { getDb } from "@/server/db";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { MyEnquiries } from "@/components/cx/MyRequests";
import { InboxView } from "@/components/cx/Inbox";

/** Customers: their own enquiries. Property managers: requests routed to them. */
export default async function EnquiriesPage({ params, searchParams }: { params: Promise<{ locale: string; orgId: string }>; searchParams: Promise<{ status?: string }> }) {
  const { locale, orgId } = await params;
  const { status } = await searchParams;
  const { page, allowed, section, actor, base, orgType } = await cxSection(locale, orgId, "enquiries");
  if (!allowed) return <SectionShell page={page} section={section} allowed={false} />;
  const { dict } = page;
  if (orgType === "individual") {
    const mine = await listMyRequests(getDb(), actor);
    return (
      <div className="space-y-8">
        <SectionHeader eyebrow={page.session.user.displayName} title={dict.cx.my.enquiries.title} intro={dict.cx.my.enquiries.intro} />
        <MyEnquiries items={mine.enquiries} dict={dict} locale={page.locale} />
      </div>
    );
  }
  if (orgType !== "property_manager") notFound();
  const data = await listInbox(getDb(), actor, { status });
  return (
    <div className="space-y-8">
      <SectionHeader eyebrow={page.ctx.org.name} title={dict.cx.org.inbox.title} intro={dict.cx.org.inbox.intro} />
      <InboxView data={data} dict={dict} locale={page.locale} orgId={orgId} base={base} status={status} sectionPath="enquiries" />
    </div>
  );
}
