import Link from "next/link";
import { hasCapability, IMPORT_RECORD_TYPES, type SourceType } from "@baytline/core";
import { listPartnerOptions, listProjects, listSources, type SourceView } from "@baytline/developer";
import { listSourcesForReview } from "@baytline/platform";
import { actorOf, devSection } from "@/server/dev-page";
import { getDb } from "@/server/db";
import { format } from "@/i18n/format";
import { ago } from "@/lib/homes-format";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, SelectField } from "@/components/forms/Field";
import { Chip } from "@/components/ui/Chip";
import { AuthChip, HealthChip, SourcesTabs } from "@/components/sources/parts";
import { createSourceAction, decideSourceAction } from "@/server/actions/sources";
import type { Dictionary } from "@/i18n";
import type { OrgPage } from "@/server/guards";

export default async function SourcesPage({ params, searchParams }: { params: Promise<{ locale: string; orgId: string }>; searchParams: Promise<{ status?: string }> }) {
  const { locale, orgId } = await params;
  const q = await searchParams;
  const { page, allowed, section } = await devSection(locale, orgId, "sources");
  if (!allowed) return <SectionShell page={page} section={section} allowed={allowed} />;
  if (page.ctx.org.type === "platform") return <PlatformReview page={page} status={q.status} />;
  if (page.ctx.org.type !== "developer") return <SectionShell page={page} section={section} allowed={allowed} />;

  const { dict } = page;
  const t = dict.src;
  const a = actorOf(page);
  const can = (p: Parameters<typeof hasCapability>[1]) => hasCapability(page.ctx.principal, p);
  const [sources, projects, partners] = await Promise.all([
    listSources(getDb(), a),
    listProjects(getDb(), a),
    can("partner.view") ? listPartnerOptions(getDb(), a) : Promise.resolve([]),
  ]);
  const base = `/${page.locale}/o/${orgId}`;
  const canImport = can("inventory.import");
  const hidden = <><input type="hidden" name="locale" value={page.locale} /><input type="hidden" name="orgId" value={orgId} /></>;

  return (
    <div className="space-y-8">
      <SectionHeader eyebrow={page.ctx.org.name} title={dict.workspaces.developer.sections.sources.label} intro={t.intro} />
      <SourcesTabs dict={dict} base={base} current="sources" />
      <p className="rounded-control border border-line bg-surface-sunk px-4 py-3 text-sm text-ink-muted">{t.liveRule}</p>

      <ul className="grid gap-4 lg:grid-cols-2">
        {sources.map((s) => <SourceCard key={s.id} dict={dict} s={s} href={`${base}/sources/${s.id}`} locale={page.locale} />)}
      </ul>
      {sources.length === 1 && <p className="text-sm text-ink-muted">{t.add.intro}</p>}

      {canImport ? (
        <section aria-labelledby="add-source" className="space-y-4">
          <h2 id="add-source" className="text-lg">{t.add.title}</h2>
          <div className="grid gap-4">
            <AddForm dict={dict} type="file_import" hidden={hidden} projects={projects} />
            {can("partner.manage") && (
              partners.length
                ? <AddForm dict={dict} type="partner" hidden={hidden} projects={projects} partners={partners} />
                : <TypeNote dict={dict} type="partner" note={t.add.partnerNone} />
            )}
            <AddForm dict={dict} type="data_feed" hidden={hidden} projects={projects} />
            <TypeNote dict={dict} type="direct_integration" note={t.add.directNone} />
          </div>
        </section>
      ) : (
        <p className="text-sm text-ink-muted">{t.detail.readOnly}</p>
      )}
    </div>
  );
}

