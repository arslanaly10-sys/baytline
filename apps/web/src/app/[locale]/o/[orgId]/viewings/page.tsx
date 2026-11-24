import Link from "next/link";
import { notFound } from "next/navigation";
import { listViewings } from "@baytline/leads";
import { cxSection } from "@/server/cx-page";
import { getDb } from "@/server/db";
import { moment } from "@/lib/homes-format";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Chip } from "@/components/ui/Chip";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field } from "@/components/forms/Field";
import { updateViewingAction } from "@/server/actions/crm";

export default async function ViewingsPage({ params, searchParams }: { params: Promise<{ locale: string; orgId: string }>; searchParams: Promise<{ when?: string }> }) {
  const { locale, orgId } = await params;
  const { when } = await searchParams;
  const { page, allowed, section, actor, base, orgType } = await cxSection(locale, orgId, "viewings");
  if (orgType !== "developer" && orgType !== "brokerage") notFound();
  if (!allowed) return <SectionShell page={page} section={section} allowed={false} />;
  const { items, canManage } = await listViewings(getDb(), actor, { when });
  const { dict } = page;
  const t = dict.crm.viewings;
  const past = when === "past";
  const link = "underline-offset-4 aria-[current=page]:font-medium aria-[current=page]:underline";
  return (
    <div className="space-y-8">
      <SectionHeader eyebrow={page.ctx.org.name} title={t.title} intro={t.intro} />
      <nav aria-label={t.title} className="flex gap-4 text-sm">
        <Link href={`${base}/viewings`} aria-current={!past ? "page" : undefined} className={link}>{t.upcoming}</Link>
        <Link href={`${base}/viewings?when=past`} aria-current={past ? "page" : undefined} className={link}>{t.past}</Link>
      </nav>
      {items.length === 0 ? <p className="rounded-panel border-2 border-dashed border-line px-6 py-10 text-center text-ink-muted">{t.empty}</p> : (
        <ul className="space-y-3">
          {items.map((v) => (
            <li key={v.id} className="rounded-panel border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link href={`${base}/leads/${v.leadId}`} className="font-medium text-gulf-strong underline-offset-4 hover:underline">{v.leadName}</Link>
                  <p className="text-sm text-ink-muted">{v.projectName}{v.unitCode ? ` · ${v.unitCode}` : ""} · {moment(v.scheduledFor, page.locale, v.timeZone)}{v.assigneeName ? ` · ${v.assigneeName}` : ""}</p>
                  {v.outcome && <p className="mt-1 text-sm">{v.outcome}</p>}
                </div>
                <Chip tone={v.status === "completed" ? "good" : v.status === "scheduled" ? "neutral" : "muted"}>{t.statuses[v.status]}</Chip>
              </div>
              {canManage && v.status === "scheduled" && (
                <ActionForm action={updateViewingAction} submitLabel={t.complete} pendingLabel={dict.crm.viewings.submitting} layout="inline" className="mt-3">
                  <input type="hidden" name="locale" value={page.locale} /><input type="hidden" name="orgId" value={orgId} /><input type="hidden" name="viewingId" value={v.id} />
                  <label className="block text-sm"><span className="sr-only">{dict.crm.deals.stage}</span>
                    <select name="status" defaultValue="completed" className="rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink">
                      <option value="completed">{t.complete}</option><option value="no_show">{t.noShow}</option><option value="cancelled">{t.cancel}</option>
                    </select>
                  </label>
                  <Field label={t.outcome} name="outcome" maxLength={1000} className="min-w-[14rem] flex-1" />
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
