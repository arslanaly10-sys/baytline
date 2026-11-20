import Link from "next/link";
import { isPasswordResetTokenUsable, PASSWORD_MAX, PASSWORD_MIN } from "@baytline/identity";
import { getDictionary } from "@/i18n";
import { requireLocale } from "@/server/guards";
import { dbConfigured, getDb } from "@/server/db";
import { resetPasswordAction } from "@/server/actions/auth";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field } from "@/components/forms/Field";
import { StatePanel } from "@/components/ui/StatePanel";

export const metadata = { title: "Choose a new password", referrer: "no-referrer" };

export default async function ResetPassword({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const locale = requireLocale((await params).locale);
  const { token = "" } = await searchParams;
  const dict = await getDictionary(locale);
  if (!dbConfigured()) return <StatePanel tone="warning" title={dict.welcome.notConfiguredTitle} body={dict.welcome.notConfiguredBody} />;

  if (!(await isPasswordResetTokenUsable(getDb(), token))) {
    return (
      <div>
        <h1 className="font-display text-4xl leading-[1.05]">{dict.auth.resetTitle}</h1>
        <p className="mt-4 rounded-control border-s-4 border-coral bg-surface px-3 py-2 text-sm">{dict.auth.resetInvalid}</p>
        <p className="mt-6">
          <Link href={`/${locale}/forgot-password`} className="text-sm text-gulf-strong underline underline-offset-4">{dict.auth.forgotTitle}</Link>
        </p>
      </div>
    );
  }
  return (
    <div>
      <h1 className="font-display text-4xl leading-[1.05]">{dict.auth.resetTitle}</h1>
      <ActionForm action={resetPasswordAction} submitLabel={dict.auth.savePassword} pendingLabel={dict.auth.saving} className="mt-8">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="token" value={token} />
        <Field
          label={dict.auth.newPassword}
          hint={dict.auth.passwordHint}
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN}
          maxLength={PASSWORD_MAX}
        />
      </ActionForm>
    </div>
  );
}
