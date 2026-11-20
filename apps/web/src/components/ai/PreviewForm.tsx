"use client";

import { useActionState } from "react";
import type { AiPreview } from "@baytline/ai";
import { buttonClass } from "@/lib/button";
import { usd } from "@/lib/ai-format";
import { previewAiAction, type PreviewState } from "@/server/actions/ai";

type Labels = {
  feature: string; instruction: string; instructionHint: string; submit: string; checking: string; blocked: string; ok: string;
  system: string; prompt: string; redactions: string;
};

/** Dry run of the gateway for AI administrators: shows the decision and the redacted text. The model is never called. */
export function PreviewForm({ hidden, features, labels, reasons, levels, models }: {
  hidden: { locale: string; orgId: string };
  features: { value: string; label: string }[];
  labels: Labels;
  reasons: Record<string, string>;
  levels: Record<string, string>;
  models: Record<string, string>;
}) {
  const money = (micro: number) => usd(micro, hidden.locale);
  const [state, action, pending] = useActionState<PreviewState, FormData>(previewAiAction, { status: "idle" });
  const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? "");
  const p: AiPreview | null = state.status === "done" ? state.preview : null;
  const count = p?.ok ? Object.values(p.redactions).reduce((s, n) => s + (n ?? 0), 0) : 0;
  return (
    <form action={action} className="space-y-4" aria-busy={pending}>
      <input type="hidden" name="locale" value={hidden.locale} />
      <input type="hidden" name="orgId" value={hidden.orgId} />
      <label className="block">
        <span className="block text-sm font-medium">{labels.feature}</span>
        <select name="capability" className="mt-1 block w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink">
          {features.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="block text-sm font-medium">{labels.instruction}</span>
        <textarea name="instruction" rows={3} required maxLength={2000} aria-describedby="preview-hint"
          className="mt-1 block w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-gulf" />
        <span id="preview-hint" className="mt-1 block text-xs text-ink-muted">{labels.instructionHint}</span>
      </label>
      <button type="submit" disabled={pending} className={buttonClass("quiet")}>{pending ? labels.checking : labels.submit}</button>
      <div aria-live="polite">
        {state.status === "error" && <p role="alert" className="rounded-control border-s-4 border-coral bg-surface px-3 py-2 text-sm">{state.message}</p>}
        {p && !p.ok && <p className="rounded-control border-s-4 border-saffron bg-surface px-3 py-2 text-sm">{fill(labels.blocked, { reason: reasons[p.reason] ?? p.reason })}</p>}
        {p?.ok && (
          <div className="space-y-3 rounded-control border-s-4 border-mangrove bg-surface px-3 py-3 text-sm">
            <p>{fill(labels.ok, { level: levels[p.autonomy] ?? p.autonomy, model: models[p.model] ?? p.model, estimate: money(p.estimateMicro) })}</p>
            {count > 0 && <p className="text-ink-muted">{fill(labels.redactions, { n: String(count) })}</p>}
            <details><summary className="cursor-pointer text-gulf-strong">{labels.system}</summary><pre className="mt-2 whitespace-pre-wrap text-xs text-ink-muted" dir="ltr">{p.system}</pre></details>
            <div><p className="font-medium">{labels.prompt}</p><pre className="mt-1 whitespace-pre-wrap rounded-control bg-surface-sunk p-2 text-xs" dir="auto">{p.prompt}</pre></div>
          </div>
        )}
      </div>
    </form>
  );
}
