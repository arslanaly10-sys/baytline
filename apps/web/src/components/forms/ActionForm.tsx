"use client";

import { startTransition, useActionState, useRef } from "react";
import type { FormState } from "@/lib/form-state";
import { IDLE } from "@/lib/form-state";
import { buttonClass } from "@/lib/button";

type Props = {
  action: (prev: FormState, data: FormData) => Promise<FormState>;
  submitLabel: string;
  pendingLabel: string;
  children?: React.ReactNode;
  variant?: "primary" | "quiet" | "danger";
  layout?: "stack" | "inline";
  className?: string;
};

/**
 * Runs a server action and shows its result. Submits via onSubmit so React
 * doesn't reset the fields after an error (no retyping your email). Without
 * JavaScript, the form still posts to the server action.
 */
export function ActionForm({ action, submitLabel, pendingLabel, children, variant = "primary", layout = "stack", className = "" }: Props) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const ref = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={ref}
      action={formAction}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
      className={`${layout === "inline" ? "flex flex-wrap items-end gap-2" : "space-y-4"} ${className}`}
      aria-busy={pending}
    >
      {children}
      <div className={layout === "inline" ? "" : "pt-1"}>
        <button type="submit" disabled={pending} className={buttonClass(variant)}>
          {pending ? pendingLabel : submitLabel}
        </button>
      </div>
      <div aria-live="polite" className={layout === "inline" ? "basis-full" : ""}>
        {state.status === "error" && (
          <p role="alert" className="rounded-control border-s-4 border-coral bg-surface px-3 py-2 text-sm text-ink">
            {state.message}
          </p>
        )}
        {state.status === "success" && (
          <div className="rounded-control border-s-4 border-mangrove bg-surface px-3 py-2 text-sm text-ink">
            <p>{state.message}</p>
            {state.link && <CopyableLink url={state.link} />}
            {state.note && <p className="mt-1 text-ink-muted">{state.note}</p>}
          </div>
        )}
      </div>
    </form>
  );
}

function CopyableLink({ url }: { url: string }) {
  return (
    <input
      readOnly
      value={url}
      dir="ltr"
      onFocus={(e) => e.currentTarget.select()}
      aria-label={url}
      className="mt-2 w-full rounded-control border border-line bg-surface-sunk px-2 py-1.5 text-xs text-ink"
    />
  );
}
