import Link from "next/link";
import { getPlatformAi, MODEL_IDS } from "@baytline/ai";
import { hasCapability } from "@baytline/core";
import { checkSection, loadOrgPage } from "@/server/guards";
import { getDb } from "@/server/db";
import { format } from "@/i18n/format";
import { usd, usdInput } from "@/lib/ai-format";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Chip } from "@/components/ui/Chip";
import { ActionForm } from "@/components/forms/ActionForm";
import { ConfirmAction } from "@/components/forms/ConfirmAction";
import { Field } from "@/components/forms/Field";
import { savePlatformAiAction, setOrgAiBlockedAction } from "@/server/actions/ai";

/** Platform AI limits and per-organization usage. Usage and cost only: platform staff never see request text. */
export default async function PlatformAiPage({ params }: { params: Promise<{ locale: string; orgId: string }> }) {
  const { locale, orgId } = await params;
  const page = await loadOrgPage(locale, orgId);
  const { allowed } = await checkSection(page, "ai-policies");
  const { dict } = page;
  if (!allowed || !hasCapability(page.ctx.principal, "platform.ai_policy.manage")) return <AccessDenied dict={dict} orgName={page.ctx.org.name} />;
  const v = await getPlatformAi(getDb(), { userId: page.session.user.id, orgId });
  const t = dict.ai.platform;
  const s = v.settings;
  const intl = page.locale;
  const hidden = <><input type="hidden" name="locale" value={page.locale} /><input type="hidden" name="orgId" value={orgId} /></>;

  return (
    <div className="space-y-10">
      <SectionHeader eyebrow={page.ctx.org.name} title={t.title} intro={t.intro} />

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="ai-provider" className="rounded-panel border border-line bg-surface p-5">
          <h2 id="ai-provider" className="text-lg">{t.provider.title}</h2>
          <p className={`mt-2 text-sm ${v.providerConfigured ? "text-mangrove" : "text-saffron"}`}>{v.providerConfigured ? t.provider.configured : t.provider.missing}</p>
          {!v.providerSwitchedOn && <p className="mt-1 text-sm text-saffron">{t.provider.switchedOff}</p>}
          <Link href={`/${page.locale}/o/${orgId}/integrations`} className="mt-2 inline-block text-sm text-gulf-strong underline underline-offset-4">{t.provider.check}</Link>
        </section>
        <section aria-labelledby="ai-spend" className="rounded-panel border border-line bg-surface p-5">
          <h2 id="ai-spend" className="text-lg">{dict.ai.usage.title}</h2>
          <p className="mt-2 text-xl tabular-nums">{format(t.spend, { spent: usd(v.spendMtdMicro, intl), cap: usd(s.platformMonthlyCapMicro, intl) })}</p>
          <p className="mt-1 text-xs text-ink-muted">{dict.ai.usage.note}</p>
        </section>
      </div>

      <section aria-labelledby="ai-settings" className="space-y-4">
        <h2 id="ai-settings" className="text-lg">{t.settings}</h2>
        <ActionForm action={savePlatformAiAction} submitLabel={t.save} pendingLabel={dict.ai.policy.saving} className="rounded-panel border border-line bg-surface p-5 sm:p-6">
          {hidden}
          <label className="flex items-start gap-2">
            <input type="checkbox" name="enabled" value="on" defaultChecked={s.enabled} className="mt-1 accent-[var(--gulf)]" />
            <span><span className="font-medium">{t.enabled}</span><span className="block text-xs text-ink-muted">{t.enabledHint}</span></span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset>
              <legend className="text-sm font-medium">{t.models}</legend>
              <div className="mt-2 space-y-1.5">
                {MODEL_IDS.map((m) => <label key={m} className="flex items-center gap-2 text-sm"><input type="checkbox" name="models" value={m} defaultChecked={s.allowedModels.includes(m)} className="accent-[var(--gulf)]" />{dict.ai.models[m]}</label>)}
              </div>
            </fieldset>
            <label className="block">
              <span className="block text-sm font-medium">{t.defaultModel}</span>
              <select name="defaultModel" defaultValue={s.defaultModel} className="mt-1 block w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink">
                {MODEL_IDS.map((m) => <option key={m} value={m}>{dict.ai.models[m]}</option>)}
              </select>
            </label>
            <Field label={t.ceiling} name="ceiling" inputMode="decimal" dir="ltr" defaultValue={usdInput(s.orgBudgetCeilingMicro)} />
            <Field label={t.cap} name="cap" inputMode="decimal" dir="ltr" defaultValue={usdInput(s.platformMonthlyCapMicro)} />
            <Field label={t.maxTokensCeiling} name="maxTokens" type="number" min={256} max={64000} defaultValue={s.maxOutputTokensCeiling} />
            <Field label={t.retention} name="retention" type="number" min={1} max={730} defaultValue={s.logRetentionDays} hint={t.retentionHint} />
          </div>
        </ActionForm>
      </section>

      <section aria-labelledby="ai-orgs" className="space-y-3">
        <h2 id="ai-orgs" className="text-lg">{t.orgs}</h2>
        {v.orgs.length === 0 ? <p className="text-sm text-ink-muted">{t.none}</p> : (
          <ul className="divide-y divide-line rounded-panel border border-line bg-surface text-sm">
            {v.orgs.map((o) => (
              <li key={o.orgId} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                <div>
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{o.orgName}</span>
                    <span className="text-ink-muted">{dict.orgTypes[o.orgType]}</span>
                    {o.platformBlocked ? <Chip tone="problem">{t.paused}</Chip> : <Chip tone={o.enabled ? "good" : "muted"}>{o.enabled ? t.on : t.off}</Chip>}
                  </p>
                  <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted tabular-nums">
                    <div><dt className="inline">{t.columns.budget}: </dt><dd className="inline">{usd(o.monthlyBudgetMicro, intl)}</dd></div>
                    <div><dt className="inline">{t.columns.cost}: </dt><dd className="inline">{usd(o.costMicro, intl)}</dd></div>
                    <div><dt className="inline">{t.columns.requests}: </dt><dd className="inline">{o.requests}</dd></div>
                    <div><dt className="inline">{t.columns.blocked}: </dt><dd className="inline">{o.blocked}</dd></div>
                  </dl>
                </div>
                {o.platformBlocked ? (
                  <ActionForm action={setOrgAiBlockedAction} submitLabel={t.unblock} pendingLabel={dict.ai.policy.saving} variant="quiet" layout="inline">
                    {hidden}<input type="hidden" name="targetOrgId" value={o.orgId} /><input type="hidden" name="blocked" value="no" />
                  </ActionForm>
                ) : (
                  <ConfirmAction trigger={t.block} hint={t.blockHint} confirmLabel={t.block} pendingLabel={dict.ai.policy.saving} action={setOrgAiBlockedAction}>
                    {hidden}<input type="hidden" name="targetOrgId" value={o.orgId} /><input type="hidden" name="blocked" value="yes" />
                    <Field label={t.blockNote} name="note" required maxLength={500} />
                  </ConfirmAction>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
