import Link from "next/link";
import { notFound } from "next/navigation";
import { hasCapability, IMPORT_RECORD_TYPES, NEEDS_PLATFORM_APPROVAL } from "@baytline/core";
import { getSource, listProjects } from "@baytline/developer";
import { IdentityError } from "@baytline/identity";
import { actorOf, devSection } from "@/server/dev-page";
import { getDb } from "@/server/db";
import { format } from "@/i18n/format";
import { ago } from "@/lib/homes-format";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { ActionForm } from "@/components/forms/ActionForm";
import { ConfirmAction } from "@/components/forms/ConfirmAction";
import { Field, SelectField } from "@/components/forms/Field";
import { Chip } from "@/components/ui/Chip";
import { AuthChip, BatchStatusChip, HealthChip, SourcesTabs, summaryText } from "@/components/sources/parts";
import {
  resumeSourceAction, revokeSourceAction, submitSourceAction, suspendSourceAction, syncSourceAction, updateSourceAction,
} from "@/server/actions/sources";

export default async function SourceDetailPage({ params }: { params: Promise<{ locale: string; orgId: string; sourceId: string }> }) {
  const { locale, orgId, sourceId } = await params;
  const { page, allowed, section, isDeveloper } = await devSection(locale, orgId, "sources");
  if (!allowed || !isDeveloper) return <SectionShell page={page} section={section} allowed={allowed} />;
  const a = actorOf(page);
  const s = await getSource(getDb(), a, sourceId).catch((e) => {
    if (e instanceof IdentityError && e.code === "not_found") notFound();
    throw e;
  });
  const projects = await listProjects(getDb(), a);
  const { dict } = page;
  const t = dict.src;
  const base = `/${page.locale}/o/${orgId}`;
  const isAdmin = hasCapability(page.ctx.principal, "org.settings.manage");
  const needsPlatform = NEEDS_PLATFORM_APPROVAL.includes(s.type);
  const hidden = (
    <>
      <input type="hidden" name="locale" value={page.locale} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="sourceId" value={s.id} />
    </>
  );
  const when = (d: Date | null) => (d ? ago(d, page.locale) : t.card.never);
  const title = s.type === "workspace" ? t.types.workspace.name : s.name;
  const projectChoices = s.type === "partner" ? s.projects : projects;

  return (
    <div className="space-y-8">
      <p><Link href={`${base}/sources`} className="text-sm text-gulf-strong underline underline-offset-4">{t.detail.back}</Link></p>
      <SectionHeader eyebrow={t.types[s.type].name} title={title} intro={t.types[s.type].description} />
      <SourcesTabs dict={dict} base={base} current="sources" />

      <section aria-labelledby="src-status" className="rounded-panel border border-line bg-surface p-5">
        <h2 id="src-status" className="sr-only">{t.card.connection}</h2>
        <div className="flex flex-wrap gap-1.5">
          <AuthChip dict={dict} status={s.authorization} />
          {s.health !== "not_applicable" && <HealthChip dict={dict} health={s.health} />}
          {s.trusted && <Chip tone="neutral">{t.card.trusted}</Chip>}
        </div>
        <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div><dt className="text-ink-muted">{t.card.owner}</dt><dd>{page.ctx.org.name}</dd></div>
          {s.partner && <div><dt className="text-ink-muted">{t.card.partner}</dt><dd>{s.partner.name}</dd></div>}
          <div><dt className="text-ink-muted">{t.card.projects}</dt><dd>{s.allProjects ? t.card.allProjects : s.projects.map((p) => p.name).join(page.locale === "ar" ? "، " : ", ")}</dd></div>
          <div><dt className="text-ink-muted">{t.card.lastSuccess}</dt><dd>{when(s.lastSuccessAt)}</dd></div>
          <div><dt className="text-ink-muted">{t.card.freshness}</dt><dd>{format(t.card.hours, { n: s.freshnessHours })}</dd></div>
          <div><dt className="text-ink-muted">{t.add.authorizationRef}</dt><dd>{s.authorizationRef ?? "—"}</dd></div>
          {s.authorizedAt && <div><dt className="text-ink-muted">{t.auth.authorized}</dt><dd>{s.authorizedByName ? format(t.card.authorizedBy, { name: s.authorizedByName }) : format(t.card.authorizedOn, { when: when(s.authorizedAt) })}</dd></div>}
          {s.config.url && <div className="sm:col-span-2"><dt className="text-ink-muted">{t.add.feedUrl}</dt><dd dir="ltr" className="break-all text-start">{s.config.url}</dd></div>}
          {s.config.record_type && <div><dt className="text-ink-muted">{t.add.recordType}</dt><dd>{t.recordTypes[s.config.record_type as keyof typeof t.recordTypes]}</dd></div>}
          {s.decisionNote && <div className="sm:col-span-2"><dt className="text-ink-muted">{t.detail.decision}</dt><dd>{s.decisionNote}</dd></div>}
          {s.lastError && <div className="sm:col-span-2"><dt className="text-ink-muted">{t.health.failing}</dt><dd className="text-coral">{s.lastError}</dd></div>}
        </dl>
        {s.type === "workspace" && <p className="mt-4 text-sm text-ink-muted">{t.detail.workspaceNote}</p>}
      </section>

      {needsPlatform && (
        <section aria-labelledby="src-secrets" className="space-y-2">
          <h2 id="src-secrets" className="text-lg">{t.detail.secretsTitle}</h2>
          {s.secrets.length ? (
            <ul className="space-y-1 text-sm">
              {s.secrets.map((x) => (
                <li key={x.name} className="flex flex-wrap items-center gap-2"><code dir="ltr" className="font-mono text-xs">{x.name}</code><Chip tone={x.present ? "good" : "attention"}>{x.present ? t.detail.present : t.detail.missing}</Chip></li>
              ))}
            </ul>
          ) : <p className="text-sm text-ink-muted">—</p>}
          <p className="text-xs text-ink-muted">{t.detail.secretsNote}</p>
        </section>
      )}

      {s.canManage && (
        <section aria-labelledby="src-actions" className="space-y-3">
          <h2 id="src-actions" className="sr-only">{t.detail.settings}</h2>
          <div className="flex flex-wrap items-start gap-3">
            {s.canSync && (
              <div className="space-y-1">
                <ActionForm action={syncSourceAction} submitLabel={t.detail.sync} pendingLabel={t.detail.syncing} layout="inline">{hidden}</ActionForm>
                <p className="max-w-[50ch] text-xs text-ink-muted">{t.detail.syncNote}</p>
              </div>
            )}
            {needsPlatform && (s.authorization === "draft" || s.authorization === "rejected") && (
              <ActionForm action={submitSourceAction} submitLabel={t.detail.submitApproval} pendingLabel={t.detail.saving} layout="inline">{hidden}</ActionForm>
            )}
            {s.authorization === "suspended" && (
              <ActionForm action={resumeSourceAction} submitLabel={t.detail.resume} pendingLabel={t.detail.saving} variant="quiet" layout="inline">
                {hidden}<input type="hidden" name="needsApproval" value={needsPlatform ? "yes" : "no"} />
              </ActionForm>
            )}
            {s.authorization === "authorized" && (
              <ConfirmAction trigger={t.detail.suspend} hint={t.detail.suspendHint} confirmLabel={t.detail.suspend} pendingLabel={t.detail.saving} action={suspendSourceAction}>{hidden}</ConfirmAction>
            )}
            {s.authorization !== "revoked" && isAdmin && (
              <ConfirmAction trigger={t.detail.revoke} hint={t.detail.revokeHint} confirmLabel={t.detail.revoke} pendingLabel={t.detail.saving} action={revokeSourceAction}>{hidden}</ConfirmAction>
            )}
          </div>
          {s.authorization !== "revoked" && !isAdmin && <p className="text-xs text-ink-muted">{t.detail.adminOnlyRevoke}</p>}

          {s.authorization !== "revoked" && (
            <details className="rounded-panel border border-line bg-surface open:border-gulf">
              <summary className="cursor-pointer list-none px-5 py-4 font-medium">{t.detail.settings}</summary>
              <div className="border-t border-line px-5 py-5">
                <ActionForm action={updateSourceAction} submitLabel={t.detail.save} pendingLabel={t.detail.saving}>
                  {hidden}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t.add.name} name="name" required maxLength={120} defaultValue={s.name} />
                    <Field label={t.add.freshness} name="freshnessHours" type="number" min={1} max={168} defaultValue={s.freshnessHours} hint={t.add.freshnessHint} />
                    <Field label={t.add.authorizationRef} name="authorizationRef" required maxLength={300} defaultValue={s.authorizationRef ?? ""} hint={t.add.authorizationHint} className="sm:col-span-2" />
                  </div>
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-medium">{t.add.projects}</legend>
                    {s.type !== "partner" && (
                      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="allProjects" value="on" defaultChecked={s.allProjects} className="accent-[var(--gulf)]" />{t.add.allProjects}</label>
                    )}
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {projectChoices.map((p) => (
                        <label key={p.id} className="flex items-center gap-2 text-sm">
                          <input type="checkbox" name="projectIds" value={p.id} defaultChecked={s.projects.some((x) => x.id === p.id)} className="accent-[var(--gulf)]" />{p.name}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  {s.type === "data_feed" && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label={t.add.feedUrl} name="feedUrl" type="url" required dir="ltr" defaultValue={s.config.url ?? ""} hint={t.add.feedUrlHint} className="sm:col-span-2" />
                      <SelectField label={t.add.recordType} name="recordType" defaultValue={s.config.record_type} options={IMPORT_RECORD_TYPES.map((r) => ({ value: r, label: t.recordTypes[r] }))} />
                      <Field label={t.add.secretName} name="secretName" dir="ltr" defaultValue={s.secrets[0]?.name ?? ""} pattern="FEED_[A-Z0-9_]{2,60}" autoComplete="off" spellCheck={false} hint={t.add.secretHint} />
                      <label className="flex items-start gap-2 text-sm sm:col-span-2">
                        <input type="checkbox" name="trusted" value="on" defaultChecked={s.trusted} className="mt-1 accent-[var(--gulf)]" />
                        <span>{t.add.trusted}<span className="block text-xs text-ink-muted">{t.add.trustedHint}</span></span>
                      </label>
                    </div>
                  )}
                </ActionForm>
              </div>
            </details>
          )}
        </section>
      )}
      {!s.canManage && s.type !== "workspace" && <p className="text-sm text-ink-muted">{t.detail.readOnly}</p>}

      {needsPlatform && (
        <section aria-labelledby="src-runs" className="space-y-3">
          <h2 id="src-runs" className="text-lg">{t.detail.runs}</h2>
          {s.syncRuns.length === 0 ? <p className="text-sm text-ink-muted">{t.detail.noRuns}</p> : (
            <ul className="divide-y divide-line rounded-panel border border-line bg-surface text-sm">
              {s.syncRuns.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <span className="flex items-center gap-2"><Chip tone={r.ok ? "good" : "problem"}>{r.ok ? t.health.healthy : t.health.failing}</Chip>{r.summary}</span>
                  <span className="text-ink-muted">{ago(r.startedAt, page.locale)}{r.runByName ? ` · ${r.runByName}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="src-batches" className="space-y-3">
        <h2 id="src-batches" className="text-lg">{t.detail.batches}</h2>
        {s.batches.length === 0 ? <p className="text-sm text-ink-muted">{t.detail.noBatches}</p> : (
          <ul className="divide-y divide-line rounded-panel border border-line bg-surface text-sm">
            {s.batches.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="flex flex-wrap items-center gap-2">
                  <Link href={`${base}/sources/imports/${b.id}`} className="font-medium text-gulf-strong underline-offset-4 hover:underline">{t.recordTypes[b.recordType]}</Link>
                  <BatchStatusChip dict={dict} status={b.status as never} />
                  <span className="text-ink-muted">{summaryText(dict, b.summary)}</span>
                </span>
                <span className="text-ink-muted">{ago(b.createdAt, page.locale)}{b.createdByName ? ` · ${b.createdByName}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
