import Link from "next/link";
import { listInventoryChanges, listSources } from "@baytline/developer";
import { actorOf, devSection } from "@/server/dev-page";
import { getDb } from "@/server/db";
import { format } from "@/i18n/format";
import { moment } from "@/lib/homes-format";
import { buttonClass } from "@/lib/button";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { SelectField } from "@/components/forms/Field";
import { SourcesTabs, valueText } from "@/components/sources/parts";

type Search = { type?: string; source?: string; batch?: string; before?: string };

export default async function HistoryPage({ params, searchParams }: { params: Promise<{ locale: string; orgId: string }>; searchParams: Promise<Search> }) {
  const { locale, orgId } = await params;
  const q = await searchParams;
  const { page, allowed, section, isDeveloper } = await devSection(locale, orgId, "sources");
  if (!allowed || !isDeveloper) return <SectionShell page={page} section={section} allowed={allowed} />;
  const { dict } = page;
  const t = dict.src.history;
  const a = actorOf(page);
  const [sources, changes] = await Promise.all([
    listSources(getDb(), a),
    listInventoryChanges(getDb(), a, { recordType: q.type, sourceId: q.source || undefined, batchId: q.batch || undefined, before: q.before }),
  ]);
  const base = `/${page.locale}/o/${orgId}`;
  const fields = dict.src.batch.fields as Record<string, string>;
  const any = { value: "", label: t.filters.any };
  const last = changes.at(-1);
  const olderHref = last && changes.length === 200
    ? `${base}/sources/history?${new URLSearchParams({ ...(q.type ? { type: q.type } : {}), ...(q.source ? { source: q.source } : {}), ...(q.batch ? { batch: q.batch } : {}), before: last.at.toISOString() })}`
    : null;
  const recordHref = (c: (typeof changes)[number]) =>
    c.recordType === "unit" ? `${base}/projects/${c.projectId}/units/${c.recordId}`
      : c.recordType === "project" ? `${base}/projects/${c.projectId}`
        : `${base}/projects/${c.projectId}/pricing/${c.recordType === "price" ? "prices" : "plans"}/${c.recordId}`;

  return (
    <div className="space-y-8">
      <SectionHeader eyebrow={page.ctx.org.name} title={dict.workspaces.developer.sections.sources.label} intro={t.intro} />
      <SourcesTabs dict={dict} base={base} current="history" />
      <form method="get" className="flex flex-wrap items-end gap-3">
        <SelectField label={t.filters.recordType} name="type" defaultValue={q.type ?? ""}
          options={[any, ...(["unit", "project", "price", "payment_plan"] as const).map((r) => ({ value: r, label: t.recordTypes[r] }))]} />
        <SelectField label={t.filters.source} name="source" defaultValue={q.source ?? ""}
          options={[any, ...sources.map((s) => ({ value: s.id, label: s.type === "workspace" ? dict.src.types.workspace.name : s.name }))]} />
        {q.batch && <input type="hidden" name="batch" value={q.batch} />}
        <button type="submit" className={buttonClass("quiet")}>{dict.admin.search}</button>
        {(q.type || q.source || q.batch) && <Link href={`${base}/sources/history`} className="self-center text-sm text-gulf-strong underline underline-offset-4">{dict.admin.clear}</Link>}
      </form>

      {changes.length === 0 ? (
        <p className="rounded-panel border-2 border-dashed border-line px-6 py-10 text-center text-ink-muted">{t.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-panel border border-line bg-surface">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="bg-surface-sunk text-ink-muted">
              <tr>{(["when", "record", "change", "source", "by"] as const).map((c) => <th key={c} scope="col" className="px-3 py-2.5 text-start font-medium">{t.columns[c]}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {changes.map((c) => (
                <tr key={c.key} className="align-top">
                  <td className="px-3 py-2.5 whitespace-nowrap text-ink-muted">{moment(c.at, page.locale)}</td>
                  <td className="px-3 py-2.5">
                    <span className="block text-xs text-ink-muted">{t.recordTypes[c.recordType]}</span>
                    <Link href={recordHref(c)} className="text-gulf-strong underline-offset-4 hover:underline">{c.label}</Link>
                  </td>
                  <td className="px-3 py-2.5">
                    {c.field === "draft_version" ? format(t.draftVersion, { status: dict.dev.pricing.statuses[c.to as keyof typeof dict.dev.pricing.statuses] ?? String(c.to) }) : (
                      <><span className="text-ink-muted">{fields[c.field] ?? c.field}: </span><bdi>{valueText(c.from)}</bdi> → <bdi className="font-medium">{valueText(c.to)}</bdi></>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {c.sourceType === "workspace" ? dict.src.types.workspace.name : c.sourceName ?? "—"}
                    {c.batchId && <Link href={`${base}/sources/imports/${c.batchId}`} className="block text-xs text-gulf-strong underline-offset-4 hover:underline">{t.viewImport}</Link>}
                  </td>
                  <td className="px-3 py-2.5 text-ink-muted">{c.actorName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {olderHref && <Link href={olderHref} className={buttonClass("quiet")}>{t.older}</Link>}
    </div>
  );
}
