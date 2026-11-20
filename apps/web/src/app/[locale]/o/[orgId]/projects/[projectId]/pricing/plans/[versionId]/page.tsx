import Link from "next/link";
import { notFound } from "next/navigation";
import { MILESTONE_TRIGGERS } from "@baytline/core";
import { getPlanVersion, minorToInput, type Milestone } from "@baytline/developer";
import { IdentityError } from "@baytline/identity";
import type { Dictionary } from "@/i18n";
import { format } from "@/i18n/format";
import { actorOf, projectSection } from "@/server/dev-page";
import { getDb } from "@/server/db";
import { decidePlanAction, savePlanDraftAction, submitPlanAction } from "@/server/actions/developer";
import { day, money } from "@/lib/dev-format";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field } from "@/components/forms/Field";
import { ProjectFrame } from "@/components/dev/parts";
import { VersionPanel } from "@/components/dev/VersionPanel";

const BLANK_ROWS = 3;

export default async function PlanVersionPage({ params }: { params: Promise<{ locale: string; orgId: string; projectId: string; versionId: string }> }) {
  const { locale, orgId, projectId, versionId } = await params;
  const { page, project, allowed, can, marketLocale } = await projectSection(locale, orgId, projectId, "price.view");
  if (!allowed) return <AccessDenied dict={page.dict} orgName={page.ctx.org.name} />;
  const v = await getPlanVersion(getDb(), actorOf(page), versionId).catch((e) => {
    if (e instanceof IdentityError && e.code === "not_found") notFound();
    throw e;
  });
  if (v.projectId !== projectId) notFound();
  const { dict } = page;
  const t = dict.dev.pricing;
  const pl = t.plan;
  const when = new Intl.DateTimeFormat(marketLocale, { dateStyle: "medium", timeStyle: "short" });
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="versionId" value={v.id} />
    </>
  );
  const rows: (Milestone | null)[] = v.canEdit ? [...v.milestones, ...Array(BLANK_ROWS).fill(null)] : v.milestones;

  return (
    <ProjectFrame dict={dict} base={`/${locale}/o/${orgId}`} project={project} can={can}>
      <p>
        <Link href={`/${locale}/o/${orgId}/projects/${projectId}/pricing`} className="text-sm text-gulf-strong underline underline-offset-4">{dict.dev.projects.nav.pricing}</Link>
      </p>
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-xl">{v.planName}</h2>
        <span className="text-ink-muted">{format(t.version, { n: v.version })}</span>
        <span className="text-sm text-ink-muted" dir="ltr">{v.currency}</span>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        {/* min-w-0: let wide tables scroll inside their own container instead of widening the page */}
        <div className="min-w-0 space-y-4">
          {v.canEdit ? (
            <ActionForm action={savePlanDraftAction} submitLabel={t.editor.save} pendingLabel={t.editor.saving}>
              {hidden}
              <input type="hidden" name="rows" value={rows.length} />
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={t.currency} name="currency" defaultValue={v.currency} required maxLength={3} pattern="[A-Za-z]{3}" dir="ltr" />
                <Field label={t.effectiveFrom} name="effectiveFrom" type="date" required defaultValue={v.effectiveFrom} />
                <Field label={t.effectiveTo} hint={t.effectiveToHint} name="effectiveTo" type="date" defaultValue={v.effectiveTo ?? ""} />
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">{pl.milestones}</legend>
                <p className="text-xs text-ink-muted">{pl.percentOrAmount}</p>
                {rows.map((m, i) => (
                  <MilestoneRow key={i} i={i} m={m} dict={dict} currency={v.currency} />
                ))}
              </fieldset>
              <label className="block">
                <span className="block text-sm font-medium">{pl.handoverTerms}</span>
                <textarea name="handoverTerms" defaultValue={v.handoverTerms ?? ""} maxLength={2000} rows={3} className="mt-1 block w-full rounded-control border border-line bg-surface px-3 py-2 text-sm" />
                <span className="mt-1 block text-xs text-ink-muted">{pl.handoverHint}</span>
              </label>
              <label className="block">
                <span className="block text-sm font-medium">{t.editor.notes}</span>
                <textarea name="notes" defaultValue={v.notes ?? ""} maxLength={1000} rows={2} className="mt-1 block w-full rounded-control border border-line bg-surface px-3 py-2 text-sm" />
              </label>
            </ActionForm>
          ) : (
            <ReadOnlyPlan dict={dict} v={v} locale={marketLocale} />
          )}
          <p className="text-sm">{format(pl.total, { n: v.percentTotal })}</p>
          <p className="text-xs text-ink-muted">{t.rulesNote}</p>
        </div>
        <VersionPanel dict={dict} v={v} hidden={hidden} canSubmit={v.canSubmit} canDecide={v.canDecide} isOwn={v.submittedBy === page.session.user.id}
          submitAction={submitPlanAction} decideAction={decidePlanAction} when={when} />
      </div>
    </ProjectFrame>
  );
}

