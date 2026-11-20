import { hasCapability, workspaceForOrgType } from "@baytline/core";
import { getIntegrationRegistry, type IntegrationStatus } from "@baytline/platform";
import { format } from "@/i18n/format";
import { checkSection, loadOrgPage } from "@/server/guards";
import { getDb } from "@/server/db";
import { getMarketsConfig, timeZoneOf } from "@/server/markets";
import { runIntegrationCheckAction, setIntegrationEnabledAction } from "@/server/actions/platform";
import { sectionLabel } from "@/lib/sections";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { ActionForm } from "@/components/forms/ActionForm";

const TONE: Record<IntegrationStatus, ChipTone> = {
  connected: "good",
  untested: "attention",
  stale: "attention",
  not_configured: "attention",
  development_only: "attention",
  failing: "problem",
  disabled: "muted",
  not_available: "muted",
};

/**
 * Integration registry. The server computes status from real facts (adapter exists,
 * secrets present, last check result); the browser only ever receives names and booleans.
 */
export default async function IntegrationsPage({ params }: { params: Promise<{ locale: string; orgId: string }> }) {
  const { locale, orgId } = await params;
  const page = await loadOrgPage(locale, orgId);
  const { allowed } = await checkSection(page, "integrations");
  const { dict } = page;
  const ws = dict.workspaces[workspaceForOrgType(page.ctx.org.type).id];
  const t = dict.integrations;
  const header = <SectionHeader eyebrow={page.ctx.org.name} title={sectionLabel(ws, "integrations")} intro={t.intro} />;
  if (!allowed) return <div className="space-y-10">{header}<AccessDenied dict={dict} orgName={page.ctx.org.name} /></div>;

  const canManage = hasCapability(page.ctx.principal, "platform.integrations.manage");
  const [items, markets] = await Promise.all([getIntegrationRegistry(getDb(), { userId: page.session.user.id, mfa: page.session.mfaVerified, orgId }), getMarketsConfig()]);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: timeZoneOf(markets, page.ctx.org.market) });
  const hidden = (key: string) => (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="key" value={key} />
    </>
  );

  return (
    <div className="space-y-8">
      {header}
      {!canManage && <p className="rounded-control border-s-4 border-gulf bg-surface px-3 py-2 text-sm">{dict.admin.readOnly}</p>}
      <ul className="space-y-4">
        {items.map((i) => {
          const p = t.providers[i.key as keyof typeof t.providers];
          return (
            <li key={i.key} className="rounded-panel border border-line bg-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg">{p?.name ?? i.key}</h2>
                  <p className="text-sm text-ink-muted">{p?.purpose}</p>
                </div>
                <Chip tone={TONE[i.status]}>{t.status[i.status]}</Chip>
              </div>
              <p className="mt-3 text-sm">{format(t.statusHelp[i.status], { n: i.milestone })}</p>

              <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <h3 className="text-xs text-ink-muted">{t.secrets}</h3>
                  {i.secrets.length === 0 ? (
                    <p className="mt-1 text-ink-muted">{t.noSecrets}</p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {i.secrets.map((s) => (
                        <li key={s.name} className="flex flex-wrap items-center gap-2">
                          <code dir="ltr" className="rounded-chip bg-surface-sunk px-1.5 py-0.5 text-xs">{s.name}</code>
                          <Chip tone={s.present ? "good" : "muted"}>{s.present ? t.present : t.missing}</Chip>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3 className="text-xs text-ink-muted">{t.lastCheck}</h3>
                  {i.lastCheck ? (
                    <p className="mt-1">
                      <Chip tone={i.lastCheck.ok ? "good" : "problem"}>{i.lastCheck.ok ? dict.audit.outcomes.success : dict.audit.outcomes.failure}</Chip>{" "}
                      {format(t.checkedBy, { date: date.format(i.lastCheck.at), name: i.lastCheck.byName ?? dict.audit.unknownUser })}
                      {i.lastCheck.latencyMs !== null && <span className="text-ink-muted"> ({i.lastCheck.latencyMs} ms)</span>}
                    </p>
                  ) : (
                    <p className="mt-1 text-ink-muted">{t.neverChecked}</p>
                  )}
                  {i.notes && <p className="mt-2 text-ink-muted" dir="auto">{i.notes}</p>}
                </div>
              </div>

              {canManage && (i.adapterAvailable || !i.enabled) && (
                <div className="mt-4 flex flex-wrap gap-3 border-t border-line pt-4">
                  {i.canCheck && (
                    <ActionForm action={runIntegrationCheckAction} layout="inline" submitLabel={t.runCheck} pendingLabel={t.checking}>
                      {hidden(i.key)}
                    </ActionForm>
                  )}
                  {!i.required && (
                    <ActionForm action={setIntegrationEnabledAction} layout="inline" variant="quiet" submitLabel={i.enabled ? t.turnOff : t.turnOn} pendingLabel={dict.team.saving}>
                      {hidden(i.key)}
                      <input type="hidden" name="enabled" value={i.enabled ? "false" : "true"} />
                    </ActionForm>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
