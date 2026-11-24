import Link from "next/link";
import { CalendarCheck, ChatCircleText, EnvelopeSimple, Phone, WhatsappLogo } from "@phosphor-icons/react/dist/ssr";
import { ENQUIRY_STATUSES, type UiLocale } from "@baytline/core";
import type { Inbox as InboxData, SupportQueueItem } from "@baytline/marketplace";
import type { Dictionary } from "@/i18n";
import { format } from "@/i18n/format";
import { calendarDay, moment } from "@/lib/homes-format";
import { answerSupportAction, confirmAppointmentAction, declineAppointmentAction, setEnquiryStatusAction } from "@/server/actions/listings";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { ActionForm } from "@/components/forms/ActionForm";
import { ConfirmAction } from "@/components/forms/ConfirmAction";
import { Field, SelectField } from "@/components/forms/Field";

const METHOD_ICON = { email: EnvelopeSimple, phone: Phone, whatsapp: WhatsappLogo } as const;
const ENQ_TONE = { new: "attention", in_progress: "neutral", closed: "muted" } as const satisfies Record<string, ChipTone>;
const APPT_TONE = { pending: "attention", confirmed: "good", declined: "muted", cancelled: "muted" } as const satisfies Record<string, ChipTone>;

export function InboxView({ data, dict, locale, orgId, base, status, sectionPath }: { data: InboxData; dict: Dictionary; locale: UiLocale; orgId: string; base: string; status?: string; sectionPath: string }) {
  const t = dict.cx.org.inbox;
  const hidden = (k: string, v: string) => (<><input type="hidden" name="locale" value={locale} /><input type="hidden" name="orgId" value={orgId} /><input type="hidden" name={k} value={v} /></>);
  const contact = (c: { contactName: string; contactEmail: string; contactPhone: string | null; preferredContact: "email" | "phone" | "whatsapp"; locale: string }) => {
    const Icon = METHOD_ICON[c.preferredContact];
    return (
      <div className="mt-3 grid gap-1 text-sm">
        <p className="font-medium">{c.contactName}</p>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-ink-muted">
          <bdi dir="ltr">{c.contactEmail}</bdi>
          {c.contactPhone && <bdi dir="ltr">{c.contactPhone}</bdi>}
          <span className="flex items-center gap-1"><Icon aria-hidden="true" className="size-4" />{format(t.replyBy, { method: dict.cx.ask.methods[c.preferredContact] })}</span>
          <span>{format(t.language, { lang: c.locale === "ar" ? "العربية" : "English" })}</span>
        </p>
      </div>
    );
  };
  return (
    <div className="space-y-10">
      <nav aria-label={t.show} className="flex gap-2 text-sm">
        {[["", t.open], ["all", t.all]].map(([v, label]) => (
          <Link key={v} href={`${base}/${sectionPath}${v ? `${sectionPath.includes("?") ? "&" : "?"}status=${v}` : ""}`} aria-current={(status ?? "") === v ? "page" : undefined}
            className={`rounded-control border px-3 py-1.5 ${(status ?? "") === v ? "border-gulf text-gulf-strong" : "border-line text-ink-muted hover:text-ink"}`}>{label}</Link>
        ))}
      </nav>
      {!data.canManage && !data.canConfirm && <p className="text-sm text-ink-muted">{t.readOnly}</p>}

      <section aria-labelledby="inbox-enq">
        <h2 id="inbox-enq" className="flex items-center gap-2 text-lg"><ChatCircleText aria-hidden="true" className="size-5 text-gulf" />{t.enquiries}</h2>
        {data.enquiries.length === 0 ? <p className="mt-3 rounded-panel border-2 border-dashed border-line px-6 py-8 text-center text-ink-muted">{t.noEnquiries}</p> : (
          <ul className="mt-4 space-y-3">
            {data.enquiries.map((e) => (
              <li key={e.id} className="rounded-panel border border-line bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="font-medium text-gulf-strong">{e.listingTitle}</p>
                  <Chip tone={ENQ_TONE[e.status]}>{t.statuses[e.status]}</Chip>
                </div>
                {contact(e)}
                {e.message && <p className="mt-3 whitespace-pre-line rounded-control bg-surface-sunk p-3 text-sm">{e.message}</p>}
                <p className="mt-3 text-xs text-ink-muted">{format(t.received, { when: moment(e.createdAt, locale, data.timeZone) })} · {format(t.via, { source: t.sources[e.source as keyof typeof t.sources] ?? e.source })} · {format(t.consent, { when: moment(e.consentAt, locale, data.timeZone) })}</p>
                {data.canManage && (
                  <ActionForm action={setEnquiryStatusAction} layout="inline" variant="quiet" submitLabel={t.save} pendingLabel={t.saving} className="mt-4">
                    {hidden("enquiryId", e.id)}
                    <SelectField label={t.status} name="status" defaultValue={e.status} options={ENQUIRY_STATUSES.map((s) => ({ value: s, label: t.statuses[s] }))} />
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="inbox-appt">
        <h2 id="inbox-appt" className="flex items-center gap-2 text-lg"><CalendarCheck aria-hidden="true" className="size-5 text-gulf" />{t.appointments}</h2>
        {data.appointments.length === 0 ? <p className="mt-3 rounded-panel border-2 border-dashed border-line px-6 py-8 text-center text-ink-muted">{t.noAppointments}</p> : (
          <ul className="mt-4 space-y-3">
            {data.appointments.map((a) => (
              <li key={a.id} className="rounded-panel border border-line bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="font-medium text-gulf-strong">{dict.cx.book.kinds[a.kind]} · {a.listingTitle}</p>
                  <Chip tone={APPT_TONE[a.status]}>{t.apptStatuses[a.status]}</Chip>
                </div>
                {contact(a)}
                <p className="mt-3 text-sm text-ink-muted">{t.preferred}:</p>
                <ul className="mt-1 flex flex-wrap gap-2 text-sm">{a.slots.map((s, i) => <li key={i} className="rounded-chip border border-line px-2 py-0.5">{calendarDay(s.date, locale)} · {dict.cx.book.periods[s.period]}</li>)}</ul>
                {a.note && <p className="mt-3 whitespace-pre-line rounded-control bg-surface-sunk p-3 text-sm">{a.note}</p>}
                {a.status === "confirmed" && a.confirmedFor && <p className="mt-3 text-sm text-mangrove">{format(t.confirmedFor, { when: moment(a.confirmedFor, locale, data.timeZone), name: a.decidedByName ?? "—" })}</p>}
                {a.orgNote && <p className="mt-1 text-sm text-ink-muted">{a.orgNote}</p>}
                <p className="mt-3 text-xs text-ink-muted">{format(t.received, { when: moment(a.createdAt, locale, data.timeZone) })}</p>
                {data.canConfirm && (a.status === "pending" || a.status === "confirmed") && (
                  <div className="mt-4 grid gap-4 border-t border-line pt-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                    <div>
                      <p className="text-sm font-medium">{t.confirmTitle}</p>
                      <p className="text-xs text-ink-muted">{t.confirmHint}</p>
                      <ActionForm action={confirmAppointmentAction} submitLabel={t.confirm} pendingLabel={t.confirming} className="mt-3">
                        {hidden("appointmentId", a.id)}
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field label={format(t.confirmAt, { tz: data.timeZone })} name="confirmedFor" type="datetime-local" required defaultValue={a.slots[0] ? `${a.slots[0].date}T${a.slots[0].period === "morning" ? "10" : a.slots[0].period === "afternoon" ? "15" : "19"}:00` : ""} />
                          <Field label={t.orgNote} name="orgNote" maxLength={500} />
                        </div>
                      </ActionForm>
                    </div>
                    <div className="self-end">
                      <ConfirmAction action={declineAppointmentAction} trigger={t.decline} hint={t.declineHint} confirmLabel={t.decline} pendingLabel={t.confirming}>
                        {hidden("appointmentId", a.id)}
                        <Field label={t.orgNote} name="orgNote" maxLength={500} />
                      </ConfirmAction>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function SupportQueue({ items, dict, locale, orgId }: { items: SupportQueueItem[]; dict: Dictionary; locale: UiLocale; orgId: string }) {
  const t = dict.cx.org.support;
  const my = dict.cx.my.support;
  if (!items.length) return <p className="rounded-panel border-2 border-dashed border-line px-6 py-10 text-center text-ink-muted">{t.empty}</p>;
  return (
    <ul className="space-y-3">
      {items.map((s) => (
        <li key={s.id} className="rounded-panel border border-line bg-surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="font-medium">{s.subject}</p>
            <Chip tone={s.status === "open" ? "attention" : s.status === "answered" ? "good" : "muted"}>{my.statuses[s.status as keyof typeof my.statuses]}</Chip>
          </div>
          <p className="mt-1 text-xs text-ink-muted">{my.topics[s.topic as keyof typeof my.topics]} · {moment(s.createdAt, locale)} · {s.locale === "ar" ? "العربية" : "English"}</p>
          <p className="mt-2 whitespace-pre-line text-sm">{s.message}</p>
          {s.response && <p className="mt-3 whitespace-pre-line rounded-control border-s-4 border-gulf bg-surface-sunk p-3 text-sm">{s.response}</p>}
          {s.status !== "closed" && (
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <ActionForm action={answerSupportAction} submitLabel={t.answer} pendingLabel={t.sending} className="flex-1">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="orgId" value={orgId} />
                <input type="hidden" name="requestId" value={s.id} />
                <label className="block">
                  <span className="block text-sm font-medium">{t.response}</span>
                  <textarea name="response" required maxLength={2000} rows={3} defaultValue={s.response ?? ""} className="mt-1 block w-full rounded-control border border-line bg-surface px-3 py-2 text-base text-ink" />
                </label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="close" value="yes" className="size-4" />{t.answerClose}</label>
              </ActionForm>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
