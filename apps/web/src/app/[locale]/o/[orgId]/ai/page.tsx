import Link from "next/link";
import { getOrgAiPolicy, listAiRequests, type AiRequestRow } from "@baytline/ai";
import { checkSection, loadOrgPage } from "@/server/guards";
import { getDb } from "@/server/db";
import { format } from "@/i18n/format";
import { moment } from "@/lib/homes-format";
import { usd, usdInput } from "@/lib/ai-format";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field } from "@/components/forms/Field";
import { PreviewForm } from "@/components/ai/PreviewForm";
import { saveOrgAiPolicyAction } from "@/server/actions/ai";
import type { Dictionary } from "@/i18n";

const STATUS_TONE: Record<string, ChipTone> = { reserved: "neutral", succeeded: "good", refused: "attention", failed: "problem", blocked: "muted" };

export default async function OrgAiPage({ params, searchParams }: { params: Promise<{ locale: string; orgId: string }>; searchParams: Promise<{ status?: string; before?: string }> }) {
  const { locale, orgId } = await params;
  const q = await searchParams;
  const page = await loadOrgPage(locale, orgId);
  const { allowed, section } = await checkSection(page, "ai");
  const { dict } = page;
  if (!allowed) return <AccessDenied dict={dict} orgName={page.ctx.org.name} />;
  const actor = { userId: page.session.user.id, orgId };
  const [view, log] = await Promise.all([getOrgAiPolicy(getDb(), actor), listAiRequests(getDb(), actor, { status: q.status, before: q.before })]);
  const t = dict.ai;
  const site = dict.site.ai;
  const capName = (id: string) => (site.capabilities as Record<string, { name: string }>)[id]?.name ?? id;
  const levelName = (l: string) => (dict.site.control.levels as Record<string, { name: string }>)[l]?.name ?? l;
  const p = view.policy;
  const intl = page.locale;
  const base = `/${page.locale}/o/${orgId}/ai`;
  const byCategory = [...new Set(view.capabilities.map((c) => c.category))].map((cat) => [cat, view.capabilities.filter((c) => c.category === cat)] as const);

  return (
    <div className="space-y-10">
      <SectionHeader eyebrow={page.ctx.org.name} title={t.title} intro={t.intro} />
      <p className="rounded-control border border-line bg-surface-sunk px-4 py-3 text-sm text-ink-muted">{t.notice}</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="ai-state" className="rounded-panel border border-line bg-surface p-5">
          <h2 id="ai-state" className="text-lg">{t.state.title}</h2>
          {view.blockers.length === 0 ? <p className="mt-2 text-sm text-mangrove">{t.state.ready}</p> : (
            <ul className="mt-2 list-disc space-y-1 ps-5 text-sm">
              {view.blockers.map((b) => <li key={b}>{(t.state.blockers as Record<string, string>)[b] ?? b}</li>)}
            </ul>
          )}
          {p.platformBlocked && p.platformNote && <p className="mt-2 text-sm text-ink-muted">{p.platformNote}</p>}
        </section>
        <section aria-labelledby="ai-usage" className="rounded-panel border border-line bg-surface p-5">
          <h2 id="ai-usage" className="text-lg">{t.usage.title}</h2>
          <p className="mt-2 text-2xl tabular-nums">{format(t.usage.spent, { spent: usd(view.spendMtdMicro, intl), budget: usd(p.monthlyBudgetMicro, intl) })}</p>
          <p className="mt-1 text-xs text-ink-muted">{t.usage.note}</p>
        </section>
      </div>

      <section aria-labelledby="ai-policy" className="space-y-4">
        <h2 id="ai-policy" className="text-lg">{t.policy.title}</h2>
        <ActionForm action={saveOrgAiPolicyAction} submitLabel={t.policy.save} pendingLabel={t.policy.saving} className="rounded-panel border border-line bg-surface p-5 sm:p-6">
          <input type="hidden" name="locale" value={page.locale} />
          <input type="hidden" name="orgId" value={orgId} />
          <label className="flex items-start gap-2">
            <input type="checkbox" name="enabled" value="on" defaultChecked={p.enabled} disabled={p.platformBlocked} className="mt-1 accent-[var(--gulf)]" />
            <span><span className="font-medium">{t.policy.enabled}</span><span className="block text-xs text-ink-muted">{t.policy.enabledHint}</span></span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset>
              <legend className="text-sm font-medium">{t.policy.models}</legend>
              <div className="mt-2 space-y-1.5">
                {view.platform.allowedModels.map((m) => (
                  <label key={m} className="flex items-center gap-2 text-sm"><input type="checkbox" name="models" value={m} defaultChecked={p.allowedModels.includes(m)} className="accent-[var(--gulf)]" />{t.models[m]}</label>
                ))}
              </div>
              <p className="mt-1 text-xs text-ink-muted">{t.policy.modelsHint}</p>
            </fieldset>
            <label className="block">
              <span className="block text-sm font-medium">{t.policy.defaultModel}</span>
              <select name="defaultModel" defaultValue={p.defaultModel ?? ""} className="mt-1 block w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink">
                <option value="">—</option>
                {view.platform.allowedModels.map((m) => <option key={m} value={m}>{t.models[m]}</option>)}
              </select>
            </label>
            <Field label={t.policy.budget} name="budget" inputMode="decimal" dir="ltr" defaultValue={usdInput(p.monthlyBudgetMicro)}
              hint={format(t.policy.budgetHint, { ceiling: usd(view.platform.orgBudgetCeilingMicro, intl) })} />
            <Field label={t.policy.maxTokens} name="maxTokens" type="number" min={256} max={view.platform.maxOutputTokensCeiling} defaultValue={p.maxOutputTokens}
              hint={format(t.policy.maxTokensHint, { ceiling: view.platform.maxOutputTokensCeiling })} />
          </div>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="storeText" value="on" defaultChecked={p.storeText} className="mt-1 accent-[var(--gulf)]" />
            <span><span className="text-sm font-medium">{t.policy.storeText}</span><span className="block text-xs text-ink-muted">{t.policy.storeTextHint}</span></span>
          </label>

          <fieldset className="space-y-4 border-t border-line pt-5">
            <legend className="text-base font-medium">{t.caps.title}</legend>
            <p className="text-sm text-ink-muted">{t.caps.intro}</p>
            {byCategory.map(([cat, caps]) => (
              <div key={cat}>
                <h3 className="text-sm font-medium text-gold">{(site.categories as Record<string, string>)[cat] ?? cat}</h3>
                <ul className="mt-2 divide-y divide-line rounded-control border border-line">
                  {caps.map((c) => (
                    <li key={c.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-start">
                      <div>
                        <p className="font-medium">{capName(c.id)}</p>
                        <p className="text-xs text-ink-muted">{format(t.caps.upTo, { level: levelName(c.maxAutonomy) })}{c.bindingSteps.length ? ` · ${t.caps.binding}` : ""}</p>
                        {c.missing.length > 0 && <p className="mt-1 text-xs text-saffron">{format(t.caps.waiting, { list: c.missing.map((d) => (t.deps as Record<string, string>)[d] ?? d).join(page.locale === "ar" ? "، " : ", ") })}</p>}
                        {c.guardrails.length > 0 && (
                          <p className="mt-1 flex flex-wrap gap-1">{c.guardrails.map((g) => <Chip key={g} tone="muted">{(t.guardrails as Record<string, string>)[g] ?? g}</Chip>)}</p>
                        )}
                      </div>
                      <label className="block">
                        <span className="sr-only">{format(t.caps.level, { name: capName(c.id) })}</span>
                        <select name={`level_${c.id}`} defaultValue={c.level} className="block w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink">
                          {c.levels.map((l) => <option key={l} value={l}>{levelName(l)}</option>)}
                        </select>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </fieldset>
        </ActionForm>
      </section>

      <section aria-labelledby="ai-preview" className="rounded-panel border border-line bg-surface p-5 sm:p-6">
        <h2 id="ai-preview" className="text-lg">{t.preview.title}</h2>
        <p className="mt-1 max-w-[75ch] text-sm text-ink-muted">{t.preview.intro}</p>
        <div className="mt-4">
          <PreviewForm hidden={{ locale: page.locale, orgId }} features={view.capabilities.map((c) => ({ value: c.id, label: capName(c.id) }))}
            labels={{ ...t.preview, redactions: t.log.redactions }} reasons={t.log.reasons} levels={Object.fromEntries(Object.entries(dict.site.control.levels).map(([k, v]) => [k, v.name]))}
            models={t.models} />
        </div>
      </section>

      <RequestLog dict={dict} log={log} base={base} locale={page.locale} filter={q.status} capName={capName} levelName={levelName} />
    </div>
  );
}

function RequestLog({ dict, log, base, locale, filter, capName, levelName }: {
  dict: Dictionary; log: AiRequestRow[]; base: string; locale: "en" | "ar"; filter?: string; capName: (id: string) => string; levelName: (l: string) => string;
}) {
  const t = dict.ai.log;
  const statuses = ["succeeded", "blocked", "failed", "refused"] as const;
  const last = log.at(-1);
  return (
    <section aria-labelledby="ai-log" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="ai-log" className="text-lg">{t.title}</h2>
        <nav aria-label={t.title} className="flex flex-wrap gap-3 text-sm">
          <Link href={base} aria-current={!filter ? "page" : undefined} className="underline-offset-4 aria-[current=page]:font-medium aria-[current=page]:underline">{t.filterAll}</Link>
          {statuses.map((s) => <Link key={s} href={`${base}?status=${s}`} aria-current={filter === s ? "page" : undefined} className="underline-offset-4 aria-[current=page]:font-medium aria-[current=page]:underline">{t.status[s]}</Link>)}
        </nav>
      </div>
      <p className="max-w-[75ch] text-sm text-ink-muted">{t.intro}</p>
      {log.length === 0 ? <p className="rounded-panel border-2 border-dashed border-line px-6 py-10 text-center text-ink-muted">{t.empty}</p> : (
        <ul className="divide-y divide-line rounded-panel border border-line bg-surface text-sm">
          {log.map((r) => {
            const n = Object.values(r.redactions).reduce<number>((s, v) => s + (typeof v === "number" ? v : Object.values(v as Record<string, number>).reduce((a, b) => a + b, 0)), 0);
            return (
              <li key={r.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <Chip tone={STATUS_TONE[r.status] ?? "muted"}>{t.status[r.status as keyof typeof t.status] ?? r.status}</Chip>
                    <span className="font-medium">{capName(r.capability)}</span>
                    {r.autonomy && r.autonomy !== "off" && <span className="text-ink-muted">· {levelName(r.autonomy)}</span>}
                    {r.blockReason && <span className="text-ink-muted">· {(t.reasons as Record<string, string>)[r.blockReason] ?? r.blockReason}</span>}
                  </span>
                  <span className="text-ink-muted">{moment(r.createdAt, locale)}{r.userName ? ` · ${r.userName}` : ""}</span>
                </div>
                {r.status !== "blocked" && (
                  <p className="mt-1 text-xs text-ink-muted tabular-nums">
                    {r.model ? dict.ai.models[r.model as keyof typeof dict.ai.models] ?? r.model : ""}
                    {r.servedModel && r.servedModel !== r.model ? ` (${format(t.served, { model: r.servedModel })})` : ""}
                    {` · ${usd(r.costMicro, locale)}`}
                    {r.inputTokens != null ? ` · ${r.inputTokens} / ${r.outputTokens} ${t.columns.tokens}` : ""}
                  </p>
                )}
                {r.status !== "blocked" && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-gulf-strong">{t.details}</summary>
                    <div className="mt-2 space-y-2 text-xs">
                      {n > 0 && <p>{format(t.redactions, { n })}</p>}
                      {r.grounding.length > 0 && <p>{format(t.grounding, { n: r.grounding.length })}: {r.grounding.map((g) => `${g.kind} (${g.label})`).join(", ")}</p>}
                      {r.rejectedFacts > 0 && <p>{format(t.rejected, { n: r.rejectedFacts })}</p>}
                      {r.prompt === null && r.response === null ? <p className="text-ink-muted">{t.textOff}</p> : (
                        <>
                          {r.prompt && <div><p className="font-medium">{t.prompt}</p><pre dir="auto" className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-control bg-surface-sunk p-2">{r.prompt}</pre></div>}
                          {r.response && <div><p className="font-medium">{t.response}</p><pre dir="auto" className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-control bg-surface-sunk p-2">{r.response}</pre></div>}
                        </>
                      )}
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {last && log.length === 100 && <Link href={`${base}?${new URLSearchParams({ ...(filter ? { status: filter } : {}), before: last.createdAt.toISOString() })}`} className="text-sm text-gulf-strong underline underline-offset-4">{t.older}</Link>}
    </section>
  );
}
