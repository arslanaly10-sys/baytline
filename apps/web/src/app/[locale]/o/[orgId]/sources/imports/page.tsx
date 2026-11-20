import Link from "next/link";
import { hasCapability, IMPORT_RECORD_TYPES } from "@baytline/core";
import { listBatches, listSources } from "@baytline/developer";
import { actorOf, devSection } from "@/server/dev-page";
import { getDb } from "@/server/db";
import { ago } from "@/lib/homes-format";
import { buttonClass } from "@/lib/button";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, SelectField } from "@/components/forms/Field";
import { Chip } from "@/components/ui/Chip";
import { AsOfField } from "@/components/sources/AsOfField";
import { BatchStatusChip, SourcesTabs, summaryText } from "@/components/sources/parts";
import { uploadImportAction } from "@/server/actions/sources";

export default async function ImportsPage({ params, searchParams }: { params: Promise<{ locale: string; orgId: string }>; searchParams: Promise<{ status?: string }> }) {
  const { locale, orgId } = await params;
  const q = await searchParams;
  const { page, allowed, section, isDeveloper } = await devSection(locale, orgId, "sources");
  if (!allowed || !isDeveloper) return <SectionShell page={page} section={section} allowed={allowed} />;
  const { dict } = page;
  const t = dict.src;
  const a = actorOf(page);
  const status = q.status === "all" ? undefined : "open";
  const [sources, batches] = await Promise.all([listSources(getDb(), a), listBatches(getDb(), a, { status })]);
  const fileSources = sources.filter((s) => s.type === "file_import" && s.authorization === "authorized");
  const canImport = hasCapability(page.ctx.principal, "inventory.import");
  const base = `/${page.locale}/o/${orgId}`;
  const linkCls = "underline-offset-4 aria-[current=page]:font-medium aria-[current=page]:underline";

  return (
    <div className="space-y-8">
      <SectionHeader eyebrow={page.ctx.org.name} title={dict.workspaces.developer.sections.sources.label} intro={t.intro} />
      <SourcesTabs dict={dict} base={base} current="imports" />

      {canImport && (
        <section aria-labelledby="upload" className="rounded-panel border border-line bg-surface p-5 sm:p-6">
          <h2 id="upload" className="text-lg">{t.imports.uploadTitle}</h2>
          <p className="mt-1 max-w-[75ch] text-sm text-ink-muted">{t.imports.uploadIntro}</p>
          {fileSources.length === 0 ? (
            <div className="mt-4 rounded-control border border-dashed border-line px-4 py-4 text-sm">
              <p className="text-ink-muted">{t.imports.noSource}</p>
              <Link href={`${base}/sources#add-source`} className={`${buttonClass("quiet")} mt-3`}>{t.imports.addSource}</Link>
            </div>
          ) : (
            <ActionForm action={uploadImportAction} submitLabel={t.imports.submit} pendingLabel={t.imports.submitting} className="mt-5">
              <input type="hidden" name="locale" value={page.locale} />
              <input type="hidden" name="orgId" value={orgId} />
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField label={t.imports.source} name="sourceId" options={fileSources.map((s) => ({ value: s.id, label: s.name }))} />
                <SelectField label={t.imports.recordType} name="recordType" options={IMPORT_RECORD_TYPES.map((r) => ({ value: r, label: t.recordTypes[r] }))} />
                <Field label={t.imports.file} name="file" type="file" accept=".csv,text/csv,text/plain" hint={t.imports.fileHint} />
                <AsOfField label={t.imports.asOf} hint={t.imports.asOfHint} />
                <label className="block sm:col-span-2">
                  <span className="block text-sm font-medium">{t.imports.paste}</span>
                  <textarea name="csv" rows={4} dir="ltr" spellCheck={false}
                    className="mt-1 block w-full rounded-control border border-line bg-surface px-3 py-2 font-mono text-xs text-ink focus:border-gulf" />
                </label>
                <Field label={t.imports.effectiveFrom} name="effectiveFrom" type="date" hint={t.imports.effectiveFromHint} />
                <Field label={t.imports.note} name="note" maxLength={500} />
              </div>
            </ActionForm>
          )}
          <details className="mt-5 text-sm">
            <summary className="cursor-pointer font-medium text-gulf-strong">{t.templates.title}</summary>
            <dl className="mt-3 space-y-2">
              {IMPORT_RECORD_TYPES.map((r) => (
                <div key={r}><dt className="text-ink-muted">{t.recordTypes[r]}</dt><dd dir="ltr" className="text-start font-mono text-xs">{t.templates[r]}</dd></div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-ink-muted">{t.templates.note}</p>
          </details>
        </section>
      )}

      <section aria-labelledby="imports-list" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="imports-list" className="text-lg">{t.imports.listTitle}</h2>
          <nav aria-label={t.imports.listTitle} className="flex gap-3 text-sm">
            <Link href={`${base}/sources/imports`} aria-current={status ? "page" : undefined} className={linkCls}>{t.imports.filterOpen}</Link>
            <Link href={`${base}/sources/imports?status=all`} aria-current={!status ? "page" : undefined} className={linkCls}>{t.imports.filterAll}</Link>
          </nav>
        </div>
        {batches.length === 0 ? (
          <p className="rounded-panel border-2 border-dashed border-line px-6 py-10 text-center text-ink-muted">{t.imports.empty}</p>
        ) : (
          <div className="overflow-x-auto rounded-panel border border-line bg-surface">
            <table className="w-full min-w-[48rem] text-sm">
              <thead className="bg-surface-sunk text-ink-muted">
                <tr>{(["when", "source", "contents", "rows", "status", "result"] as const).map((c) => <th key={c} scope="col" className="px-3 py-2.5 text-start font-medium">{t.imports.columns[c]}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {batches.map((b) => (
                  <tr key={b.id} className="align-top">
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <Link href={`${base}/sources/imports/${b.id}`} className="font-medium text-gulf-strong underline-offset-4 hover:underline">{ago(b.createdAt, page.locale)}</Link>
                      {b.createdByName && <span className="block text-xs text-ink-muted">{b.createdByName}</span>}
                    </td>
                    <td className="px-3 py-2.5">{b.sourceName}{b.partnerSubmitted && <span className="ms-2"><Chip tone="neutral">{t.imports.fromPartner}</Chip></span>}{b.fileName && <span dir="ltr" className="block text-xs text-ink-muted">{b.fileName}</span>}</td>
                    <td className="px-3 py-2.5">{t.recordTypes[b.recordType]}</td>
                    <td className="px-3 py-2.5 tabular-nums">{b.rowCount}</td>
                    <td className="px-3 py-2.5"><BatchStatusChip dict={dict} status={b.status} /></td>
                    <td className="px-3 py-2.5 text-ink-muted">{summaryText(dict, b.summary)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
