import Link from "next/link";
import { notFound } from "next/navigation";
import { hasCapability, LOCALES } from "@baytline/core";
import { IdentityError } from "@baytline/identity";
import { getMarketDetail, type MarketConfig } from "@baytline/platform";
import { format } from "@/i18n/format";
import { checkSection, loadOrgPage } from "@/server/guards";
import { getDb } from "@/server/db";
import { formattingLocale } from "@/server/markets";
import { updateMarketAction } from "@/server/actions/platform";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { Chip } from "@/components/ui/Chip";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, SelectField } from "@/components/forms/Field";
import { RulesPanel } from "@/components/platform/RulesPanel";

// A known Sunday, used only to name weekdays in the viewer's language.
const SUNDAY = Date.UTC(2026, 10, 15);
// Fixed example values for the formatting preview. Not data.
const SAMPLE_AMOUNT = 1234567.891;
const SAMPLE_DATE = new Date(Date.UTC(2026, 2, 15, 14, 30));

export default async function MarketDetail({ params }: { params: Promise<{ locale: string; orgId: string; code: string }> }) {
  const { locale, orgId, code } = await params;
  const page = await loadOrgPage(locale, orgId);
  const { allowed } = await checkSection(page, "markets");
  const { dict } = page;
  if (!allowed) return <AccessDenied dict={dict} orgName={page.ctx.org.name} />;

  const { market, rules } = await getMarketDetail(getDb(), { userId: page.session.user.id, mfa: page.session.mfaVerified, orgId }, code).catch((e) => {
    if (e instanceof IdentityError && e.code === "not_found") notFound();
    throw e;
  });
  const canEdit = hasCapability(page.ctx.principal, "platform.markets.configure");
  const t = dict.marketsAdmin;
  const weekday = new Intl.DateTimeFormat(page.locale, { weekday: "long", timeZone: "UTC" });
  const days = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ d, label: weekday.format(new Date(SUNDAY + d * 864e5)) }));

  const fields = (
            <fieldset disabled={!canEdit} className="space-y-4 disabled:opacity-80">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="orgId" value={orgId} />
              <input type="hidden" name="code" value={market.code} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t.nameEn} name="nameEn" defaultValue={market.name.en} required maxLength={80} lang="en" dir="ltr" />
                <Field label={t.nameAr} name="nameAr" defaultValue={market.name.ar} required maxLength={80} lang="ar" dir="rtl" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t.currency} hint={format(t.currencyDigits, { n: market.currencyDigits })} name="currency" defaultValue={market.currency} required pattern="[A-Za-z]{3}" maxLength={3} dir="ltr" />
                <Field label={t.timeZone} name="timeZone" defaultValue={market.timeZone} required maxLength={64} dir="ltr" />
              </div>
              <CheckGroup legend={t.weekend} name="weekendDays" options={days.map((x) => ({ value: String(x.d), label: x.label }))} checked={market.weekendDays.map(String)} />
              <CheckGroup
                legend={t.supportedLocales}
                name="supportedLocales"
                options={LOCALES.map((l) => ({ value: l.code, label: l.uiStatus === "enabled" ? l.nativeName : `${l.nativeName} (${t.uiPlanned})`, lang: l.code }))}
                checked={market.supportedLocales}
              />
              <div className="grid gap-4 sm:grid-cols-3">
                <SelectField label={t.defaultLocale} name="defaultLocale" defaultValue={market.defaultLocale} options={[{ value: "en", label: "English" }, { value: "ar", label: "العربية" }]} />
                <SelectField label={t.numbering} name="numberingSystem" defaultValue={market.numberingSystem} options={[{ value: "latn", label: t.numberingLatn }, { value: "arab", label: t.numberingArab }]} />
                <SelectField label={t.dateStyle} name="dateStyle" defaultValue={market.dateStyle} options={(["short", "medium", "long"] as const).map((v) => ({ value: v, label: t.dateStyles[v] }))} />
              </div>
              <SelectField label={t.marketStatus} name="status" defaultValue={market.status} options={[{ value: "enabled", label: t.status.enabled }, { value: "disabled", label: t.status.disabled }]} />
              <p className="-mt-2 text-xs text-ink-muted">{t.enabledHint}</p>
              <label className="block">
                <span className="block text-sm font-medium">{t.notes}</span>
                <textarea name="notes" defaultValue={market.notes ?? ""} maxLength={500} rows={3} className="mt-1 block w-full rounded-control border border-line bg-surface px-3 py-2 text-sm" />
              </label>
            </fieldset>
  );

  return (
    <div className="space-y-10">
      <p>
        <Link href={`/${locale}/o/${orgId}/markets`} className="text-sm text-gulf-strong underline underline-offset-4">{dict.workspaces.admin.sections.markets.label}</Link>
      </p>
      <SectionHeader eyebrow={market.code} title={market.name[page.locale]}>
        <Chip tone={market.status === "enabled" ? "good" : "muted"}>{t.status[market.status]}</Chip>
      </SectionHeader>
      <p className="text-sm text-ink-muted">
        {market.updatedAt && market.updatedByName
          ? format(dict.admin.updated, { date: new Intl.DateTimeFormat(page.locale, { dateStyle: "medium", timeStyle: "short", timeZone: market.timeZone }).format(market.updatedAt), name: market.updatedByName })
          : dict.admin.neverEdited}
      </p>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="settings" className="rounded-panel border border-line bg-surface p-5 sm:p-6">
          <h2 id="settings" className="sr-only">{t.save}</h2>
          {!canEdit && <p className="mb-4 rounded-control border-s-4 border-gulf px-3 py-2 text-sm">{dict.admin.readOnly}</p>}
          {canEdit ? (
            <ActionForm action={updateMarketAction} submitLabel={t.save} pendingLabel={t.saving}>
              {fields}
            </ActionForm>
          ) : (
            <div aria-disabled="true">{fields}</div>
          )}
        </section>

        <div className="space-y-8">
          <Preview market={market} locale={page.locale} t={t} />
          <p className="text-sm text-ink-muted">{t.seedNote}</p>
        </div>
      </div>

      <section aria-labelledby="rules">
        <h2 id="rules" className="text-lg">{t.rulesTitle}</h2>
        <p className="mt-1 max-w-[70ch] text-sm text-ink-muted">{t.rulesIntro}</p>
        <RulesPanel dict={dict} locale={page.locale} orgId={orgId} market={market} rules={rules} userId={page.session.user.id}
          canPropose={hasCapability(page.ctx.principal, "platform.market_rules.propose")} canApprove={hasCapability(page.ctx.principal, "platform.market_rules.approve")} />
      </section>
    </div>
  );
}

