import type { PartnerSourceView } from "@baytline/developer";
import type { OrgPage } from "@/server/guards";
import { format } from "@/i18n/format";
import { ago } from "@/lib/homes-format";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, SelectField } from "@/components/forms/Field";
import { Chip } from "@/components/ui/Chip";
import { AuthChip } from "./parts";
import { AsOfField } from "./AsOfField";
import { submitPartnerUpdateAction } from "@/server/actions/sources";

/** A brokerage proposes availability changes to developers that authorized it. Nothing changes until the developer reviews it. */
export function PartnerUpdates({ page, sources }: { page: OrgPage; sources: PartnerSourceView[] }) {
  const { dict } = page;
  const t = dict.src.partnerSide;
  return (
    <section aria-labelledby="partner-updates" className="space-y-4">
      <h2 id="partner-updates" className="text-lg">{t.title}</h2>
      <p className="max-w-[75ch] text-sm text-ink-muted">{t.intro}</p>
      {sources.length === 0 ? (
        <p className="rounded-panel border-2 border-dashed border-line px-6 py-8 text-center text-sm text-ink-muted">{t.none}</p>
      ) : sources.map((s) => (
        <div key={s.id} className="space-y-4 rounded-panel border border-line bg-surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-medium">{s.name}</h3>
              <p className="text-sm text-ink-muted">{format(t.from, { developer: s.developerName })}</p>
            </div>
            <AuthChip dict={dict} status={s.authorization as never} />
          </div>
          {s.authorization === "authorized" && (
            <ActionForm action={submitPartnerUpdateAction} submitLabel={t.submit} pendingLabel={t.submitting}>
              <input type="hidden" name="locale" value={page.locale} />
              <input type="hidden" name="orgId" value={page.ctx.org.id} />
              <input type="hidden" name="sourceId" value={s.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField label={t.project} name="projectId" options={s.projects.map((p) => ({ value: p.id, label: p.name }))} />
                <AsOfField label={t.asOf} hint={dict.src.imports.asOfHint} />
                <label className="block sm:col-span-2">
                  <span className="block text-sm font-medium">{t.lines}</span>
                  <textarea name="lines" rows={4} required dir="ltr" spellCheck={false} aria-describedby={`lines-${s.id}`} placeholder="A-101, reserved"
                    className="mt-1 block w-full rounded-control border border-line bg-surface px-3 py-2 font-mono text-sm text-ink focus:border-gulf" />
                  <span id={`lines-${s.id}`} className="mt-1 block text-xs text-ink-muted">{t.linesHint}</span>
                </label>
                <Field label={t.note} name="note" maxLength={500} className="sm:col-span-2" />
              </div>
            </ActionForm>
          )}
          <div>
            <h4 className="text-sm font-medium">{t.submissions}</h4>
            {s.submissions.length === 0 ? <p className="mt-1 text-sm text-ink-muted">{t.noSubmissions}</p> : (
              <ul className="mt-2 divide-y divide-line text-sm">
                {s.submissions.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>{b.projectName ?? "—"} · {b.rowCount}</span>
                    <span className="flex items-center gap-2">
                      <Chip tone={b.status === "applied" ? "good" : b.status === "cancelled" ? "muted" : "attention"}>{t.status[b.status as keyof typeof t.status] ?? b.status}</Chip>
                      <span className="text-ink-muted">{ago(b.createdAt, page.locale)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
