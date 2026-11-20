"use client";

import Link from "next/link";
import { startTransition, useActionState, useRef } from "react";
import { CheckCircle } from "@phosphor-icons/react";
import { IDLE, type FormState } from "@/lib/form-state";
import { useFieldError } from "@/components/forms/field-error";

type Props = {
  action: (prev: FormState, data: FormData) => Promise<FormState>;
  submitLabel: string;
  pendingLabel: string;
  successCta?: string;
  children: React.ReactNode;
  className?: string;
};

/**
 * Customer-facing form on the dark site. On success it is replaced by a confirmation that says
 * exactly what happened and links to where the request can be followed.
 */
export function CustomerForm({ action, submitLabel, pendingLabel, successCta, children, className = "" }: Props) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const ref = useRef<HTMLFormElement>(null);
  const errorId = useFieldError(ref, state);
  if (state.status === "success") {
    return (
      <div role="status" className="rounded-2xl border border-gold/40 bg-panel p-5">
        <p className="flex items-start gap-2.5 text-sand"><CheckCircle aria-hidden="true" weight="fill" className="mt-0.5 size-5 shrink-0 text-gold" />{state.message}</p>
        {state.link && successCta && <Link href={state.link} className="mt-4 inline-block rounded-full bg-gold px-4 py-2 text-sm font-medium text-night hover:bg-gold-light">{successCta}</Link>}
      </div>
    );
  }
  return (
    <form
      ref={ref}
      action={formAction}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
      aria-busy={pending}
      className={`space-y-4 ${className}`}
    >
      {children}
      <button type="submit" disabled={pending} className="rounded-full bg-gold px-5 py-2.5 text-sm font-medium text-night hover:bg-gold-light disabled:opacity-60">
        {pending ? pendingLabel : submitLabel}
      </button>
      <div aria-live="polite">
        {state.status === "error" && <p id={errorId} role="alert" className="rounded-xl border-s-4 border-coral bg-panel px-3 py-2 text-sm text-sand">{state.message}</p>}
      </div>
    </form>
  );
}
