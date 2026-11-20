import type { VersionMeta } from "@baytline/developer";
import type { Dictionary } from "@/i18n";
import { format } from "@/i18n/format";
import type { FormState } from "@/lib/form-state";
import { ActionForm } from "@/components/forms/ActionForm";
import { VersionChip } from "./parts";

/** Who drafted, submitted and decided; plus submit or approve/reject controls when allowed. */
export function VersionPanel({
  dict,
  v,
  hidden,
  canSubmit,
  canDecide,
  isOwn,
  submitAction,
  decideAction,
  when,
}: {
  dict: Dictionary;
  v: VersionMeta;
  hidden: React.ReactNode;
  canSubmit: boolean;
  canDecide: boolean;
  isOwn: boolean;
  submitAction: (p: FormState, fd: FormData) => Promise<FormState>;
  decideAction: (p: FormState, fd: FormData) => Promise<FormState>;
  when: Intl.DateTimeFormat;
}) {
  const e = dict.dev.pricing.editor;
  return (
    <section aria-label={dict.dev.pricing.statuses[v.status]} className="space-y-3 rounded-panel border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center gap-2">
        <VersionChip status={v.status} dict={dict} />
        <span className="text-sm text-ink-muted">{format(e.draftedBy, { name: v.createdByName ?? "" })}</span>
      </div>
      {v.submittedAt && <p className="text-sm text-ink-muted">{format(e.submittedBy, { date: when.format(v.submittedAt), name: v.submittedByName ?? "" })}</p>}
      {v.decidedAt && (
        <p className="text-sm text-ink-muted">
          {format(e.decidedBy, { date: when.format(v.decidedAt), name: v.decidedByName ?? "" })}
          {v.decisionNote && <span className="mt-1 block text-ink" dir="auto">{v.decisionNote}</span>}
        </p>
      )}
      {v.status !== "draft" && <p className="text-sm">{e.locked}</p>}

      {canSubmit && (
        <div className="border-t border-line pt-3">
          <p className="mb-2 text-xs text-ink-muted">{e.submitHint}</p>
          <ActionForm action={submitAction} submitLabel={e.submit} pendingLabel={e.saving}>{hidden}</ActionForm>
        </div>
      )}
      {v.status === "submitted" && isOwn && <p className="border-t border-line pt-3 text-sm">{e.ownSubmission}</p>}
      {canDecide && (
        <div className="grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
          <ActionForm action={decideAction} submitLabel={e.approve} pendingLabel={e.deciding}>
            {hidden}
            <input type="hidden" name="decision" value="approve" />
            <label className="block">
              <span className="block text-sm font-medium">{e.decisionNote}</span>
              <textarea name="note" maxLength={500} rows={2} className="mt-1 block w-full rounded-control border border-line bg-surface px-3 py-2 text-sm" />
            </label>
          </ActionForm>
          <ActionForm action={decideAction} variant="danger" submitLabel={e.reject} pendingLabel={e.deciding}>
            {hidden}
            <input type="hidden" name="decision" value="reject" />
            <label className="block">
              <span className="block text-sm font-medium">{e.decisionNote}</span>
              <textarea name="note" maxLength={500} rows={2} required className="mt-1 block w-full rounded-control border border-line bg-surface px-3 py-2 text-sm" />
              <span className="mt-1 block text-xs text-ink-muted">{e.decisionNoteHint}</span>
            </label>
          </ActionForm>
        </div>
      )}
    </section>
  );
}
