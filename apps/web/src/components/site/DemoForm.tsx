"use client";

import { startTransition, useActionState, useRef } from "react";
import { useFieldError } from "@/components/forms/field-error";
import { IDLE } from "@/lib/form-state";
import { demoRequestAction } from "@/server/actions/site";

type Props = {
  locale: "en" | "ar";
  t: {
    name: string; email: string; phone: string; company: string; country: string; role: string;
    roles: Record<"developer" | "brokerage" | "property_manager" | "other", string>;
    consent: string; submit: string; sending: string; privacyLink: string;
  };
  markets: { code: string; name: string }[];
  privacyHref: string;
};

const field = "mt-1.5 block w-full rounded-xl border border-hairline bg-night px-3.5 py-2.5 text-sand placeholder:text-mist/60 focus:border-gold focus:outline-none";
const label = "block text-sm text-sand/90";

export function DemoForm({ locale, t, markets, privacyHref }: Props) {
  const [state, action, pending] = useActionState(demoRequestAction, IDLE);
  const ref = useRef<HTMLFormElement>(null);
  const errorId = useFieldError(ref, state);
  if (state.status === "success") {
    return (
      <p role="status" className="rounded-2xl border border-gold/40 bg-panel p-6 text-lg text-sand">
        {state.message}
      </p>
    );
  }
  return (
    <form
      ref={ref}
      action={action}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="grid gap-4 sm:grid-cols-2"
      aria-busy={pending}
    >
      <input type="hidden" name="locale" value={locale} />
      <div aria-hidden="true" className="absolute -start-[9999px] h-px w-px overflow-hidden">
        <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <label className={label}>{t.name}<input name="name" required maxLength={120} autoComplete="name" className={field} /></label>
      <label className={label}>{t.email}<input name="email" type="email" required maxLength={254} autoComplete="email" dir="ltr" className={field} /></label>
      <label className={label}>{t.phone}<input name="phone" type="tel" maxLength={32} autoComplete="tel" dir="ltr" className={field} /></label>
      <label className={label}>{t.company}<input name="company" required maxLength={160} autoComplete="organization" className={field} /></label>
      <label className={label}>{t.country}
        <select name="market" required defaultValue="" className={field}>
          <option value="" disabled>—</option>
          {markets.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
        </select>
      </label>
      <label className={label}>{t.role}
        <select name="orgType" required defaultValue="" className={field}>
          <option value="" disabled>—</option>
          {(Object.keys(t.roles) as (keyof Props["t"]["roles"])[]).map((k) => <option key={k} value={k}>{t.roles[k]}</option>)}
        </select>
      </label>
      <label className="flex items-start gap-3 text-sm text-mist sm:col-span-2">
        <input type="checkbox" name="consent" value="yes" required className="mt-0.5 size-4 accent-[var(--s-gold)]" />
        <span>{t.consent} <a href={privacyHref} aria-label={t.privacyLink} className="text-gold-light underline underline-offset-2"><span aria-hidden="true">↗</span></a></span>
      </label>
      <div className="sm:col-span-2">
        <button type="submit" disabled={pending} className="rounded-full bg-gold px-6 py-3 font-medium text-night hover:bg-gold-light disabled:opacity-60">
          {pending ? t.sending : t.submit}
        </button>
      </div>
      <div aria-live="polite" className="sm:col-span-2">
        {state.status === "error" && <p id={errorId} role="alert" className="rounded-xl border-s-4 border-red-400 bg-panel px-3 py-2 text-sm text-sand">{state.message}</p>}
      </div>
    </form>
  );
}