function SourceCard({ dict, s, href, locale }: { dict: Dictionary; s: SourceView; href: string; locale: "en" | "ar" }) {
  const t = dict.src;
  return (
    <li className="rounded-panel border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-medium"><Link href={href} className="text-gulf-strong underline-offset-4 hover:underline">{s.type === "workspace" ? t.types.workspace.name : s.name}</Link></h3>
          <p className="text-sm text-ink-muted">{t.types[s.type].name}{s.partner ? ` · ${s.partner.name}` : ""}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <AuthChip dict={dict} status={s.authorization} />
          {s.health !== "not_applicable" && <HealthChip dict={dict} health={s.health} />}
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div><dt className="text-ink-muted">{t.card.projects}</dt><dd>{s.allProjects ? t.card.allProjects : s.projects.map((p) => p.name).join(locale === "ar" ? "، " : ", ")}</dd></div>
        <div><dt className="text-ink-muted">{t.card.lastSuccess}</dt><dd>{s.lastSuccessAt ? ago(s.lastSuccessAt, locale) : t.card.never}</dd></div>
        <div><dt className="text-ink-muted">{t.card.freshness}</dt><dd>{format(t.card.hours, { n: s.freshnessHours })}</dd></div>
        {s.pendingBatches > 0 && <div><dt className="text-ink-muted">{t.tabs.imports}</dt><dd><Chip tone="attention">{format(t.card.awaiting, { n: s.pendingBatches })}</Chip></dd></div>}
        {s.trusted && <div><dt className="sr-only">{t.card.trusted}</dt><dd><Chip tone="neutral">{t.card.trusted}</Chip></dd></div>}
      </dl>
    </li>
  );
}

function TypeNote({ dict, type, note }: { dict: Dictionary; type: SourceType; note: string }) {
  return (
    <div className="rounded-panel border border-dashed border-line px-5 py-4">
      <p className="font-medium">{dict.src.types[type].name}</p>
      <p className="mt-1 text-sm text-ink-muted">{note}</p>
    </div>
  );
}

function ProjectChoice({ dict, projects, name = "projectIds", allowAll = true }: { dict: Dictionary; projects: { id: string; name: string }[]; name?: string; allowAll?: boolean }) {
  const t = dict.src.add;
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{t.projects}</legend>
      {allowAll && (
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="allProjects" value="on" className="accent-[var(--gulf)]" />{t.allProjects}</label>
      )}
      <div className="grid gap-1.5 sm:grid-cols-2">
        {projects.map((p) => (
          <label key={p.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name={name} value={p.id} className="accent-[var(--gulf)]" />{p.name}</label>
        ))}
      </div>
    </fieldset>
  );
}

function AddForm({ dict, type, hidden, projects, partners }: {
  dict: Dictionary; type: "file_import" | "partner" | "data_feed"; hidden: React.ReactNode; projects: { id: string; name: string }[];
  partners?: { id: string; name: string; projects: { id: string; name: string }[] }[];
}) {
  const t = dict.src.add;
  return (
    <details className="group rounded-panel border border-line bg-surface open:border-gulf">
      <summary className="cursor-pointer list-none px-5 py-4">
        <span className="font-medium">{dict.src.types[type].name}</span>
        <span className="mt-0.5 block text-sm text-ink-muted">{dict.src.types[type].description}</span>
      </summary>
      <div className="border-t border-line px-5 py-5">
        <ActionForm action={createSourceAction} submitLabel={t.submit} pendingLabel={t.submitting}>
          {hidden}
          <input type="hidden" name="type" value={type} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t.name} name="name" required maxLength={120} />
            <Field label={t.freshness} name="freshnessHours" type="number" min={1} max={168} inputMode="numeric" hint={t.freshnessHint} />
            <Field label={t.authorizationRef} name="authorizationRef" required maxLength={300} hint={t.authorizationHint} className="sm:col-span-2" />
          </div>
          {type === "partner" && partners ? (
            <>
              <SelectField label={t.partner} name="partnerOrgId" options={partners.map((p) => ({ value: p.id, label: p.name }))} />
              <p className="text-xs text-ink-muted">{t.partnerHint}</p>
              {/* Only projects shared with some partner; the service checks they're shared with the chosen one. */}
              <ProjectChoice dict={dict} allowAll={false}
                projects={[...new Map(partners.flatMap((p) => p.projects).map((p) => [p.id, p])).values()]} />
            </>
          ) : (
            <ProjectChoice dict={dict} projects={projects} />
          )}
          {type === "data_feed" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.feedUrl} name="feedUrl" type="url" required dir="ltr" placeholder="https://" hint={t.feedUrlHint} className="sm:col-span-2" />
              <SelectField label={t.recordType} name="recordType" options={IMPORT_RECORD_TYPES.map((r) => ({ value: r, label: dict.src.recordTypes[r] }))} />
              <Field label={t.secretName} name="secretName" dir="ltr" pattern="FEED_[A-Z0-9_]{2,60}" placeholder="FEED_" autoComplete="off" spellCheck={false} hint={t.secretHint} />
              <label className="flex items-start gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="trusted" value="on" className="mt-1 accent-[var(--gulf)]" />
                <span>{t.trusted}<span className="block text-xs text-ink-muted">{t.trustedHint}</span></span>
              </label>
            </div>
          )}
        </ActionForm>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------- platform review

