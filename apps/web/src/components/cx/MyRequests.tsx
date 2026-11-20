import Link from "next/link";
import { CalendarCheck, ChatCircleText, Lifebuoy } from "@phosphor-icons/react/dist/ssr";
import type { UiLocale } from "@baytline/core";
import type { MyAppointment, MyEnquiry, MySupportRequest } from "@baytline/marketplace";
import type { Dictionary } from "@/i18n";
import { format } from "@/i18n/format";
import { calendarDay, moment } from "@/lib/homes-format";
import { cancelAppointmentAction, supportAction } from "@/server/actions/customer";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { ActionForm } from "@/components/forms/ActionForm";
import { ConfirmAction } from "@/components/forms/ConfirmAction";
import { Field, SelectField } from "@/components/forms/Field";
import { SUPPORT_TOPICS } from "@baytline/core";

const Empty = ({ text, href, cta }: { text: string; href?: string; cta?: string }) => (
  <div className="rounded-panel border-2 border-dashed border-line px-6 py-10 text-center">
    <p className="text-ink-muted">{text}</p>
    {href && cta && <Link href={href} className="mt-4 inline-block rounded-control bg-gulf px-4 py-2 text-sm font-medium text-gulf-ink hover:bg-gulf-strong">{cta}</Link>}
  </div>
);

const ENQ_TONE: Record<MyEnquiry["status"], ChipTone> = { new: "neutral", in_progress: "attention", closed: "muted" };
const APPT_TONE: Record<MyAppointment["status"], ChipTone> = { pending: "attention", confirmed: "good", declined: "problem", cancelled: "muted" };
const SUP_TONE: Record<MySupportRequest["status"], ChipTone> = { open: "attention", answered: "good", closed: "muted" };

export function MyEnquiries({ items, dict, locale }: { items: MyEnquiry[]; dict: Dictionary; locale: UiLocale }) {
  const t = dict.cx.my.enquiries;
  if (!items.length) return <Empty text={t.empty} href={`/${locale}/homes`} cta={t.find} />;
  return (
    <ul className="space-y-3">
      {items.map((e) => {
        const href = e.listingRef.kind === "rental" ? `/${locale}/homes/rentals/${e.listingRef.rentalId}` : `/${locale}/homes/projects/${e.listingRef.projectId}${e.listingRef.unitId ? `?unit=${e.listingRef.unitId}` : ""}`;
        return (
          <li key={e.id} className="rounded-panel border border-line bg-surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="flex items-center gap-2 font-medium"><ChatCircleText aria-hidden="true" className="size-5 text-gulf" />{e.listingTitle}</p>
              <Chip tone={ENQ_TONE[e.status]}>{t.statuses[e.status]}</Chip>
            </div>
            {e.message && <p className="mt-2 whitespace-pre-line text-sm text-ink-muted">{e.message}</p>}
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
              <span>{format(t.sentOn, { when: moment(e.createdAt, locale) })}</span>
              <span>{format(t.contactBy, { method: dict.cx.ask.methods[e.preferredContact] })}</span>
              <Link href={href} className="text-gulf-strong underline underline-offset-4">{t.view}</Link>
            </p>
          </li>
        );
      })}
    </ul>
  );
}

