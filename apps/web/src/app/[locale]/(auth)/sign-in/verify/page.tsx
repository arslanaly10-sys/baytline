import { redirect } from "next/navigation";
import { getDictionary } from "@/i18n";
import { requireLocale, signInPath } from "@/server/guards";
import { getAnySession, safeNext } from "@/server/session";
import { verifyMfaAction } from "@/server/actions/security";
import { signOutAction } from "@/server/actions/auth";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field } from "@/components/forms/Field";

export const metadata = { title: "Enter your code" };

/** Second step of sign-in. Only a session that passed the password and still needs its code may see it. */
export default async function VerifyMfa({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ next?: string }> }) {
  const locale = requireLocale((await params).locale);
  const target = safeNext((await searchParams).next, locale);
  const s = await getAnySession();
  if (!s) redirect(signInPath(locale, target));
  if (!s.mfaPending) redirect(target);
  const dict = await getDictionary(locale);
  const t = dict.sec.verify;
  return (
    <div>
      <h1 className="font-display text-4xl leading-[1.05]">{t.title}</h1>
      <p className="mt-2 text-ink-muted">{t.intro}</p>
      <ActionForm action={verifyMfaAction} submitLabel={t.submit} pendingLabel={t.submitting} className="mt-8">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="next" value={target} />
        <Field label={t.code} name="code" autoComplete="one-time-code" inputMode="text" required autoFocus dir="ltr" maxLength={20} spellCheck={false} />
      </ActionForm>
      <form action={signOutAction} className="mt-6">
        <input type="hidden" name="locale" value={locale} />
        <button type="submit" className="text-sm text-gulf-strong underline underline-offset-4">{t.other}</button>
      </form>
    </div>
  );
}
