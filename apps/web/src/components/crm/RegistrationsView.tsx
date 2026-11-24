import Link from "next/link";
import type { Registration } from "@baytline/leads";
import type { Dictionary } from "@/i18n";
import { format } from "@/i18n/format";
import { ago, moment } from "@/lib/homes-format";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field } from "@/components/forms/Field";
import { decideRegistrationAction, withdrawRegistrationAction } from "@/server/actions/crm";

const TONE: Record<Registration["state"], ChipTone> = { submitted: "attention", protected: "good", expired: "muted", rejected: "problem", withdrawn: "muted" };

/** Both sides of client registration: the brokerage's list, and the developer's review queue. */
export function RegistrationsView({ dict, locale, orgId, base, items, side, canReview, canSubmit }: {
  dict: Dictionary; locale: "en" | "ar"; orgId: string; base: string; items: Registration[]; side: "brokerage" | "developer"; canReview: boolean; canSubmit: boolean;
}) {
  const t = dict.crm.registrations;
  if (!items.length) return <p className="rounded-panel border-2 border-dashed border-line px-6 py-10 text-center text-ink-muted">{t.empty}</p>;
  return (
    <ul className="space-y-3">
      {items.map((r) => {
        const hidden = <><input type="hidden" name="locale" value={locale} /><input type="hidden" name="orgId" value={orgId} /><input type="hidden" name="registrationId" value={r.id} /></>;
        return (
          <li key={r.id} className="rounded-panel border border-line bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium">{side === "brokerage" ? <Link href={`${base}/leads/${r.leadId}`} className="text-gulf-strong underline-offset-4 hover:underline">{r.clientName}</Link> : r.clientName}
                  {side === "developer" && <span className="ms-2 text-sm font-normal text-ink-muted" dir="ltr">{[r.emailMasked, r.phoneMasked].filter(Boolean).join(" · ")}</span>}
                </p>
                <p className="text-sm text-ink-muted">{r.projectName} · {side === "developer" ? format(t.by, { brokerage: r.brokerageName, when: ago(r.submittedAt, locale) }) : `${r.developerName ?? ""} · ${ago(r.submittedAt, locale)}`}</p>
                {r.note && <p className="mt-1 text-sm">{r.note}</p>}
                {r.decisionNote && <p className="mt-1 text-sm text-ink-muted">{r.decisionNote}</p>}
                {r.possibleDuplicates.length > 0 && (
                  <p className="mt-2 rounded-control border-s-4 border-saffron bg-surface-sunk px-3 py-1.5 text-sm">
                    {format(t.duplicates, { list: r.possibleDuplicates.map((d) => `${d.brokerageName} (${t.states[d.state]})`).join(locale === "ar" ? "، " : ", ") })}
                  </p>
                )}
              </div>
              <div className="text-end">
                <Chip tone={TONE[r.state]}>{t.states[r.state]}</Chip>
                {r.state === "protected" && r.protectedUntil && <p className="mt-1 text-xs text-ink-muted">{format(t.protectedUntil, { date: moment(r.protectedUntil, locale) })}</p>}
              </div>
            </div>
            {side === "developer" && canReview && r.state === "submitted" && (
              <ActionForm action={decideRegistrationAction} submitLabel={t.decide} pendingLabel={t.submitting} className="mt-3 border-t border-line pt-3">
                {hidden}
                <fieldset className="flex flex-wrap gap-4 text-sm">
                  <legend className="sr-only">{t.decide}</legend>
                  <label className="flex items-center gap-2"><input type="radio" name="decision" value="approve" defaultChecked className="accent-[var(--gulf)]" />{t.approve}</label>
                  <label className="flex items-center gap-2"><input type="radio" name="decision" value="reject" className="accent-[var(--gulf)]" />{t.reject}</label>
                </fieldset>
                <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
                  <Field label={t.days} name="days" type="number" min={1} max={365} defaultValue={90} />
                  <Field label={t.decisionNote} name="note" maxLength={500} hint={t.decisionNoteHint} />
                </div>
              </ActionForm>
            )}
            {side === "brokerage" && canSubmit && r.state === "submitted" && (
              <ActionForm action={withdrawRegistrationAction} submitLabel={t.withdraw} pendingLabel={t.submitting} variant="quiet" layout="inline" className="mt-3">{hidden}</ActionForm>
            )}
          </li>
        );
      })}
    </ul>
  );
}