async function PlatformReview({ page, status }: { page: OrgPage; status?: string }) {
  const { dict } = page;
  const t = dict.src.platform;
  const filter = status === "all" ? undefined : status || "pending_approval";
  const rows = await listSourcesForReview(getDb(), actorOf(page), { status: filter });
  const canDecide = hasCapability(page.ctx.principal, "platform.sources.manage");
  const base = `/${page.locale}/o/${page.ctx.org.id}/sources`;
  return (
    <div className="space-y-8">
      <SectionHeader eyebrow={page.ctx.org.name} title={dict.workspaces.admin.sections.sources.label} intro={t.intro} />
      <nav aria-label={t.filters.status} className="flex gap-3 text-sm">
        <Link href={base} aria-current={filter === "pending_approval" ? "page" : undefined} className="underline-offset-4 aria-[current=page]:font-medium aria-[current=page]:underline">{t.filters.pending}</Link>
        <Link href={`${base}?status=all`} aria-current={!filter ? "page" : undefined} className="underline-offset-4 aria-[current=page]:font-medium aria-[current=page]:underline">{t.filters.all}</Link>
      </nav>
      {rows.length === 0 ? (
        <p className="rounded-panel border-2 border-dashed border-line px-6 py-10 text-center text-ink-muted">{t.none}</p>
      ) : (
        <ul className="space-y-4">
          {rows.map((r) => (
            <li key={r.id} className="rounded-panel border border-line bg-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-medium">{r.name}</h2>
                  <p className="text-sm text-ink-muted">{r.orgName} · {dict.src.types[r.type].name}</p>
                </div>
                <AuthChip dict={dict} status={r.authorization as never} />
              </div>
              <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="text-ink-muted">{t.columns.host}</dt><dd dir="ltr" className="text-start">{r.host ?? "—"}</dd></div>
                <div><dt className="text-ink-muted">{t.columns.contents}</dt><dd>{r.recordType ? dict.src.recordTypes[r.recordType as keyof typeof dict.src.recordTypes] : "—"}</dd></div>
                <div><dt className="text-ink-muted">{t.columns.secrets}</dt><dd dir="ltr" className="text-start font-mono text-xs">{r.secretNames.join(", ") || "—"}</dd></div>
                <div><dt className="text-ink-muted">{t.columns.reference}</dt><dd>{r.authorizationRef ?? "—"}</dd></div>
              </dl>
              {r.trusted && <p className="mt-3"><Chip tone="attention">{t.trusted}</Chip></p>}
              {r.decisionNote && <p className="mt-3 text-sm text-ink-muted">{dict.src.detail.decision}: {r.decisionNote}</p>}
              {canDecide && (r.authorization === "pending_approval" || r.authorization === "authorized") && (
                <ActionForm action={decideSourceAction} submitLabel={dict.src.platform.approve} pendingLabel={dict.src.detail.saving} className="mt-4">
                  <input type="hidden" name="locale" value={page.locale} />
                  <input type="hidden" name="orgId" value={page.ctx.org.id} />
                  <input type="hidden" name="sourceId" value={r.id} />
                  <fieldset className="flex flex-wrap gap-4 text-sm">
                    <legend className="sr-only">{dict.src.errors.decision}</legend>
                    {(r.authorization === "pending_approval" ? (["approve", "reject"] as const) : (["suspend"] as const)).map((d, i) => (
                      <label key={d} className="flex items-center gap-2"><input type="radio" name="decision" value={d} defaultChecked={i === 0} className="accent-[var(--gulf)]" />{t[d]}</label>
                    ))}
                  </fieldset>
                  <Field label={t.note} name="note" maxLength={500} hint={t.noteRequired} />
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
