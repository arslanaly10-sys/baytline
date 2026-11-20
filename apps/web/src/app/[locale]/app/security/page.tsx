import Link from "next/link";
import { redirect } from "next/navigation";
import { getMfaStatus, listMyMemberships } from "@baytline/identity";
import { getDictionary } from "@/i18n";
import { format } from "@/i18n/format";
import { requireLocale, signInPath } from "@/server/guards";
import { getDb } from "@/server/db";
import { getSession, safeNext } from "@/server/session";
import { disableMfaAction } from "@/server/actions/security";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field } from "@/components/forms/Field";
import { Chip } from "@/components/ui/Chip";
import { BrandMark } from "@/components/ui/BrandMark";
import { MfaEnroll } from "@/components/security/MfaEnroll";
import { buttonClass } from "@/lib/button";

export const metadata = { title: "Two-step sign-in" };

export default async function SecurityPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ required?: string; next?: string; recovered?: string }> }) {
  const locale = requireLocale((await params).locale);
  const q = await searchParams;
  const session = await getSession();
  if (!session) redirect(signInPath(locale, `/${locale}/app/security`));
  const dict = await getDictionary(locale);
  const t = dict.sec.mfa;
  const [status, memberships] = await Promise.all([getMfaStatus(getDb(), session.user.id), listMyMemberships(getDb(), session.user.id)]);
  const staff = memberships.some((m) => m.type === "platform");
  const next = q.next ? safeNext(q.next, locale) : `/${locale}/app`;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-14">
      <header className="flex items-center gap-2.5 text-gulf">
        <BrandMark className="size-8" />
        <span className="text-xl font-medium tracking-tight text-ink">{dict.brand.name}</span>
      </header>
      <main id="main" className="mt-12 space-y-6">
        <div>
          <h1 className="flex flex-wrap items-center gap-3 font-display text-4xl leading-[1.1]">
            {t.title} <Chip tone={status.enrolled ? "good" : "muted"}>{status.enrolled ? t.statusOn : t.statusOff}</Chip>
          </h1>
          <p className="mt-3 max-w-[65ch] text-ink-muted">{t.intro}</p>
        </div>
        {q.required === "platform" && !status.enrolled && <p className="rounded-control border-s-4 border-saffron bg-surface px-3 py-2 text-sm">{t.required}</p>}
        {q.recovered && <p className="rounded-control border-s-4 border-saffron bg-surface px-3 py-2 text-sm">{format(dict.sec.verify.recoveryUsed, { n: q.recovered })}</p>}

        <section className="rounded-panel border border-line bg-surface p-5 sm:p-6">
          {!status.available ? (
            <p className="text-sm text-saffron">{t.unavailable}</p>
          ) : status.enrolled ? (
            <div className="space-y-4">
              <p className="text-sm">{t.done} {format(t.left, { n: status.recoveryCodesLeft })}</p>
              {staff ? <p className="text-sm text-ink-muted">{t.platformKeep}</p> : (
                <ActionForm action={disableMfaAction} submitLabel={t.disable} pendingLabel={t.confirming} variant="danger">
                  <input type="hidden" name="locale" value={locale} />
                  <Field label={t.codeLabel} name="code" inputMode="numeric" autoComplete="one-time-code" required dir="ltr" hint={t.disableHint} className="max-w-xs" />
                </ActionForm>
              )}
            </div>
          ) : (
            <MfaEnroll locale={locale} labels={t} />
          )}
        </section>
        <Link href={next} className={buttonClass("quiet")}>{t.back}</Link>
      </main>
    </div>
  );
}
