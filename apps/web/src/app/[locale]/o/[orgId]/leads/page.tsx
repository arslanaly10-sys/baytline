import Link from "next/link";
import { notFound } from "next/navigation";
import { LEAD_STATUSES, SCORE_BANDS } from "@baytline/core";
import { listLeads } from "@baytline/leads";
import { listInbox } from "@baytline/marketplace";
import { cxSection } from "@/server/cx-page";
import { getDb } from "@/server/db";
import { ago } from "@/lib/homes-format";
import { buttonClass } from "@/lib/button";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Chip } from "@/components/ui/Chip";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, SelectField } from "@/components/forms/Field";
import { InboxView } from "@/components/cx/Inbox";
import { BandChip, LeadTabs } from "@/components/crm/parts";
import { captureAllAction, createLeadAction } from "@/server/actions/crm";

type Search = { tab?: string; status?: string; band?: string; assignee?: string; q?: string };

/** Developers and brokerages: leads, and the customer requests they come from. */
export default async function LeadsPage({ params, searchParams }: { params: Promise<{ locale: string; orgId: string }>; searchParams: Promise<Search> }) {
  const { locale, orgId } = await params;
  const q = await searchParams;
  const { page, allowed, section, actor, base, orgType } = await cxSection(locale, orgId, "leads");
  if (orgType !== "developer" && orgType !== "brokerage") notFound();
  if (!allowed) return <SectionShell page={page} section={section} allowed={false} />;
  const { dict } = page;
  const t = dict.crm.leads;
  const hidden = <><input type="hidden" name="locale" value={page.locale} /><input type="hidden" name="orgId" value={orgId} /></>;

  if (q.tab === "requests") {
    const data = await listInbox(getDb(), actor, { status: q.status });
    return (
      <div className="space-y-8">
        <SectionHeader eyebrow={page.ctx.org.name} title={dict.cx.org.inbox.title} intro={dict.cx.org.inbox.intro} />
        <LeadTabs dict={dict} base={base} current="requests" />
        {data.canManage && (
          <ActionForm action={captureAllAction} submitLabel={t.capture} pendingLabel={t.capturing} variant="quiet" layout="inline">{hidden}</ActionForm>
        )}
        <InboxView data={data} dict={dict} locale={page.locale} orgId={orgId} base={base} status={q.status} sectionPath="leads?tab=requests" />
      </div>
    );
  }

  const data = await listLeads(getDb(), actor, { status: q.status, band: q.band, assignee: q.assignee, q: q.q });
  const filtered = Boolean(q.status || q.band || q.assignee || q.q);
  const any = { value: "", label: t.filters.any };
  return (
    <div className="space-y-8">
      <SectionHeader eyebrow={page.ctx.org.name} title={dict.crm.tabs.leads} intro={t.intro} />
      <LeadTabs dict={dict} base={base} current="leads" />
      {!data.seesAll && <p className="text-sm text-ink-muted">{t.assignedOnly}</p>}
      <form method="get" role="search" className="flex flex-wrap items-end gap-3">
        <Field label={t.filters.q} name="q" type="search" defaultValue={q.q ?? ""} />
        <SelectField label={t.filters.status} name="status" defaultValue={q.status ?? ""}
          options={[{ value: "", label: t.filters.open }, { value: "all", label: t.filters.all }, ...LEAD_STATUSES.map((s) => ({ value: s, label: t.statuses[s] }))]} />
        <SelectField label={t.filters.band} name="band" defaultValue={q.band ?? ""} options={[any, ...SCORE_BANDS.map((b) => ({ value: b, label: t.bands[b] }))]} />
        {data.seesAll && <SelectField label={t.filters.assignee} name="assignee" defaultValue={q.assignee ?? ""} options={[any, { value: "me", label: t.filters.me }, { value: "none", label: t.filters.none }]} />}
        <button type="submit" className={buttonClass("quiet")}>{dict.admin.search}</button>
        {filtered && <Link href={`${base}/leads`} className="self-center text-sm text-gulf-strong underline underline-offset-4">{dict.admin.clear}</Link>}
      </form>

      {data.leads.length === 0 ? (
        <p className="rounded-panel border-2 border-dashed border-line px-6 py-10 text-center text-ink-muted">{filtered ? t.noMatches : t.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-panel border border-line bg-surface">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="bg-surface-sunk text-ink-muted">
              <tr>{(["name", "score", "status", "assignee", "activity"] as const).map((c) => <th key={c} scope="col" className="px-3 py-2.5 text-start font-medium">{t.columns[c]}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.leads.map((l) => (
                <tr key={l.id} className="align-top">
                  <td className="px-3 py-2.5">
                    <Link href={`${base}/leads/${l.id}`} className="font-medium text-gulf-strong underline-offset-4 hover:underline">{l.contactName}</Link>
                    <span className="block text-xs text-ink-muted">{t.sources[l.source as keyof typeof t.sources]}{l.interest ? ` · ${l.interest}` : ""}</span>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap"><BandChip dict={dict} band={l.score.band} overridden={Boolean(l.score.override)} /> <span className="ms-1 tabular-nums text-ink-muted">{l.score.score}</span></td>
                  <td className="px-3 py-2.5"><Chip tone={l.status === "won" ? "good" : l.status === "lost" ? "muted" : "neutral"}>{t.statuses[l.status]}</Chip></td>
                  <td className="px-3 py-2.5">{l.assigneeName ?? <span className="text-ink-muted">{t.unassigned}</span>}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-ink-muted">{ago(l.lastActivityAt, page.locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.canManage && (
        <details className="rounded-panel border border-line bg-surface open:border-gulf">
          <summary className="cursor-pointer list-none px-5 py-4 font-medium">{t.add.title}</summary>
          <div className="border-t border-line px-5 py-5">
            <ActionForm action={createLeadAction} submitLabel={t.add.submit} pendingLabel={t.add.submitting}>
              {hidden}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t.add.name} name="name" required maxLength={120} />
                <Field label={t.add.interest} name="interest" maxLength={300} />
                <Field label={t.add.email} name="email" type="email" dir="ltr" autoComplete="off" />
                <Field label={t.add.phone} name="phone" type="tel" dir="ltr" autoComplete="off" />
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="consent" value="on" required className="mt-1 accent-[var(--gulf)]" />
                <span>{t.add.consent}<span className="block text-xs text-ink-muted">{t.add.consentHint}</span></span>
              </label>
            </ActionForm>
          </div>
        </details>
      )}
    </div>
  );
}
