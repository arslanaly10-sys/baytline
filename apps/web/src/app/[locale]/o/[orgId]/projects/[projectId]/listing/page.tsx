import Link from "next/link";
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";
import { getProjectPublication } from "@baytline/marketplace";
import { format } from "@/i18n/format";
import { actorOf, projectSection } from "@/server/dev-page";
import { getDb } from "@/server/db";
import { publishProjectAction, withdrawProjectAction } from "@/server/actions/listings";
import { moment } from "@/lib/homes-format";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { Chip } from "@/components/ui/Chip";
import { ActionForm } from "@/components/forms/ActionForm";
import { ConfirmAction } from "@/components/forms/ConfirmAction";
import { SelectField } from "@/components/forms/Field";
import { ProjectFrame } from "@/components/dev/parts";

/** Publishing is the explicit approval for public display; this page is where it happens. */
export default async function ProjectListingAdmin({ params }: { params: Promise<{ locale: string; orgId: string; projectId: string }> }) {
  const { locale, orgId, projectId } = await params;
  const { page, project, allowed, can } = await projectSection(locale, orgId, projectId, "project.view");
  if (!allowed) return <AccessDenied dict={page.dict} orgName={page.ctx.org.name} />;
  const { dict } = page;
  const t = dict.cx.org.publish;
  const pub = await getProjectPublication(getDb(), actorOf(page), projectId);
  const live = pub.status === "published";
  const hidden = (<><input type="hidden" name="locale" value={page.locale} /><input type="hidden" name="orgId" value={orgId} /><input type="hidden" name="projectId" value={projectId} /></>);
  const unitStatuses = dict.dev.units.statuses as Record<string, string>;

  return (
    <ProjectFrame dict={dict} base={`/${locale}/o/${orgId}`} project={project} can={can}>
      <section aria-labelledby="pub-title" className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="pub-title" className="text-lg">{t.title}</h2>
            <p className="mt-1 max-w-[70ch] text-sm text-ink-muted">{t.intro}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Chip tone={live ? "good" : "muted"}>{t.status[pub.status]}</Chip>
            {live && <Link href={`/${page.locale}/homes/projects/${projectId}`} className="inline-flex items-center gap-1.5 text-sm text-gulf-strong underline underline-offset-4">{t.viewPublic}<ArrowSquareOut aria-hidden="true" className="size-4" /></Link>}
          </div>
        </div>
        {pub.publishedAt && pub.publishedByName && <p className="text-sm text-ink-muted">{format(t.publishedBy, { name: pub.publishedByName, when: moment(pub.publishedAt, page.locale) })}</p>}
        {pub.isSample && <p className="rounded-control border-s-4 border-saffron bg-surface px-3 py-2 text-sm">{t.sampleNote}</p>}

        {pub.canPublish ? (
          <div className="rounded-panel border border-line bg-surface p-5 sm:p-6">
            <ActionForm action={publishProjectAction} submitLabel={live ? t.update : t.publish} pendingLabel={t.publishing}>
              {hidden}
              <fieldset>
                <legend className="text-sm font-medium">{t.units}</legend>
                <p className="mt-1 text-xs text-ink-muted">{t.unitsHint}</p>
                <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {pub.units.map((u) => {
                    const disabled = u.status === "draft" || u.isSample;
                    return (
                      <li key={u.id}>
                        <label className={`flex items-center gap-2 rounded-control border border-line px-3 py-2 text-sm ${disabled ? "opacity-60" : ""}`}>
                          <input type="checkbox" name="unitIds" value={u.id} defaultChecked={u.selected && !disabled} disabled={disabled} className="size-4" />
                          <span className="font-medium">{u.code}</span>
                          <span className="text-ink-muted">{unitStatuses[u.status] ?? u.status}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="showPrices" value="yes" defaultChecked={pub.showPrices} className="size-4" />{t.showPrices}</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="showPaymentPlans" value="yes" defaultChecked={pub.showPaymentPlans} className="size-4" />{t.showPlans}</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="showLocation" value="yes" defaultChecked={pub.showLocation} className="size-4" />{dict.loc.showLocation}</label>
              <div className="max-w-md">
                <SelectField label={t.route} name="routeBrokerageOrgId" defaultValue={pub.routeBrokerageOrgId ?? ""} options={[{ value: "", label: t.routeOwner }, ...pub.brokerages.map((b) => ({ value: b.id, label: b.name }))]} />
                <p className="mt-1 text-xs text-ink-muted">{t.routeHint}</p>
              </div>
            </ActionForm>
            {live && (
              <div className="mt-6 border-t border-line pt-5">
                <ConfirmAction action={withdrawProjectAction} trigger={t.withdraw} hint={t.withdrawHint} confirmLabel={t.withdraw} pendingLabel={t.publishing}>{hidden}</ConfirmAction>
              </div>
            )}
          </div>
        ) : (
          !pub.isSample && <p className="text-sm text-ink-muted">{t.readOnly}</p>
        )}
      </section>
    </ProjectFrame>
  );
}
