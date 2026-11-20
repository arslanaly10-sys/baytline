import Link from "next/link";
import { hasCapability, PROJECT_STATUSES, PROPERTY_TYPES } from "@baytline/core";
import { listProjects } from "@baytline/developer";
import { actorOf, devSection } from "@/server/dev-page";
import { getDb } from "@/server/db";
import { getMarketsConfig, marketOptions } from "@/server/markets";
import { createProjectAction } from "@/server/actions/developer";
import { buttonClass } from "@/lib/button";
import { day } from "@/lib/dev-format";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Chip } from "@/components/ui/Chip";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, SelectField } from "@/components/forms/Field";
import { ProjectFields, projectTone, SampleBadge, unitsSummary } from "@/components/dev/parts";

type Search = { q?: string; status?: string; market?: string; type?: string };

export default async function ProjectsPage({ params, searchParams }: { params: Promise<{ locale: string; orgId: string }>; searchParams: Promise<Search> }) {
  const { locale, orgId } = await params;
  const q = await searchParams;
  const { page, allowed, section } = await devSection(locale, orgId, "projects");
  if (!allowed) return <SectionShell page={page} section={section} allowed={false} />;
  const { dict } = page;
  const t = dict.dev.projects;
  const [projects, markets] = await Promise.all([
    listProjects(getDb(), actorOf(page), { q: q.q, status: q.status, market: q.market, propertyType: q.type }),
    getMarketsConfig(),
  ]);
  const canManage = hasCapability(page.ctx.principal, "project.manage");
  const base = `/${locale}/o/${orgId}`;
  const filtered = Boolean(q.q || q.status || q.market || q.type);
  const any = { value: "", label: dict.admin.any };

  return (
    <div className="space-y-8">
      <SectionHeader eyebrow={page.ctx.org.name} title={dict.workspaces.developer.sections.projects.label} intro={t.intro} />
      <form method="get" role="search" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] lg:items-end">
        <Field label={t.searchLabel} name="q" type="search" defaultValue={q.q ?? ""} />
        <SelectField label={t.fields.status} name="status" defaultValue={q.status ?? ""} options={[any, ...PROJECT_STATUSES.map((s) => ({ value: s, label: t.statuses[s] }))]} />
        <SelectField label={t.fields.market} name="market" defaultValue={q.market ?? ""} options={[any, ...marketOptions(markets, page.locale)]} />
        <SelectField label={t.fields.propertyTypes} name="type" defaultValue={q.type ?? ""} options={[any, ...PROPERTY_TYPES.map((p) => ({ value: p, label: t.propertyTypes[p] }))]} />
        <div className="flex gap-2">
          <button type="submit" className={buttonClass("quiet")}>{dict.admin.search}</button>
          {filtered && <Link href={`${base}/projects`} className="self-center text-sm text-gulf-strong underline underline-offset-4">{dict.admin.clear}</Link>}
        </div>
      </form>

      {projects.length === 0 ? (
        <p className="rounded-panel border-2 border-dashed border-line px-6 py-10 text-center text-ink-muted">{filtered ? t.noMatches : t.noProjects}</p>
      ) : (
        <ul className="grid gap-px overflow-hidden rounded-panel border border-line bg-line">
          {projects.map((p) => (
            <li key={p.id} className="bg-surface">
              <Link href={`${base}/projects/${p.id}`} className="grid gap-2 px-5 py-4 hover:bg-gulf-tint sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-6">
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gulf-strong">{p.name}</span>
                    {p.isSample && <SampleBadge dict={dict} />}
                  </span>
                  <span className="block text-sm text-ink-muted">
                    {p.city}
                    {p.location ? `, ${p.location}` : ""}. {p.propertyTypes.map((x) => t.propertyTypes[x]).join(", ")}
                  </span>
                </span>
                <span className="text-sm text-ink-muted">
                  {unitsSummary(dict, p.unitCounts)}
                  {p.handoverDate && <span className="block">{t.fields.handoverDate}: {day(p.handoverDate, locale)}</span>}
                </span>
                <Chip tone={projectTone(p.status)}>{t.statuses[p.status]}</Chip>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <section aria-labelledby="add-project" className="rounded-panel border border-line bg-surface p-5 sm:p-6">
          <h2 id="add-project" className="text-lg">{t.addTitle}</h2>
          <ActionForm action={createProjectAction} submitLabel={t.create} pendingLabel={t.creating} className="mt-5">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="orgId" value={orgId} />
            <ProjectFields dict={dict} locale={page.locale} markets={markets} />
          </ActionForm>
        </section>
      ) : (
        <p className="text-sm text-ink-muted">{dict.dev.readOnly}</p>
      )}
    </div>
  );
}