function MilestoneRow({ i, m, dict, currency }: { i: number; m: Milestone | null; dict: Dictionary; currency: string }) {
  const pl = dict.dev.pricing.plan;
  const n = (k: string) => `m.${i}.${k}`;
  const input = "block w-full rounded-control border border-line bg-surface px-2 py-1.5 text-sm";
  return (
    <div className="grid gap-2 rounded-control border border-line p-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_repeat(3,minmax(0,1fr))_minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <label><span className="text-xs text-ink-muted">{pl.label}</span><input name={n("label")} defaultValue={m?.label ?? ""} maxLength={120} className={input} /></label>
      <label>
        <span className="text-xs text-ink-muted">{pl.trigger}</span>
        <select name={n("trigger")} defaultValue={m?.trigger ?? "on_booking"} className={input}>
          {MILESTONE_TRIGGERS.map((t) => <option key={t} value={t}>{pl.triggers[t]}</option>)}
        </select>
      </label>
      <label><span className="text-xs text-ink-muted">{pl.dueDate}</span><input type="date" name={n("dueDate")} defaultValue={m?.dueDate ?? ""} className={input} /></label>
      <label><span className="text-xs text-ink-muted">{pl.progress}</span><input name={n("progress")} inputMode="decimal" defaultValue={m?.progressPercent ?? ""} className={input} dir="ltr" /></label>
      <label><span className="text-xs text-ink-muted">{pl.months}</span><input type="number" min={1} max={120} name={n("months")} defaultValue={m?.monthsAfterHandover ?? ""} className={input} /></label>
      <label><span className="text-xs text-ink-muted">{pl.percent}</span><input name={n("percent")} inputMode="decimal" defaultValue={m?.percent ?? ""} className={input} dir="ltr" /></label>
      <label><span className="text-xs text-ink-muted">{pl.amount}</span><input name={n("amount")} inputMode="decimal" defaultValue={m?.amountMinor ? minorToInput(m.amountMinor, currency) : ""} className={input} dir="ltr" /></label>
    </div>
  );
}

function ReadOnlyPlan({ dict, v, locale }: { dict: Dictionary; v: Awaited<ReturnType<typeof getPlanVersion>>; locale: string }) {
  const pl = dict.dev.pricing.plan;
  const when = (m: Milestone) =>
    m.trigger === "on_date" ? `${pl.triggers.on_date}: ${day(m.dueDate, locale)}`
      : m.trigger === "construction_progress" ? `${pl.triggers.construction_progress}: ${m.progressPercent}%`
        : m.trigger === "after_handover" ? `${pl.triggers.after_handover}: ${m.monthsAfterHandover} ${pl.months}`
          : pl.triggers[m.trigger];
  return (
    <div className="space-y-4">
      {v.milestones.length === 0 ? (
        <p className="text-sm text-ink-muted">{pl.none}</p>
      ) : (
        <ol className="divide-y divide-line rounded-panel border border-line bg-surface text-sm">
          {v.milestones.map((m) => (
            <li key={m.seq} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <span><span className="font-medium">{m.label}</span><span className="block text-ink-muted">{when(m)}</span></span>
              <span className="tabular-nums">{m.percent ? `${m.percent}%` : money(m.amountMinor, v.currency, locale)}</span>
            </li>
          ))}
        </ol>
      )}
      {v.handoverTerms && (
        <div>
          <h3 className="text-sm font-medium">{pl.handoverTerms}</h3>
          <p className="mt-1 whitespace-pre-line text-sm" dir="auto">{v.handoverTerms}</p>
          <p className="mt-1 text-xs text-ink-muted">{pl.handoverHint}</p>
        </div>
      )}
    </div>
  );
}
