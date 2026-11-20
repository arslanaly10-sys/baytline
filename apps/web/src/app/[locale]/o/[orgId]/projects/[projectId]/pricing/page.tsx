import Link from "next/link";
import { listPlans, listPriceLists } from "@baytline/developer";
import { format } from "@/i18n/format";
import { actorOf, projectSection } from "@/server/dev-page";
import { getDb } from "@/server/db";
import { createPlanAction, createPlanVersionAction, createPriceListAction, createPriceVersionAction } from "@/server/actions/developer";
import { day } from "@/lib/dev-format";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field } from "@/components/forms/Field";
import { ProjectFrame, VersionChip } from "@/components/dev/parts";

export default async function ProjectPricing({ params }: { params: Promise<{ locale: string; orgId: string; projectId: string }> }) {
  const { locale, orgId, projectId } = await params;
  const { page, project, allowed, can, marketLocale } = await projectSection(locale, orgId, projectId, "price.view");
  if (!allowed) return <AccessDenied dict={page.dict} orgName={page.ctx.org.name} />;
  const { dict } = page;
  const t = dict.dev.pricing;
  const [lists, plans] = await Promise.all([listPriceLists(getDb(), actorOf(page), projectId), listPlans(getDb(), actorOf(page), projectId)]);
  const base = `/${locale}/o/${orgId}/projects/${projectId}/pricing`;
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="projectId" value={projectId} />
    </>
  );
  const today = new Date().toISOString().slice(0, 10);

  return (
    <ProjectFrame dict={dict} base={`/${locale}/o/${orgId}`} project={project} can={can}>
      <p className="max-w-[70ch] text-sm text-ink-muted">{t.intro}</p>
      <p className="max-w-[70ch] rounded-control border-s-4 border-saffron bg-surface px-3 py-2 text-sm">{t.rulesNote}</p>

      {[
        { key: "prices", title: t.lists, items: lists, empty: t.noLists, canDraft: can("price.change.request"), versionAction: createPriceVersionAction, idField: "listId", count: (v: { entryCount?: number }) => format(t.entries, { n: v.entryCount ?? 0 }) },
        { key: "plans", title: t.plans, items: plans, empty: t.noPlans, canDraft: can("payment_plan.manage"), versionAction: createPlanVersionAction, idField: "planId", count: (v: { milestoneCount?: number }) => format(t.milestonesCount, { n: v.milestoneCount ?? 0 }) },
      ].map((g) => (
        <section key={g.key} aria-labelledby={`h-${g.key}`} className="space-y-4">
          <h2 id={`h-${g.key}`} className="text-lg">{g.title}</h2>
          {g.items.length === 0 ? (
            <p className="rounded-panel border-2 border-dashed border-line px-6 py-6 text-center text-sm text-ink-muted">{g.empty}</p>
          ) : (
            g.items.map((item) => (
              <article key={item.id} className="rounded-panel border border-line bg-surface p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-medium">{item.name}</h3>
                  {"currency" in item && <span className="text-sm text-ink-muted" dir="ltr">{item.currency}</span>}
                </div>
                {item.versions.length > 0 && (
                  <ul className="mt-3 divide-y divide-line border-y border-line text-sm">
                    {item.versions.map((v) => (
                      <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                        <span className="flex flex-wrap items-center gap-2">
                          <Link href={`${base}/${g.key}/${v.id}`} className="font-medium text-gulf-strong underline-offset-4 hover:underline">{format(t.version, { n: v.version })}</Link>
                          <VersionChip status={v.status as never} dict={dict} />
                        </span>
                        <span className="text-ink-muted">
                          {day(v.effectiveFrom, marketLocale)}{v.effectiveTo ? ` – ${day(v.effectiveTo, marketLocale)}` : ""}. {g.count(v as never)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {g.canDraft && (
                  <ActionForm action={g.versionAction} layout="inline" variant="quiet" submitLabel={t.createVersion} pendingLabel={t.editor.saving} className="mt-4">
                    {hidden}
                    <input type="hidden" name={g.idField} value={item.id} />
                    <Field label={t.effectiveFrom} name="effectiveFrom" type="date" required defaultValue={today} />
                  </ActionForm>
                )}
              </article>
            ))
          )}
          {g.key === "prices" && can("price.change.request") && (
            <ActionForm action={createPriceListAction} layout="inline" submitLabel={t.createList} pendingLabel={t.editor.saving}>
              {hidden}
              <Field label={t.listName} name="name" required maxLength={120} />
              <Field label={t.currency} hint={t.currencyHint} name="currency" maxLength={3} pattern="[A-Za-z]{3}" className="w-32" dir="ltr" />
            </ActionForm>
          )}
          {g.key === "plans" && can("payment_plan.manage") && (
            <ActionForm action={createPlanAction} layout="inline" submitLabel={t.createPlan} pendingLabel={t.editor.saving}>
              {hidden}
              <Field label={t.planName} name="name" required maxLength={120} />
            </ActionForm>
          )}
        </section>
      ))}
    </ProjectFrame>
  );
}
