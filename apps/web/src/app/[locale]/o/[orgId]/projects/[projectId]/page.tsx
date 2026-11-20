import { PHASE_KINDS } from "@baytline/core";
import { format } from "@/i18n/format";
import { projectSection } from "@/server/dev-page";
import { getMarketsConfig } from "@/server/markets";
import { savePhaseAction, updateProjectAction } from "@/server/actions/developer";
import { day } from "@/lib/dev-format";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, SelectField } from "@/components/forms/Field";
import { ProjectFields, ProjectFrame, unitsSummary } from "@/components/dev/parts";

export default async function ProjectOverview({ params }: { params: Promise<{ locale: string; orgId: string; projectId: string }> }) {
  const { locale, orgId, projectId } = await params;
  const { page, project, allowed, can } = await projectSection(locale, orgId, projectId, "project.view");
  if (!allowed) return <AccessDenied dict={page.dict} orgName={page.ctx.org.name} />;
  const { dict } = page;
  const t = dict.dev;
  const markets = await getMarketsConfig();
  const market = markets.find((m) => m.code === project.market);
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="projectId" value={project.id} />
    </>
  );
  const facts: [string, React.ReactNode][] = [
    [t.projects.fields.market, market?.name[page.locale] ?? project.market],
    [t.projects.fields.propertyTypes, project.propertyTypes.map((x) => t.projects.propertyTypes[x]).join(", ")],
    [t.projects.fields.launchDate, day(project.launchDate, locale) || dict.admin.notSet],
    [t.projects.fields.handoverDate, day(project.handoverDate, locale) || dict.admin.notSet],
    [t.projects.columns.units, unitsSummary(dict, project.unitCounts)],
  ];

  return (
    <ProjectFrame dict={dict} base={`/${locale}/o/${orgId}`} project={project} can={can}>
      <dl className="grid gap-px overflow-hidden rounded-panel border border-line bg-line sm:grid-cols-5">
        {facts.map(([k, v]) => (
          <div key={k} className="bg-surface px-4 py-3">
            <dt className="text-xs text-ink-muted">{k}</dt>
            <dd className="mt-0.5 text-sm font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {project.description && <p className="max-w-[70ch] whitespace-pre-line text-ink-muted">{project.description}</p>}

      <section aria-labelledby="phases">
        <h2 id="phases" className="text-lg">{t.phases.title}</h2>
        <p className="mt-1 text-sm text-ink-muted">{t.phases.intro}</p>
        {project.phases.length === 0 ? (
          <p className="mt-4 rounded-panel border-2 border-dashed border-line px-6 py-6 text-center text-sm text-ink-muted">{t.phases.none}</p>
        ) : (
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {project.phases.map((ph) =>
              project.canManage ? (
                <li key={ph.id} className="py-3">
                  <ActionForm action={savePhaseAction} layout="inline" variant="quiet" submitLabel={t.phases.save} pendingLabel={t.projects.saving}>
                    {hidden}
                    <input type="hidden" name="phaseId" value={ph.id} />
                    <SelectField label={t.phases.kind} name="kind" defaultValue={ph.kind} options={PHASE_KINDS.map((k) => ({ value: k, label: t.phases.kinds[k] }))} />
                    <Field label={t.phases.name} name="name" defaultValue={ph.name} required maxLength={120} />
                    <Field label={t.phases.expectedHandover} name="expectedHandover" type="date" defaultValue={ph.expectedHandover ?? ""} />
                    <Field label={t.phases.order} name="sortOrder" type="number" defaultValue={ph.sortOrder} className="w-24" />
                    <span className="self-center text-sm text-ink-muted">{format(t.phases.units, { n: ph.unitCount })}</span>
                  </ActionForm>
                </li>
              ) : (
                <li key={ph.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm">
                  <span><span className="font-medium">{ph.name}</span> <span className="text-ink-muted">({t.phases.kinds[ph.kind]})</span></span>
                  <span className="text-ink-muted">{format(t.phases.units, { n: ph.unitCount })}{ph.expectedHandover ? `. ${t.phases.expectedHandover}: ${day(ph.expectedHandover, locale)}` : ""}</span>
                </li>
              ),
            )}
          </ul>
        )}
        {project.canManage && (
          <ActionForm action={savePhaseAction} layout="inline" submitLabel={t.phases.add} pendingLabel={t.projects.saving} className="mt-4">
            {hidden}
            <SelectField label={t.phases.kind} name="kind" options={PHASE_KINDS.map((k) => ({ value: k, label: t.phases.kinds[k] }))} />
            <Field label={t.phases.name} name="name" required maxLength={120} />
            <Field label={t.phases.expectedHandover} name="expectedHandover" type="date" />
            <Field label={t.phases.order} name="sortOrder" type="number" defaultValue={project.phases.length + 1} className="w-24" />
          </ActionForm>
        )}
      </section>

      <section aria-labelledby="edit" className="rounded-panel border border-line bg-surface p-5 sm:p-6">
        <h2 id="edit" className="text-lg">{t.projects.editTitle}</h2>
        {project.canManage ? (
          <ActionForm action={updateProjectAction} submitLabel={t.projects.save} pendingLabel={t.projects.saving} className="mt-5">
            {hidden}
            <ProjectFields dict={dict} locale={page.locale} markets={markets} project={project} />
          </ActionForm>
        ) : (
          <p className="mt-2 text-sm text-ink-muted">{t.readOnly}</p>
        )}
      </section>
    </ProjectFrame>
  );
}
