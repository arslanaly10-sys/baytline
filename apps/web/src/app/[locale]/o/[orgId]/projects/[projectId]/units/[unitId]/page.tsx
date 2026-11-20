import { notFound } from "next/navigation";
import { getUnit } from "@baytline/developer";
import { IdentityError } from "@baytline/identity";
import type { Dictionary } from "@/i18n";
import { format } from "@/i18n/format";
import { actorOf, projectSection } from "@/server/dev-page";
import { getDb } from "@/server/db";
import { updateUnitAction, verifyUnitAction } from "@/server/actions/developer";
import { day, money } from "@/lib/dev-format";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { Chip } from "@/components/ui/Chip";
import { ProvenanceChip } from "@/components/ui/ProvenanceChip";
import { ActionForm } from "@/components/forms/ActionForm";
import { ProjectFrame, SampleBadge, UnitFields, unitTone, VersionChip } from "@/components/dev/parts";

export default async function UnitPage({ params }: { params: Promise<{ locale: string; orgId: string; projectId: string; unitId: string }> }) {
  const { locale, orgId, projectId, unitId } = await params;
  const { page, project, allowed, can, marketLocale } = await projectSection(locale, orgId, projectId, "inventory.view");
  if (!allowed) return <AccessDenied dict={page.dict} orgName={page.ctx.org.name} />;
  const unit = await getUnit(getDb(), actorOf(page), unitId).catch((e) => {
    if (e instanceof IdentityError && e.code === "not_found") notFound();
    throw e;
  });
  if (unit.projectId !== projectId) notFound();
  const { dict } = page;
  const t = dict.dev.units;
  const when = new Intl.DateTimeFormat(marketLocale, { dateStyle: "medium", timeStyle: "short" });
  const phaseNames = Object.fromEntries(project.phases.map((p) => [p.id, p.name]));
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="unitId" value={unit.id} />
    </>
  );

  return (
    <ProjectFrame dict={dict} base={`/${locale}/o/${orgId}`} project={project} can={can}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl" dir="ltr">{unit.code}</h2>
        <Chip tone={unitTone(unit.status)}>{t.statuses[unit.status]}</Chip>
        <ProvenanceChip status={unit.availability} label={dict.provenance[unit.availability]} />
        {unit.isSample && <SampleBadge dict={dict} />}
        <span className="text-sm text-ink-muted">{format(t.version, { n: unit.version })}</span>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="unit-edit" className="rounded-panel border border-line bg-surface p-5 sm:p-6">
          <h3 id="unit-edit" className="sr-only">{t.save}</h3>
          {unit.canManage ? (
            <ActionForm action={updateUnitAction} submitLabel={t.save} pendingLabel={dict.dev.projects.saving}>
              {hidden}
              <UnitFields dict={dict} phases={project.phases} unit={unit} canSetBinding={unit.canSetBinding} />
            </ActionForm>
          ) : (
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              {([[t.phase, unit.phaseName ?? t.noPhase], [t.propertyType, dict.dev.projects.propertyTypes[unit.propertyType]], [t.bedrooms, unit.bedrooms === 0 ? t.studio : (unit.bedrooms ?? "")], [t.area, unit.areaSqm ?? ""], [t.floor, unit.floor ?? ""]] as const).map(([k, v]) => (
                <div key={k}><dt className="text-ink-muted">{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
          )}
        </section>

        <div className="space-y-6">
          <section aria-labelledby="prov" className="rounded-panel border border-dashed border-gulf p-5">
            <h3 id="prov" className="text-lg">{t.provenance}</h3>
            <dl className="mt-3 space-y-2 text-sm">
              <div><dt className="text-ink-muted">{t.source}</dt><dd>{t.sources[unit.sourceKind]}{unit.sourceRef && <span className="text-ink-muted" dir="ltr"> ({unit.sourceRef})</span>}</dd></div>
              <div><dt className="text-ink-muted">{t.lastUpdated}</dt><dd>{when.format(unit.lastUpdatedAt)}</dd></div>
              <div>
                <dt className="text-ink-muted">{t.verification}</dt>
                <dd>{t.verifications[unit.verification]}{unit.lastVerifiedAt && <span className="block text-ink-muted">{format(t.verifiedOn, { date: when.format(unit.lastVerifiedAt) })}</span>}</dd>
              </div>
              <div><dt className="text-ink-muted">{t.availability}</dt><dd><ProvenanceChip status={unit.availability} label={dict.provenance[unit.availability]} /> <span className="block text-xs text-ink-muted">{dict.provenance.describe[unit.availability]}</span></dd></div>
            </dl>
            {unit.canVerify && unit.verification !== "verified" && (
              <div className="mt-4 border-t border-line pt-4">
                <p className="mb-2 text-xs text-ink-muted">{t.verifyHint}</p>
                <ActionForm action={verifyUnitAction} variant="quiet" submitLabel={t.verify} pendingLabel={dict.dev.projects.saving}>{hidden}</ActionForm>
              </div>
            )}
            {unit.isSample && <p className="mt-3 text-xs text-ink-muted">{dict.dev.sampleHint}</p>}
          </section>

          {can("price.view") && (
            <section aria-labelledby="prices">
              <h3 id="prices" className="text-lg">{t.priceHistory}</h3>
              <p className="mt-1 text-sm">{unit.price ? <span className="text-lg tabular-nums">{money(unit.price.minor, unit.price.currency, marketLocale)}</span> : <span className="text-ink-muted">{t.noPrice}</span>}</p>
              {unit.prices.length === 0 ? (
                <p className="mt-2 text-sm text-ink-muted">{t.noPriceHistory}</p>
              ) : (
                <ul className="mt-3 divide-y divide-line border-y border-line text-sm">
                  {unit.prices.map((p) => (
                    <li key={`${p.listName}-${p.version}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>{p.listName}, {format(dict.dev.pricing.version, { n: p.version })} <span className="text-ink-muted">({day(p.effectiveFrom, marketLocale)})</span></span>
                      <span className="flex items-center gap-2 tabular-nums">{money(p.minor, p.currency, marketLocale)} <VersionChip status={p.status as never} dict={dict} /></span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>

      <section aria-labelledby="history">
        <h3 id="history" className="text-lg">{t.history}</h3>
        {unit.history.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">{t.noHistory}</p>
        ) : (
          <ol className="mt-3 divide-y divide-line border-y border-line text-sm">
            {unit.history.map((h) => (
              <li key={h.id} className="grid gap-1 py-2.5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
                <span className="text-ink-muted">{when.format(h.at)}<span className="block text-xs">{h.actorName}. {format(t.version, { n: h.version })}</span></span>
                <span>
                  <span className="font-medium">{(t.fieldNames as Record<string, string>)[h.field] ?? h.field}</span>
                  {h.field !== "created" && <> : <ChangeValue v={h.from} field={h.field} dict={dict} phases={phaseNames} /> → <ChangeValue v={h.to} field={h.field} dict={dict} phases={phaseNames} /></>}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </ProjectFrame>
  );
}

function ChangeValue({ v, field, dict, phases }: { v: unknown; field: string; dict: Dictionary; phases: Record<string, string> }) {
  if (v === null || v === "" || v === undefined) return <span className="text-ink-muted">{dict.admin.notSet}</span>;
  const t = dict.dev.units;
  if (field === "status") return <>{t.statuses[v as keyof typeof t.statuses] ?? String(v)}</>;
  if (field === "verification") return <>{t.verifications[v as keyof typeof t.verifications] ?? String(v)}</>;
  if (field === "property_type") return <>{dict.dev.projects.propertyTypes[v as keyof typeof dict.dev.projects.propertyTypes] ?? String(v)}</>;
  if (field === "phase_id") return <>{phases[String(v)] ?? dict.admin.notSet}</>;
  return <bdi>{String(v)}</bdi>;
}
