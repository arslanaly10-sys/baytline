import type { BrokerageOption, ShareRow } from "@baytline/developer";
import type { Dictionary } from "@/i18n";
import { format } from "@/i18n/format";
import { grantShareAction, revokeShareAction, updateShareAction } from "@/server/actions/developer";
import { Chip } from "@/components/ui/Chip";
import { ActionForm } from "@/components/forms/ActionForm";
import { ConfirmAction } from "@/components/forms/ConfirmAction";
import { SelectField } from "@/components/forms/Field";

type Props = {
  dict: Dictionary;
  locale: string;
  orgId: string;
  shares: ShareRow[];
  canManage: boolean;
  brokerages: BrokerageOption[];
  /** Projects that can be shared (sample projects are excluded by the caller and refused by the server). */
  projects: { id: string; name: string }[];
  groupBy: "brokerage" | "project";
};

function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="accent-[var(--gulf)]" />
      {label}
    </label>
  );
}

export function SharesPanel({ dict, locale, orgId, shares, canManage, brokerages, projects, groupBy }: Props) {
  const t = dict.dev.partners;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgId" value={orgId} />
    </>
  );
  const groups = new Map<string, ShareRow[]>();
  for (const s of shares) {
    const k = groupBy === "brokerage" ? s.brokerageName : s.projectName;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }

  return (
    <div className="space-y-8">
      <p className="max-w-[70ch] text-sm text-ink-muted">{t.intro}</p>
      {shares.length === 0 ? (
        <p className="rounded-panel border-2 border-dashed border-line px-6 py-8 text-center text-ink-muted">{t.none}</p>
      ) : (
        [...groups].map(([name, rows]) => (
          <section key={name} className="rounded-panel border border-line bg-surface">
            <h2 className="border-b border-line px-5 py-3 font-medium">{name}</h2>
            <ul className="divide-y divide-line">
              {rows.map((s) => (
                <li key={s.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                  <div>
                    <p className="font-medium">{groupBy === "brokerage" ? s.projectName : s.brokerageName}</p>
                    <p className="mt-1 flex flex-wrap gap-2">
                      <Chip tone="neutral">{t.baseAccess}</Chip>
                      {s.includePricing && <Chip tone="neutral">{t.includePricing}</Chip>}
                      {s.includeDocuments && <Chip tone="neutral">{t.includeDocuments}</Chip>}
                    </p>
                    <p className="mt-1 text-xs text-ink-muted">{format(t.sharedSince, { date: date.format(s.grantedAt), name: s.grantedByName ?? "" })}</p>
                  </div>
                  {canManage && (
                    <div className="flex flex-wrap items-start gap-3">
                      <ActionForm action={updateShareAction} layout="inline" variant="quiet" submitLabel={t.update} pendingLabel={dict.dev.projects.saving}>
                        {hidden}
                        <input type="hidden" name="shareId" value={s.id} />
                        <Check name="includePricing" label={t.includePricing} defaultChecked={s.includePricing} />
                        <Check name="includeDocuments" label={t.includeDocuments} defaultChecked={s.includeDocuments} />
                      </ActionForm>
                      <ConfirmAction action={revokeShareAction} trigger={t.revoke} hint={t.revokeHint} confirmLabel={t.revoke} pendingLabel={dict.dev.projects.saving}>
                        {hidden}
                        <input type="hidden" name="shareId" value={s.id} />
                      </ConfirmAction>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {canManage ? (
        brokerages.length === 0 ? (
          <p className="text-sm text-ink-muted">{t.noBrokerages}</p>
        ) : projects.length === 0 ? (
          <p className="text-sm text-ink-muted">{t.noProjects}</p>
        ) : (
          <section aria-labelledby="grant" className="rounded-panel border border-line bg-surface p-5 sm:p-6">
            <h2 id="grant" className="text-lg">{t.grantTitle}</h2>
            <ActionForm action={grantShareAction} submitLabel={t.grant} pendingLabel={dict.dev.projects.saving} className="mt-5">
              {hidden}
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField label={t.project} name="projectId" options={projects.map((p) => ({ value: p.id, label: p.name }))} />
                <SelectField label={t.brokerage} name="brokerageId" options={brokerages.map((b) => ({ value: b.id, label: b.name }))} />
              </div>
              <div className="flex flex-col gap-2">
                <Check name="includePricing" label={t.includePricing} />
                <Check name="includeDocuments" label={t.includeDocuments} />
              </div>
              <p className="text-xs text-ink-muted">{t.sampleNote}</p>
            </ActionForm>
          </section>
        )
      ) : (
        <p className="text-sm text-ink-muted">{dict.dev.readOnly}</p>
      )}
      <p className="text-xs text-ink-muted">{t.notBuilt}</p>
    </div>
  );
}