export function MyAppointments({ items, dict, locale, orgId }: { items: MyAppointment[]; dict: Dictionary; locale: UiLocale; orgId: string }) {
  const t = dict.cx.my.appointments;
  if (!items.length) return <Empty text={t.empty} href={`/${locale}/homes`} cta={dict.cx.my.enquiries.find} />;
  return (
    <ul className="space-y-3">
      {items.map((a) => (
        <li key={a.id} className="rounded-panel border border-line bg-surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="flex items-center gap-2 font-medium"><CalendarCheck aria-hidden="true" className="size-5 text-gulf" />{dict.cx.book.kinds[a.kind]} · {a.listingTitle}</p>
            <Chip tone={APPT_TONE[a.status]}>{t.statuses[a.status]}</Chip>
          </div>
          {a.status === "confirmed" && a.confirmedFor && (
            <p className="mt-3 text-lg text-gulf-strong">{format(t.confirmedFor, { when: `${moment(a.confirmedFor, locale, a.timeZone ?? "UTC")}${a.timeZone ? ` (${a.timeZone.split("/")[1]?.replace("_", " ")})` : ""}` })}</p>
          )}
          {a.orgNote && <p className="mt-2 text-sm"><span className="text-ink-muted">{t.orgNote}: </span>{a.orgNote}</p>}
          <div className="mt-3 text-sm text-ink-muted">
            <p>{t.preferred}:</p>
            <ul className="mt-1 flex flex-wrap gap-2">
              {a.slots.map((s, i) => <li key={i} className="rounded-chip border border-line px-2 py-0.5">{calendarDay(s.date, locale)} · {dict.cx.book.periods[s.period]}</li>)}
            </ul>
            <p className="mt-2">{format(t.requested, { when: moment(a.createdAt, locale) })}</p>
          </div>
          {(a.status === "pending" || a.status === "confirmed") && (
            <div className="mt-4">
              <ConfirmAction action={cancelAppointmentAction} trigger={t.cancel} hint={t.cancelHint} confirmLabel={t.cancel} pendingLabel={t.cancelling}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="orgId" value={orgId} />
                <input type="hidden" name="appointmentId" value={a.id} />
              </ConfirmAction>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function MySupport({ items, enquiries, dict, locale, orgId }: { items: MySupportRequest[]; enquiries: MyEnquiry[]; dict: Dictionary; locale: UiLocale; orgId: string }) {
  const t = dict.cx.my.support;
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <section aria-labelledby="ask-help" className="rounded-panel border border-line bg-surface p-5 sm:p-6">
        <h2 id="ask-help" className="flex items-center gap-2 text-lg"><Lifebuoy aria-hidden="true" className="size-5 text-gulf" />{t.formTitle}</h2>
        <ActionForm action={supportAction} submitLabel={t.submit} pendingLabel={t.sending} className="mt-5">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="orgId" value={orgId} />
          <SelectField label={t.topic} name="topic" defaultValue="other" options={SUPPORT_TOPICS.map((x) => ({ value: x, label: t.topics[x] }))} />
          {enquiries.length > 0 && <SelectField label={t.related} name="relatedEnquiryId" defaultValue="" options={[{ value: "", label: t.none }, ...enquiries.map((e) => ({ value: e.id, label: e.listingTitle }))]} />}
          <Field label={t.subject} name="subject" required maxLength={160} />
          <label className="block">
            <span className="block text-sm font-medium text-ink">{t.message}</span>
            <textarea name="message" required maxLength={2000} rows={5} className="mt-1 block w-full rounded-control border border-line bg-surface px-3 py-2 text-base text-ink" />
          </label>
        </ActionForm>
      </section>
      <section aria-labelledby="my-help">
        <h2 id="my-help" className="text-lg">{t.listTitle}</h2>
        {items.length === 0 ? <p className="mt-3 text-sm text-ink-muted">{t.empty}</p> : (
          <ul className="mt-3 space-y-3">
            {items.map((s) => (
              <li key={s.id} className="rounded-panel border border-line bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="font-medium">{s.subject}</p>
                  <Chip tone={SUP_TONE[s.status]}>{t.statuses[s.status]}</Chip>
                </div>
                <p className="mt-1 text-xs text-ink-muted">{t.topics[s.topic]} · {moment(s.createdAt, locale)}</p>
                <p className="mt-2 whitespace-pre-line text-sm text-ink-muted">{s.message}</p>
                {s.response && (
                  <div className="mt-3 rounded-control border-s-4 border-gulf bg-surface-sunk p-3 text-sm">
                    <p className="text-xs text-ink-muted">{t.reply}{s.respondedAt ? ` · ${moment(s.respondedAt, locale)}` : ""}</p>
                    <p className="mt-1 whitespace-pre-line">{s.response}</p>
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
