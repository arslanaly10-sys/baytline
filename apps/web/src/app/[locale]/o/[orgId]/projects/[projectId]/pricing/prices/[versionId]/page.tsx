import Link from "next/link";
import { notFound } from "next/navigation";
import { getPriceVersion, minorToInput } from "@baytline/developer";
import { IdentityError } from "@baytline/identity";
import { format } from "@/i18n/format";
import { actorOf, projectSection } from "@/server/dev-page";
import { getDb } from "@/server/db";
import { decidePriceAction, savePriceDraftAction, submitPriceAction } from "@/server/actions/developer";
import { day, money } from "@/lib/dev-format";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field } from "@/components/forms/Field";
import { ProjectFrame, SampleBadge } from "@/components/dev/parts";
import { VersionPanel } from "@/components/dev/VersionPanel";

export default async function PriceVersionPage({ params }: { params: Promise<{ locale: string; orgId: string; projectId: string; versionId: string }> }) {
  const { locale, orgId, projectId, versionId } = await params;
  const { page, project, allowed, can, marketLocale } = await projectSection(locale, orgId, projectId, "price.view");
  if (!allowed) return <AccessDenied dict={page.dict} orgName={page.ctx.org.name} />;
  const v = await getPriceVersion(getDb(), actorOf(page), versionId).catch((e) => {
    if (e instanceof IdentityError && e.code === "not_found") notFound();
    throw e;
  });
  if (v.projectId !== projectId) notFound();
  const { dict } = page;
  const t = dict.dev.pricing;
  const e = t.editor;
  const when = new Intl.DateTimeFormat(marketLocale, { dateStyle: "medium", timeStyle: "short" });
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="versionId" value={v.id} />
    </>
  );
  const table = (
    <div className="overflow-x-auto rounded-panel border border-line bg-surface">
      <table className="w-full min-w-[36rem] text-sm">
        <thead className="bg-surface-sunk text-ink-muted">
          <tr>
            {[e.unit, dict.dev.units.status, e.previous, format(e.priceIn, { currency: v.currency })].map((c) => (
              <th key={c} scope="col" className="px-3 py-2.5 text-start font-medium">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {v.rows.map((r) => (
            <tr key={r.unitId}>
              <td className="px-3 py-2" dir="ltr">
                {r.code} {r.phaseName && <span className="text-xs text-ink-muted">({r.phaseName})</span>} {r.isSample && <SampleBadge dict={dict} />}
              </td>
              <td className="px-3 py-2">{dict.dev.units.statuses[r.status as keyof typeof dict.dev.units.statuses]}</td>
              <td className="px-3 py-2 tabular-nums text-ink-muted">{r.previousMinor ? money(r.previousMinor, v.currency, marketLocale) : ""}</td>
              <td className="px-3 py-2 tabular-nums">
                {v.canEdit ? (
                  <input
                    name={`price:${r.unitId}`}
                    defaultValue={r.priceMinor ? minorToInput(r.priceMinor, v.currency) : ""}
                    inputMode="decimal"
                    dir="ltr"
                    aria-label={`${e.unit} ${r.code}`}
                    className="w-40 rounded-control border border-line bg-surface px-2 py-1.5 text-sm"
                  />
                ) : r.priceMinor ? (
                  money(r.priceMinor, v.currency, marketLocale)
                ) : (
                  <span className="text-ink-muted">{e.notPriced}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <ProjectFrame dict={dict} base={`/${locale}/o/${orgId}`} project={project} can={can}>
      <p>
        <Link href={`/${locale}/o/${orgId}/projects/${projectId}/pricing`} className="text-sm text-gulf-strong underline underline-offset-4">{dict.dev.projects.nav.pricing}</Link>
      </p>
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-xl">{v.listName}</h2>
        <span className="text-ink-muted">{format(t.version, { n: v.version })}</span>
        <span className="text-sm text-ink-muted">{day(v.effectiveFrom, marketLocale)}{v.effectiveTo ? ` – ${day(v.effectiveTo, marketLocale)}` : ""}</span>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        {/* min-w-0: let wide tables scroll inside their own container instead of widening the page */}
        <div className="min-w-0 space-y-4">
          {v.rows.length === 0 ? (
            <p className="rounded-panel border-2 border-dashed border-line px-6 py-6 text-center text-sm text-ink-muted">{e.noUnits}</p>
          ) : v.canEdit ? (
            <ActionForm action={savePriceDraftAction} submitLabel={e.save} pendingLabel={e.saving}>
              {hidden}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t.effectiveFrom} name="effectiveFrom" type="date" required defaultValue={v.effectiveFrom} />
                <Field label={t.effectiveTo} hint={t.effectiveToHint} name="effectiveTo" type="date" defaultValue={v.effectiveTo ?? ""} />
              </div>
              <p className="text-xs text-ink-muted">{e.blankHint}</p>
              {table}
              <label className="block">
                <span className="block text-sm font-medium">{e.notes}</span>
                <textarea name="notes" defaultValue={v.notes ?? ""} maxLength={1000} rows={2} className="mt-1 block w-full rounded-control border border-line bg-surface px-3 py-2 text-sm" />
              </label>
            </ActionForm>
          ) : (
            <>
              {table}
              {v.notes && <p className="text-sm text-ink-muted" dir="auto">{v.notes}</p>}
            </>
          )}
          <p className="text-xs text-ink-muted">{t.rulesNote}</p>
        </div>
        <VersionPanel dict={dict} v={v} hidden={hidden} canSubmit={v.canSubmit} canDecide={v.canDecide} isOwn={v.submittedBy === page.session.user.id}
          submitAction={submitPriceAction} decideAction={decidePriceAction} when={when} />
      </div>
    </ProjectFrame>
  );
}
