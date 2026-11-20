import Link from "next/link";
import { redirect } from "next/navigation";
import { PASSWORD_MAX, PASSWORD_MIN } from "@baytline/identity";
import { getDictionary } from "@/i18n";
import { requireLocale } from "@/server/guards";
import { getSession } from "@/server/session";
import { dbConfigured } from "@/server/db";
import { signUpAction } from "@/server/actions/auth";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field } from "@/components/forms/Field";
import { StatePanel } from "@/components/ui/StatePanel";

export const metadata = { title: "Create account" };

export default async function SignUp({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const dict = await getDictionary(locale);
  if (!dbConfigured()) return <StatePanel tone="warning" title={dict.welcome.notConfiguredTitle} body={dict.welcome.notConfiguredBody} />;
  if (await getSession()) redirect(`/${locale}/app`);

  return (
    <div>
      <h1 className="text-2xl">{dict.auth.createTitle}</h1>
      <p className="mt-2 text-ink-muted">{dict.auth.createIntro}</p>
      <ActionForm action={signUpAction} submitLabel={dict.auth.create} pendingLabel={dict.auth.creating} className="mt-8">
        <input type="hidden" name="locale" value={locale} />
        <Field label={dict.auth.displayName} name="displayName" autoComplete="name" required maxLength={120} />
        <Field label={dict.auth.email} name="email" type="email" autoComplete="email" required dir="ltr" />
        <Field
          label={dict.auth.password}
          hint={dict.auth.passwordHint}
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN}
          maxLength={PASSWORD_MAX}
        />
      </ActionForm>
      <p className="mt-6 text-sm text-ink-muted">
        {dict.auth.haveAccount}{" "}
        <Link href={`/${locale}/sign-in`} className="text-gulf-strong underline underline-offset-4">{dict.auth.signIn}</Link>
      </p>
    </div>
  );
}
