import Link from "next/link";
import { notFound } from "next/navigation";
import { IMPORT_FIELDS } from "@baytline/core";
import { getBatch, type BatchDetail } from "@baytline/developer";
import { IdentityError } from "@baytline/identity";
import { actorOf, devSection } from "@/server/dev-page";
import { getDb } from "@/server/db";
import { format } from "@/i18n/format";
import { ago, moment } from "@/lib/homes-format";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { ActionForm } from "@/components/forms/ActionForm";
import { ConfirmAction } from "@/components/forms/ConfirmAction";
import { Field } from "@/components/forms/Field";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { BatchStatusChip, SourcesTabs, issueText, valueText } from "@/components/sources/parts";
import { applyImportAction, cancelImportAction, mapImportAction } from "@/server/actions/sources";
import type { Dictionary } from "@/i18n";

const ACTIONS = ["error", "duplicate", "conflict", "update", "create", "unchanged"] as const;
const TONE: Record<(typeof ACTIONS)[number], ChipTone> = { error: "problem", duplicate: "problem", conflict: "attention", update: "neutral", create: "good", unchanged: "muted" };

export default async function BatchPage({ params, searchParams }: {
  params: Promise<{ locale: string; orgId: string; batchId: string }>;
  searchParams: Promise<{ action?: string; page?: string }>;
}) {
  const { locale, orgId, batchId } = await params;
  const q = await searchParams;
  const { page, allowed, section, isDeveloper } = await devSection(locale, orgId, "sources");
  if (!allowed || !isDeveloper) return <SectionShell page={page} section={section} allowed={allowed} />;
  const b = await getBatch(getDb(), actorOf(page), batchId, { action: q.action, page: Number(q.page) || 1 }).catch((e) => {
    if (e instanceof IdentityError && e.code === "not_found") notFound();
    throw e;
  });
  const { dict } = page;
  const t = dict.src.batch;
  const base = `/${page.locale}/o/${orgId}`;
  const open = b.status === "submitted" || b.status === "uploaded" || b.status === "validated";
  const basis = b.options.as_of_basis as keyof typeof t.asOfBasis | undefined;
  const hidden = (
    <>
      <input type="hidden" name="locale" value={page.locale} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="batchId" value={b.id} />
    </>
  );
  const step = b.status === "validated" ? "review" : b.status === "applied" ? "confirm" : "map";

  return (
    <div className="space-y-8">
      <p><Link href={`${base}/sources/imports`} className="text-sm text-gulf-strong underline underline-offset-4">{t.back}</Link></p>
      <SectionHeader eyebrow={dict.src.recordTypes[b.recordType]} title={format(t.title, { source: b.source.name })}
        intro={format(t.meta, { rows: b.rowCount, type: dict.src.types[b.source.type].name, asOf: moment(b.asOf, page.locale) })} />
      <SourcesTabs dict={dict} base={base} current="imports" />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <BatchStatusChip dict={dict} status={b.status} />
        {basis && <span className="text-ink-muted">({t.asOfBasis[basis]})</span>}
        {b.fileName && <span dir="ltr" className="text-ink-muted">{b.fileName}</span>}
        <span className="text-ink-muted">· {ago(b.createdAt, page.locale)}{b.createdByName ? ` · ${b.createdByName}` : ""}</span>
      </div>
      {b.partnerSubmitted && <p className="rounded-control border border-line bg-surface-sunk px-4 py-3 text-sm">{format(t.partnerNote, { partner: b.source.partnerName ?? "" })}</p>}
      {b.note && <p className="text-sm"><span className="text-ink-muted">{t.note}: </span>{b.note}</p>}

      <ol className="flex flex-wrap gap-2 text-sm" aria-label={dict.src.tabs.imports}>
        {(["map", "review", "confirm"] as const).map((s, i) => (
          <li key={s} aria-current={s === step ? "step" : undefined}
            className={`rounded-chip border px-3 py-1 ${s === step ? "border-gulf font-medium text-ink" : "border-line text-ink-muted"}`}>
            {i + 1}. {t.steps[s]}
          </li>
        ))}
      </ol>

      {open && b.can.manage && <MappingForm dict={dict} b={b} hidden={hidden} />}

      {b.summary && (b.status === "validated" || b.status === "applied") && (
        <Review dict={dict} b={b} base={`${base}/sources/imports/${b.id}`} filter={q.action} />
      )}

      {b.status === "validated" && <Confirm dict={dict} b={b} hidden={hidden} locale={page.locale} />}

      {b.status === "applied" && (
        <section aria-labelledby="result" className="space-y-3 rounded-panel border border-mangrove bg-surface p-5">
          <h2 id="result" className="text-lg">{t.resultTitle}</h2>
          <p className="text-sm">{format(t.applied, {
            applied: b.summary?.["result_applied" as never] ?? 0, skipped: b.summary?.["result_skipped" as never] ?? 0, disputed: b.summary?.["result_disputed" as never] ?? 0,
            reconfirmed: b.summary?.["result_reconfirmed" as never] ?? 0, drafts: b.summary?.["result_drafts" as never] ?? 0,
          })}</p>
          {b.appliedAt && <p className="text-sm text-ink-muted">{format(t.appliedBy, { name: b.appliedByName ?? "—", when: ago(b.appliedAt, page.locale) })}</p>}
          {b.drafts.length > 0 && (
            <div>
              <h3 className="text-sm font-medium">{t.draftsTitle}</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {b.drafts.map((d) => (
                  <li key={d.id}>
                    <Link href={`${base}/projects/${d.projectId}/pricing/${d.kind === "price" ? "prices" : "plans"}/${d.id}`} className="text-gulf-strong underline underline-offset-4">
                      {t.draftKinds[d.kind]}: {d.name} v{d.version}
                    </Link>
                    <span className="ms-2 text-ink-muted">{dict.dev.pricing.statuses[d.status as keyof typeof dict.dev.pricing.statuses] ?? d.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Link href={`${base}/sources/history?batch=${b.id}`} className="inline-block text-sm text-gulf-strong underline underline-offset-4">{dict.src.tabs.history}</Link>
        </section>
      )}
    </div>
  );
}

function MappingForm({ dict, b, hidden }: { dict: Dictionary; b: BatchDetail; hidden: React.ReactNode }) {
  const t = dict.src.batch;
  const fields = IMPORT_FIELDS[b.recordType].filter((f) => !(f.key === "project" && b.options.project_id));
  const mapped = b.mapping ?? {};
  const options = [{ value: "", label: t.notMapped }, ...b.headers.map((h, i) => ({ value: String(i), label: b.sample[0]?.[i] ? `${h} (${b.sample[0][i]!.slice(0, 24)})` : h }))];
  return (
    <section aria-labelledby="map" className="rounded-panel border border-line bg-surface p-5 sm:p-6">
      <h2 id="map" className="text-lg">{t.mapTitle}</h2>
      <p className="mt-1 max-w-[75ch] text-sm text-ink-muted">{t.mapIntro}</p>
      <ActionForm action={mapImportAction} submitLabel={b.status === "validated" ? t.revalidate : t.validate} pendingLabel={t.validating} className="mt-5">
        {hidden}
        <input type="hidden" name="recordType" value={b.recordType} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map((f) => (
            <label key={f.key} className="block">
              <span className="block text-sm font-medium">
                {(t.fields as Record<string, string>)[f.key] ?? f.key}
                {f.required && <span className="ms-1 text-xs font-normal text-ink-muted">({t.required})</span>}
                {f.requiredForCreate && <span className="ms-1 text-xs font-normal text-ink-muted">({t.requiredForCreate})</span>}
              </span>
              <select name={`map_${f.key}`} defaultValue={mapped[f.key] == null ? "" : String(mapped[f.key])}
                className="mt-1 block w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink">
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          ))}
          {b.recordType === "prices" && (
            <Field label={dict.src.imports.effectiveFrom} name="effectiveFrom" type="date" required defaultValue={b.options.effective_from ?? ""} hint={dict.src.imports.effectiveFromHint} />
          )}
        </div>
      </ActionForm>
      <details className="mt-5">
        <summary className="cursor-pointer text-sm font-medium text-gulf-strong">{t.sample}</summary>
        <div className="mt-3 overflow-x-auto" dir="ltr">
          <table className="w-full text-xs">
            <thead><tr>{b.headers.map((h) => <th key={h} scope="col" className="border-b border-line px-2 py-1.5 text-start font-medium">{h}</th>)}</tr></thead>
            <tbody>{b.sample.map((r, i) => <tr key={i}>{b.headers.map((_, j) => <td key={j} className="border-b border-line px-2 py-1.5">{r[j]}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function Review({ dict, b, base, filter }: { dict: Dictionary; b: BatchDetail; base: string; filter?: string }) {
  const t = dict.src.batch;
  const s = b.summary!;
  const fieldName = (k: string) => (t.fields as Record<string, string>)[k] ?? k;
  return (
    <section aria-labelledby="review" className="space-y-4">
      <h2 id="review" className="text-lg">{t.summaryTitle}</h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {(["create", "update", "unchanged", "conflict", "duplicate", "error"] as const).map((k) => (
          <li key={k}>
            <Link href={filter === k ? base : `${base}?action=${k}`} aria-current={filter === k ? "true" : undefined}
              className={`block h-full rounded-panel border bg-surface p-4 hover:border-gulf ${filter === k ? "border-gulf" : "border-line"}`}>
              <span className="block text-sm text-ink-muted">{t.summary[k]}</span>
              <span className="mt-1 block text-2xl tabular-nums">{s[k] ?? 0}</span>
              <span className="mt-1 block text-xs text-ink-muted">{t.summaryHelp[k]}</span>
            </Link>
          </li>
        ))}
      </ul>
      {filter && <Link href={base} className="text-sm text-gulf-strong underline underline-offset-4">{t.filterAll}</Link>}
      {b.rows.length === 0 ? <p className="text-sm text-ink-muted">{t.noRows}</p> : (
        <div className="overflow-x-auto rounded-panel border border-line bg-surface">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="bg-surface-sunk text-ink-muted">
              <tr>{(["row", "record", "changes", "issues"] as const).map((c) => <th key={c} scope="col" className="px-3 py-2.5 text-start font-medium">{t.columns[c]}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {b.rows.map((r) => (
                <tr key={r.rowNo} className="align-top">
                  <td className="px-3 py-2.5 tabular-nums">{r.rowNo + 1}</td>
                  <td className="px-3 py-2.5">
                    <Chip tone={TONE[r.action]}>{t.summary[r.action]}</Chip>
                    <span className="mt-1 block">{r.targetLabel ?? <span dir="ltr" className="font-mono text-xs text-ink-muted">{r.raw.slice(0, 3).join(", ")}</span>}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    {r.changes.length ? (
                      <ul className="space-y-0.5">
                        {r.changes.map((c, i) => (
                          <li key={i}><span className="text-ink-muted">{fieldName(c.field)}: </span>
                            {c.from == null ? <span className="text-ink-muted">{t.newRecord}</span> : <bdi>{valueText(c.from)}</bdi>} → <bdi className="font-medium">{valueText(c.to)}</bdi>
                          </li>
                        ))}
                      </ul>
                    ) : <span className="text-ink-muted">—</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <ul className="space-y-0.5">
                      {r.errors.map((e, i) => <li key={`e${i}`} className="text-coral">{issueText(dict, e)}</li>)}
                      {r.warnings.map((w, i) => <li key={`w${i}`} className="text-ink-muted">{issueText(dict, w, "warnings")}</li>)}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {b.filteredCount > b.rows.length && <p className="text-xs text-ink-muted">{format(t.more, { n: b.rows.length })}</p>}
      {/* Row numbers match the spreadsheet: the header is row 1. */}
    </section>
  );
}

function Confirm({ dict, b, hidden, locale }: { dict: Dictionary; b: BatchDetail; hidden: React.ReactNode; locale: "en" | "ar" }) {
  const t = dict.src.batch;
  const s = b.summary!;
  const n = (s.create ?? 0) + (s.update ?? 0);
  const canReconfirm = b.can.confirmVerified && (s.unchanged ?? 0) > 0;
  const anything = n > 0 || (s.conflict ?? 0) > 0 || canReconfirm || (b.source.trusted && (s.unchanged ?? 0) > 0);
  const needs = (Object.keys(b.needs) as (keyof BatchDetail["needs"])[]).filter((k) => b.needs[k]);
  return (
    <section aria-labelledby="confirm" className="space-y-4 rounded-panel border border-line bg-surface p-5 sm:p-6">
      <h2 id="confirm" className="text-lg">{t.steps.confirm}</h2>
      {needs.length > 0 && <ul className="list-disc space-y-1 ps-5 text-sm">{needs.map((k) => <li key={k}>{t.needs[k]}</li>)}</ul>}
      {!anything ? <p className="text-sm text-ink-muted">{t.nothingToApply}</p> : !b.can.apply ? <p className="text-sm text-ink-muted">{t.cantApply}</p> : (
        <ActionForm action={applyImportAction} submitLabel={format(t.apply, { n })} pendingLabel={t.applying}>
          {hidden}
          <input type="hidden" name="previewHash" value={b.previewHash ?? ""} />
          {(s.conflict ?? 0) > 0 && (
            <fieldset className="space-y-2 text-sm">
              <legend className="font-medium">{t.conflictTitle}</legend>
              <label className="flex items-start gap-2"><input type="radio" name="conflictPolicy" value="skip" defaultChecked className="mt-1 accent-[var(--gulf)]" />{t.conflictSkip}</label>
              <label className="flex items-start gap-2"><input type="radio" name="conflictPolicy" value="mark_disputed" className="mt-1 accent-[var(--gulf)]" />{t.conflictDispute}</label>
            </fieldset>
          )}
          {b.source.trusted && b.recordType === "units" ? <p className="text-sm">{t.trustedNote}</p> : b.can.confirmVerified && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="confirmVerified" value="on" className="mt-1 accent-[var(--gulf)]" />
              <span>{t.confirmVerified}<span className="block text-xs text-ink-muted">{format(t.confirmVerifiedHint, { asOf: moment(b.asOf, locale) })}</span></span>
            </label>
          )}
        </ActionForm>
      )}
      <ConfirmAction trigger={t.cancel} hint={t.cancelHint} confirmLabel={t.cancel} pendingLabel={t.applying} action={cancelImportAction}>{hidden}</ConfirmAction>
    </section>
  );
}
