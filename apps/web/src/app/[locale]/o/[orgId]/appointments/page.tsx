import { notFound } from "next/navigation";
import { listMyRequests } from "@baytline/marketplace";
import { cxSection } from "@/server/cx-page";
import { getDb } from "@/server/db";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { MyAppointments } from "@/components/cx/MyRequests";

export default async function AppointmentsPage({ params }: { params: Promise<{ locale: string; orgId: string }> }) {
  const { locale, orgId } = await params;
  const { page, allowed, section, actor, orgType } = await cxSection(locale, orgId, "appointments");
  if (orgType !== "individual") notFound();
  if (!allowed) return <SectionShell page={page} section={section} allowed={false} />;
  const t = page.dict.cx.my.appointments;
  const mine = await listMyRequests(getDb(), actor);
  return (
    <div className="space-y-8">
      <SectionHeader eyebrow={page.session.user.displayName} title={t.title} intro={t.intro} />
      <MyAppointments items={mine.appointments} dict={page.dict} locale={page.locale} orgId={orgId} />
    </div>
  );
}
