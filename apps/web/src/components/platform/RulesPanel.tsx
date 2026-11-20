import type { MarketConfig, MarketRule, RuleValue } from "@baytline/platform";
import { RULE_PAYERS } from "@baytline/platform";
import type { Dictionary } from "@/i18n";
import { format } from "@/i18n/format";
import { ago } from "@/lib/homes-format";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, SelectField } from "@/components/forms/Field";
import { decideRuleAction, proposeRuleAction, withdrawRuleAction } from "@/server/actions/security";

const STATUS_TONE: Record<string, ChipTone> = { pending: "attention", approved: "good", rejected: "problem", withdrawn: "muted", superseded: "muted" };

function money(minor: string, currency: string, digits: number, locale: string) {
  const v = Number(minor) / 10 ** digits;
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}

function ValueLines({ v, dict, market, locale }: { v: RuleValue; dict: Dictionary; market: MarketConfig; locale: "en" | "ar" }) {
  const t = dict.sec.rules;
  return (
    <div className="space-y-1 text-sm">
      <p>{locale === "ar" && v.summaryAr ? v.summaryAr : v.summary}</p>
      <p className="flex flex-wrap gap-x-4 text-ink-muted tabular-nums">
        {v.ratePercent && <span>{t.rate}: {new Intl.NumberFormat(locale).format(Number(v.ratePercent))}%</span>}
        {v.fixedAmountMinor && v.currency && <span>{t.fixed}: {money(v.fixedAmountMinor, v.currency, market.currencyDigits, locale)}</span>}
        {v.payer && <span>{t.payer}: {t.payers[v.payer]}</span>}
      </p>
    </div>
  );
}

/** Market rules and fees: each change is proposed with its source and applies only after a second person approves. */
export function RulesPanel({ dict, locale, orgId, market, rules, userId, canPropose, canApprove }: {
  dict: Dictionary; locale: "en" | "ar"; orgId: string; market: MarketConfig; rules: MarketRule[]; userId: string; canPropose: boolean; canApprove: boolean;
}) {
  const t = dict.sec.rules;
  const m = dict.marketsAdmin;
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const hidden = <><input type="hidden" name="locale" value={locale} /><input type="hidden" name="orgId" value={orgId} /></>;
  return (
    <ul className="mt-4 space-y-3">
      {rules.map((r) => (
        <li key={r.category} className="rounded-panel border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">{m.categories[r.category]}</h3>
            <span className="flex gap-1.5">
              {r.status === "needs_setup" ? <Chip tone="attention">{m.needsSetup}</Chip> : <Chip tone="good">{m.configured}</Chip>}
              {r.pending && <Chip tone="attention">{t.pending}</Chip>}
            </span>
          </div>
          {r.value && (
            <div className="mt-3 border-s-2 border-mangrove ps-3">
              <ValueLines v={r.value} dict={dict} market={market} locale={locale} />
              <p className="mt-1 text-xs text-ink-muted">
                {r.effectiveFrom && format(t.effective, { date: day.format(new Date(`${r.effectiveFrom}T00:00:00Z`)) })}
                {r.sourceReference && <> · {t.source}: <bdi>{r.sourceReference}</bdi></>}
                {r.updatedAt && <> · {format(t.approvedBy, { name: r.updatedByName ?? "—", when: ago(r.updatedAt, locale) })}</>}
              </p>
            </div>
          )}
          {r.pending && (
            <div className="mt-3 space-y-2 rounded-control border border-saffron p-3">
              <ValueLines v={r.pending.value} dict={dict} market={market} locale={locale} />
              <p className="text-xs text-ink-muted">
                {format(t.effective, { date: day.format(new Date(`${r.pending.effectiveFrom}T00:00:00Z`)) })} · {t.source}: <bdi>{r.pending.sourceReference}</bdi> · {format(t.proposedBy, { name: r.pending.proposedByName ?? "—", when: ago(r.pending.proposedAt, locale) })}
              </p>
              {r.pending.proposedBy === userId ? (
                <div className="space-y-2">
                  <p className="text-xs text-ink-muted">{t.own}</p>
                  <ActionForm action={withdrawRuleAction} submitLabel={t.withdraw} pendingLabel={t.deciding} variant="quiet" layout="inline">
                    {hidden}<input type="hidden" name="changeId" value={r.pending.id} />
                  </ActionForm>
                </div>
              ) : canApprove && (
                <ActionForm action={decideRuleAction} submitLabel={t.approve} pendingLabel={t.deciding}>
                  {hidden}<input type="hidden" name="changeId" value={r.pending.id} />
                  <fieldset className="flex flex-wrap gap-4 text-sm">
                    <legend className="sr-only">{dict.sec.errors.decision}</legend>
                    <label className="flex items-center gap-2"><input type="radio" name="decision" value="approve" defaultChecked className="accent-[var(--gulf)]" />{t.approve}</label>
                    <label className="flex items-center gap-2"><input type="radio" name="decision" value="reject" className="accent-[var(--gulf)]" />{t.reject}</label>
                  </fieldset>
                  <Field label={t.note} name="note" maxLength={500} hint={t.noteHint} />
                </ActionForm>
              )}
            </div>
          )}
          {canPropose && !r.pending && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-gulf-strong">{r.value ? t.proposeNew : t.propose}</summary>
              <ActionForm action={proposeRuleAction} submitLabel={t.submit} pendingLabel={t.submitting} className="mt-3">
                {hidden}<input type="hidden" name="market" value={market.code} /><input type="hidden" name="category" value={r.category} />
                <label className="block">
                  <span className="block text-sm font-medium">{t.summary}</span>
                  <textarea name="summary" rows={2} required maxLength={500} className="mt-1 block w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-gulf" />
                </label>
                <label className="block">
                  <span className="block text-sm font-medium">{t.summaryAr}</span>
                  <textarea name="summaryAr" rows={2} maxLength={500} dir="rtl" lang="ar" className="mt-1 block w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-gulf" />
                </label>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label={t.rateLabel} name="ratePercent" inputMode="decimal" dir="ltr" />
                  <Field label={format(t.fixedLabel, { currency: market.currency })} name="fixedAmount" inputMode="decimal" dir="ltr" />
                  <SelectField label={t.payerLabel} name="payer" options={[{ value: "", label: "—" }, ...RULE_PAYERS.map((p) => ({ value: p, label: t.payers[p] }))]} />
                </div>
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
                  <Field label={t.sourceLabel} name="sourceReference" required minLength={3} maxLength={500} hint={t.sourceHint} />
                  <Field label={t.effectiveLabel} name="effectiveFrom" type="date" required />
                </div>
              </ActionForm>
            </details>
          )}
          {r.history.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-ink-muted">{t.history}</summary>
              <ul className="mt-2 space-y-2 text-xs">
                {r.history.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center gap-2">
                    <Chip tone={STATUS_TONE[h.status] ?? "muted"}>{t.statuses[h.status]}</Chip>
                    <span>{h.value.summary}</span>
                    <span className="text-ink-muted">{format(t.proposedBy, { name: h.proposedByName ?? "—", when: ago(h.proposedAt, locale) })}{h.decidedByName ? ` · ${h.decidedByName}` : ""}{h.decisionNote ? `: ${h.decisionNote}` : ""}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
