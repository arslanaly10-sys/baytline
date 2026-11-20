import Link from "next/link";
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";
import { PAYMENT_FREQUENCIES, type UiLocale } from "@baytline/core";
import type { RentalListingAdmin } from "@baytline/marketplace";
import type { Dictionary } from "@/i18n";
import { format } from "@/i18n/format";
import { confirmRentalAction, publishRentalAction, withdrawRentalAction } from "@/server/actions/listings";
import { moment } from "@/lib/homes-format";
import { Chip } from "@/components/ui/Chip";
import { ActionForm } from "@/components/forms/ActionForm";
import { ConfirmAction } from "@/components/forms/ConfirmAction";
import { Field, SelectField } from "@/components/forms/Field";
import { minorToInput } from "@/components/pm/parts";

export function RentalPanel({ l, dict, locale, orgId }: { l: RentalListingAdmin; dict: Dictionary; locale: UiLocale; orgId: string }) {
  const t = dict.cx.org.rental;
  const live = l.status === "published";
  const hidden = (<><input type="hidden" name="locale" value={locale} /><input type="hidden" name="orgId" value={orgId} /><input type="hidden" name="unitId" value={l.unitId} /></>);
  return (
    <section aria-labelledby="rental-title" className="rounded-panel border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="rental-title" className="text-lg">{t.title}</h2>
          <p className="mt-1 max-w-[70ch] text-sm text-ink-muted">{t.intro}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Chip tone={live && l.eligible ? "good" : "muted"}>{dict.cx.org.publish.status[l.status]}</Chip>
          {live && l.eligible && <Link href={`/${locale}/homes/rentals/${l.unitId}`} className="inline-flex items-center gap-1.5 text-sm text-gulf-strong underline underline-offset-4">{dict.cx.org.publish.viewPublic}<ArrowSquareOut aria-hidden="true" className="size-4" /></Link>}
        </div>
      </div>
      {live && l.confirmedAt && <p className="mt-3 text-sm text-ink-muted">{format(t.lastConfirmed, { name: l.confirmedByName ?? "—", when: moment(l.confirmedAt, locale) })}</p>}
      {live && !l.eligible && <p className="mt-3 rounded-control border-s-4 border-saffron bg-surface-sunk px-3 py-2 text-sm">{t.autoHidden}</p>}
      {l.isSample ? (
        <p className="mt-4 text-sm text-ink-muted">{dict.cx.org.errors.sample_not_publishable}</p>
      ) : !l.canPublish ? (
        <p className="mt-4 text-sm text-ink-muted">{dict.cx.org.publish.readOnly}</p>
      ) : !l.eligible ? (
        <p className="mt-4 text-sm text-ink-muted">{t.notEligible}</p>
      ) : (
        <div className="mt-5 space-y-5">
          <ActionForm action={publishRentalAction} submitLabel={live ? t.update : t.publish} pendingLabel={t.publishing}>
            {hidden}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label={`${t.rent} (${l.currency})`} name="rent" inputMode="decimal" required defaultValue={l.askingRentMinor ? minorToInput(l.askingRentMinor, l.currency) : ""} />
              <SelectField label={t.frequency} name="paymentFrequency" defaultValue={l.paymentFrequency ?? "annual"} options={PAYMENT_FREQUENCIES.map((f) => ({ value: f, label: dict.pm.frequencies[f] }))} />
              <Field label={t.availableFrom} name="availableFrom" type="date" defaultValue={l.availableFrom ?? ""} />
              <Field label={t.areaLabel} name="areaLabel" maxLength={120} defaultValue={l.areaLabel ?? ""} />
              <label className="block sm:col-span-2">
                <span className="block text-sm font-medium text-ink">{t.description}</span>
                <textarea name="description" maxLength={1000} rows={2} defaultValue={l.description ?? ""} className="mt-1 block w-full rounded-control border border-line bg-surface px-3 py-2 text-base text-ink" />
              </label>
            </div>
          </ActionForm>
          {live && (
            <div className="flex flex-wrap items-start gap-4 border-t border-line pt-5">
              <ActionForm action={confirmRentalAction} layout="inline" variant="quiet" submitLabel={t.confirm} pendingLabel={t.confirming}>{hidden}</ActionForm>
              <ConfirmAction action={withdrawRentalAction} trigger={t.withdraw} hint={t.withdrawHint} confirmLabel={t.withdraw} pendingLabel={t.publishing}>{hidden}</ConfirmAction>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
