import type { FormState } from "@/lib/form-state";
import { ActionForm } from "./ActionForm";

/** A two-step control for actions with wide effects: open, read the consequence, confirm. */
export function ConfirmAction({
  trigger,
  hint,
  confirmLabel,
  pendingLabel,
  action,
  children,
}: {
  trigger: string;
  hint: string;
  confirmLabel: string;
  pendingLabel: string;
  action: (prev: FormState, data: FormData) => Promise<FormState>;
  children: React.ReactNode;
}) {
  return (
    <details className="rounded-control border border-line bg-surface open:border-coral">
      <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium text-coral">{trigger}</summary>
      <div className="space-y-2 border-t border-line px-3 py-3">
        <p className="text-sm text-ink-muted">{hint}</p>
        <ActionForm action={action} variant="danger" layout="inline" submitLabel={confirmLabel} pendingLabel={pendingLabel}>
          {children}
        </ActionForm>
      </div>
    </details>
  );
}
