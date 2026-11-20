import Link from "next/link";
import { ChatCircleText, CalendarCheck } from "@phosphor-icons/react/dist/ssr";
import { APPOINTMENT_HORIZON_DAYS, type UiLocale } from "@baytline/core";
import type { Dictionary } from "@/i18n";
import { format } from "@/i18n/format";
import { getSession } from "@/server/session";
import { appointmentAction, enquiryAction } from "@/server/actions/customer";
import { CustomerForm } from "./CustomerForm";
import { SiteField, SiteSelect, SiteTextArea } from "./fields";

type Props = {
  dict: Dictionary;
  locale: UiLocale;
  listing: { kind: "project" | "rental"; id: string };
  /** Project pages offer "the whole project" or one of its published units. */
  units?: { id: string; label: string }[];
  preselectUnit?: string;
  back: string;
};

/** Enquiry and appointment request for one listing. Signed-out visitors are asked to sign in first. */
export async function AskPanel({ dict, locale, listing, units, preselectUnit, back }: Props) {
  const t = dict.cx;
  const session = await getSession();
  if (!session) {
    const next = encodeURIComponent(back);
    return (
      <section id="ask" aria-labelledby="ask-title" className="scroll-mt-24 rounded-3xl border border-hairline bg-night-2 p-6 sm:p-8">
        <h2 id="ask-title" className="font-display text-3xl text-sand">{t.ask.title}</h2>
        <p className="mt-3 max-w-[60ch] text-mist">{t.ask.signInPrompt}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href={`/${locale}/sign-in?next=${next}`} className="rounded-full bg-gold px-5 py-2.5 text-sm font-medium text-night hover:bg-gold-light">{t.ask.signIn}</Link>
          <Link href={`/${locale}/sign-up?next=${next}`} className="rounded-full border border-sand/30 px-5 py-2.5 text-sm text-sand hover:border-gold-light">{t.ask.signUp}</Link>
        </div>
      </section>
    );
  }
  const today = new Date().toISOString().slice(0, 10);
  const last = new Date(Date.now() + APPOINTMENT_HORIZON_DAYS * 86_400_000).toISOString().slice(0, 10);
  const methods = (["email", "phone", "whatsapp"] as const).map((m) => ({ value: m, label: t.ask.methods[m] }));
  const about = units?.length
    ? <SiteSelect label={t.ask.about} name="about" defaultValue={preselectUnit ? `unit:${preselectUnit}` : `project:${listing.id}`} options={[{ value: `project:${listing.id}`, label: t.ask.wholeProject }, ...units.map((u) => ({ value: `unit:${u.id}`, label: u.label }))]} className="sm:col-span-2" />
    : null;
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="listingKind" value={listing.kind} />
      <input type="hidden" name="listingId" value={listing.id} />
      <input type="hidden" name="back" value={back} />
    </>
  );
  const contactFields = (
    <>
      <SiteField label={t.ask.name} name="name" required maxLength={120} autoComplete="name" defaultValue={session.user.displayName} hint={format(t.ask.replyTo, { email: session.user.email })} />
      <SiteSelect label={t.ask.preferredContact} name="preferredContact" defaultValue="email" options={methods} />
      <SiteField label={t.ask.phone} name="phone" type="tel" dir="ltr" autoComplete="tel" maxLength={24} hint={t.ask.phoneHint} />
    </>
  );
  const consent = (
    <label className="flex items-start gap-3 text-sm text-mist sm:col-span-2">
      <input type="checkbox" name="consent" value="yes" required className="mt-0.5 size-4 accent-[var(--s-gold)]" />
      <span>{t.ask.consent}</span>
    </label>
  );
  return (
    <section id="ask" aria-label={t.ask.title} className="grid scroll-mt-24 gap-6 lg:grid-cols-2">
      <div className="rounded-3xl border border-hairline bg-night-2 p-6 sm:p-8">
        <h2 className="flex items-center gap-2.5 font-display text-3xl text-sand"><ChatCircleText aria-hidden="true" className="size-7 text-gold" />{t.ask.title}</h2>
        <p className="mt-2 text-sm text-mist">{t.ask.intro}</p>
        <CustomerForm action={enquiryAction} submitLabel={t.ask.submit} pendingLabel={t.ask.sending} successCta={t.ask.sentCta} className="mt-6">
          {hidden}
          <input type="hidden" name="source" value="listing_page" />
          <div className="grid gap-4 sm:grid-cols-2">
            {about}
            {contactFields}
            <SiteTextArea label={t.ask.message} name="message" maxLength={1000} className="sm:col-span-2" />
            {consent}
          </div>
        </CustomerForm>
      </div>
      <div className="rounded-3xl border border-hairline bg-night-2 p-6 sm:p-8">
        <h2 className="flex items-center gap-2.5 font-display text-3xl text-sand"><CalendarCheck aria-hidden="true" className="size-7 text-gold" />{t.book.title}</h2>
        <p className="mt-2 text-sm text-mist">{t.book.intro}</p>
        <CustomerForm action={appointmentAction} submitLabel={t.book.submit} pendingLabel={t.book.sending} successCta={t.book.sentCta} className="mt-6">
          {hidden}
          <div className="grid gap-4 sm:grid-cols-2">
            {about}
            <SiteSelect label={t.book.kind} name="kind" defaultValue="viewing" options={(["viewing", "consultation"] as const).map((k) => ({ value: k, label: t.book.kinds[k] }))} className="sm:col-span-2" />
            {[1, 2, 3].map((n) => (
              <fieldset key={n} className="grid grid-cols-2 gap-3 sm:col-span-2">
                <legend className="mb-1 text-sm text-sand/90">{format(t.book.slot, { n })}</legend>
                <SiteField label={t.book.date} name={`slot${n}Date`} type="date" min={today} max={last} required={n === 1} />
                <SiteSelect label={t.book.period} name={`slot${n}Period`} defaultValue={n === 1 ? "morning" : ""} options={[...(n === 1 ? [] : [{ value: "", label: "—" }]), ...(["morning", "afternoon", "evening"] as const).map((p) => ({ value: p, label: t.book.periods[p] }))]} />
              </fieldset>
            ))}
            {contactFields}
            <SiteTextArea label={t.book.note} name="note" maxLength={1000} className="sm:col-span-2" />
            {consent}
          </div>
        </CustomerForm>
      </div>
    </section>
  );
}
