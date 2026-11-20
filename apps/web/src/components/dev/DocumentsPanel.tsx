import { DOCUMENT_TYPES, DOCUMENT_VISIBILITIES } from "@baytline/core";
import type { DocumentRow } from "@baytline/developer";
import type { Dictionary } from "@/i18n";
import { format } from "@/i18n/format";
import { addDocumentAction, archiveDocumentAction, updateDocumentAction } from "@/server/actions/developer";
import { Chip } from "@/components/ui/Chip";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, SelectField } from "@/components/forms/Field";

type Props = {
  dict: Dictionary;
  locale: string;
  orgId: string;
  docs: DocumentRow[];
  canManage: boolean;
  /** Fixed project (project tab) or a choice of projects (top-level section). */
  project: { id: string } | { choices: { id: string; name: string }[] };
  showProject?: boolean;
};

function DocFields({ dict, doc }: { dict: Dictionary; doc?: DocumentRow }) {
  const t = dict.dev.documents;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.title} name="title" defaultValue={doc?.title} required maxLength={160} />
        <SelectField label={t.type} name="docType" defaultValue={doc?.docType} options={DOCUMENT_TYPES.map((d) => ({ value: d, label: t.types[d] }))} />
      </div>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <SelectField label={t.referenceKind} name="referenceKind" defaultValue={doc?.referenceKind ?? "url"} options={(["url", "external_ref"] as const).map((k) => ({ value: k, label: t.referenceKinds[k] }))} />
        <Field label={t.reference} name="reference" defaultValue={doc?.reference} required maxLength={500} dir="ltr" />
      </div>
      <SelectField label={t.visibility} name="visibility" defaultValue={doc?.visibility ?? "internal"} options={DOCUMENT_VISIBILITIES.map((v) => ({ value: v, label: t.visibilities[v] }))} />
    </>
  );
}

export function DocumentsPanel({ dict, locale, orgId, docs, canManage, project, showProject }: Props) {
  const t = dict.dev.documents;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgId" value={orgId} />
    </>
  );
  return (
    <div className="space-y-8">
      <p className="max-w-[70ch] rounded-control border-s-4 border-gulf bg-surface px-3 py-2 text-sm">{t.intro}</p>
      {docs.length === 0 ? (
        <p className="rounded-panel border-2 border-dashed border-line px-6 py-8 text-center text-ink-muted">{t.none}</p>
      ) : (
        <ul className="divide-y divide-line rounded-panel border border-line bg-surface">
          {docs.map((d) => (
            <li key={d.id} className="space-y-2 px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{d.title}</p>
                  <p className="text-sm text-ink-muted">
                    {t.types[d.docType]}
                    {showProject && <>. {d.projectName}</>}. {format(t.updated, { date: date.format(d.updatedAt), name: d.updatedByName ?? "" })}
                  </p>
                  <p className="mt-1 truncate text-sm" dir="ltr">
                    {d.referenceKind === "url" ? (
                      <a href={d.reference} rel="noopener noreferrer nofollow" target="_blank" className="text-gulf-strong underline underline-offset-4">{d.reference}</a>
                    ) : (
                      <code className="rounded-chip bg-surface-sunk px-1.5 py-0.5 text-xs">{d.reference}</code>
                    )}
                  </p>
                </div>
                <Chip tone={d.visibility === "partners" ? "neutral" : "muted"}>{t.visibilities[d.visibility]}</Chip>
              </div>
              {canManage && (
                <details className="rounded-control border border-line">
                  <summary className="cursor-pointer px-3 py-1.5 text-sm text-gulf-strong">{t.edit}</summary>
                  <div className="space-y-3 border-t border-line p-3">
                    <ActionForm action={updateDocumentAction} submitLabel={t.save} pendingLabel={dict.dev.projects.saving}>
                      {hidden}
                      <input type="hidden" name="documentId" value={d.id} />
                      <DocFields dict={dict} doc={d} />
                    </ActionForm>
                    <ActionForm action={archiveDocumentAction} variant="danger" submitLabel={t.archive} pendingLabel={dict.dev.projects.saving}>
                      {hidden}
                      <input type="hidden" name="documentId" value={d.id} />
                    </ActionForm>
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        "id" in project || project.choices.length > 0 ? (
          <section aria-labelledby="add-doc" className="rounded-panel border border-line bg-surface p-5 sm:p-6">
            <h2 id="add-doc" className="text-lg">{t.addTitle}</h2>
            <ActionForm action={addDocumentAction} submitLabel={t.add} pendingLabel={dict.dev.projects.saving} className="mt-5">
              {hidden}
              {"id" in project ? (
                <input type="hidden" name="projectId" value={project.id} />
              ) : (
                <SelectField label={t.project} name="projectId" options={project.choices.map((p) => ({ value: p.id, label: p.name }))} />
              )}
              <DocFields dict={dict} />
            </ActionForm>
          </section>
        ) : (
          <p className="text-sm text-ink-muted">{dict.dev.partners.noProjects}</p>
        )
      ) : (
        <p className="text-sm text-ink-muted">{dict.dev.readOnly}</p>
      )}
    </div>
  );
}
