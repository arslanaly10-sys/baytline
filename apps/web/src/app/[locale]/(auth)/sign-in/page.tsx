import Link from "next/link";
import { redirect } from "next/navigation";
import { getDictionary } from "@/i18n";
import { requireLocale } from "@/server/guards";
import { getSession, safeNext } from "@/server/session";
import { dbConfigured } from "@/server/db";
import { signInAction } from "@/server/actions/auth";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field } from "@/components/forms/Field";
import { StatePanel } from "@/components/ui/StatePanel";

export const metadata = { title: "Sign in" };

export default async function SignIn({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string; reset?: string }>;
}) {
  const locale = requireLocale((await params).locale);
  const { next, reset } = await searchParams;
  const dict = await getDictionary(locale);
  const target = safeNext(next, locale);
  if (!dbConfigured()) return <StatePanel tone="warning" title={dict.welcome.notConfiguredTitle} body={dict.welcome.notConfiguredBody} />;
  if (await getSession()) redirect(target);

  return (
    <div>
      <h1 className="text-2xl">{dict.auth.signInTitle}</h1>
      <p className="mt-2 text-ink-muted">{dict.auth.signInIntro}</p>
      {reset === "1" && <p className="mt-4 rounded-control border-s-4 border-mangrove bg-surface px-3 py-2 text-sm">{dict.auth.resetDone}</p>}
      <ActionForm action={signInAction} submitLabel={dict.auth.signIn} pendingLabel={dict.auth.signingIn} className="mt-8">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="next" value={target} />
        <Field label={dict.auth.email} name="email" type="email" autoComplete="username" required dir="ltr" />
        <Field label={dict.auth.password} name="password" type="password" autoComplete="current-password" required />
      </ActionForm>
      <div className="mt-6 space-y-2 text-sm">
        <p>
          <Link href={`/${locale}/forgot-password`} className="text-gulf-strong underline underline-offset-4">{dict.auth.forgot}</Link>
        </p>
        <p className="text-ink-muted">
          {dict.auth.newHere}{" "}
          <Link href={`/${locale}/sign-up`} className="text-gulf-strong underline underline-offset-4">{dict.auth.createCustomer}</Link>
        </p>
      </div>
    </div>
  );
}