function CheckGroup({ legend, name, options, checked }: { legend: string; name: string; options: { value: string; label: string; lang?: string }[]; checked: string[] }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.value} lang={o.lang} className="inline-flex cursor-pointer items-center gap-2 rounded-control border border-line px-2.5 py-1.5 text-sm has-[:checked]:border-gulf has-[:checked]:bg-gulf-tint">
            <input type="checkbox" name={name} value={o.value} defaultChecked={checked.includes(o.value)} className="accent-[var(--gulf)]" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Shows how the saved settings render, in both interface languages. */
function Preview({ market, locale, t }: { market: MarketConfig; locale: "en" | "ar"; t: { preview: string; previewAmount: string; previewDate: string; previewNote: string } }) {
  const rows = (["en", "ar"] as const).map((l) => {
    const loc = formattingLocale(l, market);
    return {
      l,
      amount: new Intl.NumberFormat(loc, { style: "currency", currency: market.currency }).format(SAMPLE_AMOUNT),
      date: new Intl.DateTimeFormat(loc, { dateStyle: market.dateStyle, timeStyle: "short", timeZone: market.timeZone }).format(SAMPLE_DATE),
    };
  });
  return (
    <section aria-labelledby="preview" className="rounded-panel border border-dashed border-gulf p-5">
      <h2 id="preview" className="text-lg">{t.preview}</h2>
      <dl className="mt-4 space-y-4 text-sm">
        {rows.map((r) => (
          <div key={r.l} lang={r.l} dir={r.l === "ar" ? "rtl" : "ltr"} className={r.l === locale ? "" : "text-ink-muted"}>
            <dt className="text-xs">{t.previewAmount}</dt>
            <dd className="text-lg tabular-nums">{r.amount}</dd>
            <dt className="mt-1 text-xs">{t.previewDate}</dt>
            <dd>{r.date}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs text-ink-muted">{t.previewNote}</p>
    </section>
  );
}
