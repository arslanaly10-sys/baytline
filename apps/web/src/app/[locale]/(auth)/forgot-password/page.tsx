import Link from "next/link";
import { getDictionary } from "@/i18n";
import { requireLocale } from "@/server/guards";
import { dbConfigured, getMailer } from "@/server/db";
import { forgotPasswordAction } from "@/server/actions/auth";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field } from "@/components/forms/Field";
import { StatePanel } from "@/components/ui/StatePanel";

export const metadata = { title: "Reset password" };

export default async function ForgotPassword({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const dict = await getDictionary(locale);
  if (!dbConfigured()) return <StatePanel tone="warning" title={dict.welcome.notConfiguredTitle} body={dict.welcome.notConfiguredBody} />;
  const back = (
    <Link href={`/${locale}/sign-in`} className="text-sm text-gulf-strong underline underline-offset-4">{dict.auth.backToSignIn}</Link>
  );

  // Say so up front instead of pretending to send email.
  if (!getMailer().configured) {
    return (
      <div>
        <h1 className="font-display text-4xl leading-[1.05]">{dict.auth.forgotTitle}</h1>
        <p className="mt-4 rounded-control border-s-4 border-saffron bg-surface px-3 py-2 text-sm">{dict.auth.resetUnavailable}</p>
        <p className="mt-6">{back}</p>
      </div>
    );
  }
  return (
    <div>
      <h1 className="font-display text-4xl leading-[1.05]">{dict.auth.forgotTitle}</h1>
      <p className="mt-2 text-ink-muted">{dict.auth.forgotIntro}</p>
      <ActionForm action={forgotPasswordAction} submitLabel={dict.auth.sendLink} pendingLabel={dict.auth.sending} className="mt-8">
        <input type="hidden" name="locale" value={locale} />
        <Field label={dict.auth.email} name="email" type="email" autoComplete="email" required dir="ltr" />
      </ActionForm>
      <p className="mt-6">{back}</p>
    </div>
  );
}
