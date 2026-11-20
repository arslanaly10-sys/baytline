import Link from "next/link";
import { UNIT_STATUSES } from "@baytline/core";
import { listUnits } from "@baytline/developer";
import { actorOf, projectSection } from "@/server/dev-page";
import { getDb } from "@/server/db";
import { createUnitAction } from "@/server/actions/developer";
import { buttonClass } from "@/lib/button";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, SelectField } from "@/components/forms/Field";
import { ProjectFrame, UnitFields, UnitTable } from "@/components/dev/parts";

type Search = { status?: string; verification?: string; q?: string; phase?: string };

export default async function ProjectUnits({ params, searchParams }: { params: Promise<{ locale: string; orgId: string; projectId: string }>; searchParams: Promise<Search> }) {
  const { locale, orgId, projectId } = await params;
  const q = await searchParams;
  const { page, project, allowed, can, marketLocale } = await projectSection(locale, orgId, projectId, "inventory.view");
  if (!allowed) return <AccessDenied dict={page.dict} orgName={page.ctx.org.name} />;
  const { dict } = page;
  const t = dict.dev.units;
  const units = await listUnits(getDb(), actorOf(page), { projectId, status: q.status, verification: q.verification, q: q.q, phaseId: q.phase || undefined });
  const base = `/${locale}/o/${orgId}`;
  const filtered = Boolean(q.status || q.verification || q.q || q.phase);
  const any = { value: "", label: dict.admin.any };

  return (
    <ProjectFrame dict={dict} base={base} project={project} can={can}>
      <p className="max-w-[70ch] text-sm text-ink-muted">{t.intro}</p>
      <form method="get" role="search" className="flex flex-wrap items-end gap-3">
        <Field label={t.filters.code} name="q" type="search" defaultValue={q.q ?? ""} dir="ltr" />
        <SelectField label={t.phase} name="phase" defaultValue={q.phase ?? ""} options={[any, ...project.phases.map((p) => ({ value: p.id, label: p.name }))]} />
        <SelectField label={t.filters.status} name="status" defaultValue={q.status ?? ""} options={[any, ...UNIT_STATUSES.map((s) => ({ value: s, label: t.statuses[s] }))]} />
        <SelectField label={t.filters.verification} name="verification" defaultValue={q.verification ?? ""}
          options={[any, ...(["verified", "owner_reported", "pending", "unverified", "disputed"] as const).map((v) => ({ value: v, label: t.verifications[v] }))]} />
        <button type="submit" className={buttonClass("quiet")}>{dict.admin.search}</button>
        {filtered && <Link href={`${base}/projects/${projectId}/units`} className="self-center text-sm text-gulf-strong underline underline-offset-4">{dict.admin.clear}</Link>}
      </form>

      {units.length === 0 ? (
        <p className="rounded-panel border-2 border-dashed border-line px-6 py-10 text-center text-ink-muted">{filtered ? t.noMatches : t.none}</p>
      ) : (
        <UnitTable dict={dict} units={units} base={base} locale={marketLocale} />
      )}
      <p className="text-xs text-ink-muted">{t.priceHint}</p>

      {can("unit.manage") ? (
        <section aria-labelledby="add-unit" className="rounded-panel border border-line bg-surface p-5 sm:p-6">
          <h2 id="add-unit" className="text-lg">{t.addTitle}</h2>
          <ActionForm action={createUnitAction} submitLabel={t.create} pendingLabel={dict.dev.projects.saving} className="mt-5">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="orgId" value={orgId} />
            <input type="hidden" name="projectId" value={projectId} />
            <UnitFields dict={dict} phases={project.phases} canSetBinding={can("unit.hold.approve")} />
          </ActionForm>
        </section>
      ) : (
        <p className="text-sm text-ink-muted">{dict.dev.readOnly}</p>
      )}
    </ProjectFrame>
  );
}
