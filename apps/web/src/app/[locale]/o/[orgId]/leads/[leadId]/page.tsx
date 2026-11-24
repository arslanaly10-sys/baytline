import Link from "next/link";
import { notFound } from "next/navigation";
import { BAND_THRESHOLDS, LEAD_FINANCING, LEAD_STATUSES, LEAD_TIMELINES, PROPERTY_TYPES, SCORE_BANDS, SCORE_RULES } from "@baytline/core";
import { listProjects, listSharedProjects } from "@baytline/developer";
import { IdentityError } from "@baytline/identity";
import { getLead, listDeals, listRegistrations, listViewings, matchUnits } from "@baytline/leads";
import { cxSection } from "@/server/cx-page";
import { getDb } from "@/server/db";
import { format } from "@/i18n/format";
import { ago, moment } from "@/lib/homes-format";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Chip } from "@/components/ui/Chip";
import { ProvenanceChip } from "@/components/ui/ProvenanceChip";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, SelectField } from "@/components/forms/Field";
import { BandChip, inputMoney, money } from "@/components/crm/parts";
import {
  assignLeadAction, createDealAction, leadNoteAction, leadStatusAction, overrideScoreAction, registerClientAction, requirementsAction, scheduleViewingAction,
} from "@/server/actions/crm";

export default async function LeadPage({ params }: { params: Promise<{ locale: string; orgId: string; leadId: string }> }) {
  const { locale, orgId, leadId } = await params;
  const { page, allowed, section, actor, base, orgType } = await cxSection(locale, orgId, "leads");
  if (orgType !== "developer" && orgType !== "brokerage") notFound();
  if (!allowed) return <SectionShell page={page} section={section} allowed={false} />;
  const lead = await getLead(getDb(), actor, leadId).catch((e) => {
    if (e instanceof IdentityError && e.code === "not_found") notFound();
    throw e;
  });
  const db = getDb();
  const [{ matches, hasRequirements }, viewings, deals, regs, projects] = await Promise.all([
    matchUnits(db, actor, leadId),
    listViewings(db, actor, { leadId }),
    lead.can.deal || orgType === "developer" ? listDeals(db, actor, { leadId }).catch(() => ({ items: [], canManage: false, canClaim: false })) : Promise.resolve({ items: [], canManage: false, canClaim: false }),
    orgType === "brokerage" ? listRegistrations(db, actor, { leadId }) : Promise.resolve(null),
    orgType === "developer" ? listProjects(db, actor).then((p) => p.filter((x) => !x.isSample).map((x) => ({ id: x.id, name: x.name })))
      : listSharedProjects(db, actor).then((p) => p.map((x) => ({ id: x.id, name: x.name }))),
  ]);
  const { dict } = page;
  const t = dict.crm.lead;
  const L = dict.crm.leads;
  const intl = page.locale;
  const hidden = <><input type="hidden" name="locale" value={page.locale} /><input type="hidden" name="orgId" value={orgId} /><input type="hidden" name="leadId" value={lead.id} /></>;
  const r = lead.requirements;
  const activeRegs = regs?.items.filter((x) => x.state === "protected") ?? [];
  const signal = (s: string, value?: string) => {
    const v = s === "timeline" ? t.timelines[value as keyof typeof t.timelines] : s === "financing" ? t.financingLabels[value as keyof typeof t.financingLabels] : value;
    return format((t.signals as Record<string, string>)[s] ?? s, { value: v ?? "" });
  };

  return (
    <div className="space-y-8">
      <p><Link href={`${base}/leads`} className="text-sm text-gulf-strong underline underline-offset-4">{t.back}</Link></p>
      <SectionHeader eyebrow={L.sources[lead.source as keyof typeof L.sources]} title={lead.contactName} intro={lead.interest ?? undefined} />

      <div className="grid gap-4 lg:grid-cols-3">
        <section aria-labelledby="contact" className="rounded-panel border border-line bg-surface p-5">
          <h2 id="contact" className="text-lg">{t.contact}</h2>
          <dl className="mt-3 space-y-1 text-sm">
            {lead.contactEmail && <dd dir="ltr" className="text-start"><a href={`mailto:${lead.contactEmail}`} className="underline underline-offset-4">{lead.contactEmail}</a></dd>}
            {lead.contactPhone && <dd dir="ltr" className="text-start"><a href={`tel:${lead.contactPhone.replace(/[^+\d]/g, "")}`} className="underline underline-offset-4">{lead.contactPhone}</a></dd>}
            {lead.preferredContact && <dd className="text-ink-muted">{format(t.preferred, { method: t.methods[lead.preferredContact as keyof typeof t.methods] })}</dd>}
            <dd className="text-xs text-ink-muted">{format(t.consent, { when: ago(lead.consentAt, page.locale) })}</dd>
          </dl>
        </section>

        <section aria-labelledby="score" className="rounded-panel border border-line bg-surface p-5 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="score" className="text-lg">{t.score}</h2>
            <span className="flex items-center gap-2"><BandChip dict={dict} band={lead.score.band} overridden={Boolean(lead.score.override)} /><span className="tabular-nums">{format(t.scoreOf, { score: lead.score.score })}</span></span>
          </div>
          {lead.score.override && (
            <p className="mt-2 text-sm text-ink-muted">
              {format(t.overrideBy, { band: L.bands[lead.score.override.band], name: lead.score.override.byName ?? "—", reason: lead.score.override.reason })} · {format(t.computed, { band: L.bands[lead.score.computedBand] })}
            </p>
          )}
          <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
            {lead.score.lines.map((l) => (
              <li key={l.signal} className="flex justify-between gap-3 border-b border-line py-1">
                <span>{signal(l.signal, l.value)}</span><span className={`tabular-nums ${l.points < 0 ? "text-coral" : "text-mangrove"}`}>{l.points > 0 ? `+${l.points}` : l.points}</span>
              </li>
            ))}
          </ul>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-gulf-strong">{t.rules}</summary>
            <p className="mt-2 text-ink-muted">{t.rulesIntro}</p>
            <p className="mt-1 text-xs text-ink-muted" dir="ltr">
              {Object.entries(SCORE_RULES).map(([k, v]) => `${k}: ${typeof v === "number" ? v : Object.entries(v).map(([a, b]) => `${a} ${b}`).join(" / ")}`).join(" · ")} · hot ≥ {BAND_THRESHOLDS.hot}, warm ≥ {BAND_THRESHOLDS.warm}
            </p>
          </details>
          {lead.can.manage && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-gulf-strong">{t.override}</summary>
              <ActionForm action={overrideScoreAction} submitLabel={t.overrideSave} pendingLabel={dict.crm.registrations.submitting} className="mt-3">
                {hidden}
                <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
                  <SelectField label={t.overrideBand} name="band" options={SCORE_BANDS.map((b) => ({ value: b, label: L.bands[b] }))} defaultValue={lead.score.override?.band ?? lead.score.computedBand} />
                  <Field label={t.overrideReason} name="reason" required minLength={3} maxLength={300} hint={t.overrideReasonHint} />
                </div>
              </ActionForm>
              {lead.score.override && (
                <ActionForm action={overrideScoreAction} submitLabel={t.overrideClear} pendingLabel={dict.crm.registrations.submitting} variant="quiet" layout="inline" className="mt-2">
                  {hidden}<input type="hidden" name="clear" value="yes" />
                </ActionForm>
              )}
            </details>
          )}
        </section>
      </div>

      {lead.can.manage && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ActionForm action={leadStatusAction} submitLabel={t.statusSave} pendingLabel={dict.crm.registrations.submitting} className="rounded-panel border border-line bg-surface p-5">
            {hidden}
            <SelectField label={t.status} name="status" defaultValue={lead.status} options={LEAD_STATUSES.map((s) => ({ value: s, label: L.statuses[s] }))} />
            <Field label={t.lostReason} name="lostReason" maxLength={300} defaultValue={lead.lostReason ?? ""} />
          </ActionForm>
          {lead.can.assign && (
            <ActionForm action={assignLeadAction} submitLabel={t.assignSave} pendingLabel={dict.crm.registrations.submitting} className="rounded-panel border border-line bg-surface p-5">
              {hidden}
              <SelectField label={t.assign} name="assignee" defaultValue={lead.assigneeId ?? ""} options={[{ value: "", label: L.unassigned }, ...lead.members.map((m) => ({ value: m.id, label: m.name }))]} />
            </ActionForm>
          )}
        </div>
      )}

      <section aria-labelledby="req" className="space-y-3">
        <h2 id="req" className="text-lg">{t.requirements}</h2>
        <p className="text-sm text-ink-muted">{t.reqIntro}</p>
        <ActionForm action={requirementsAction} submitLabel={t.reqSave} pendingLabel={dict.crm.registrations.submitting} className="rounded-panel border border-line bg-surface p-5">
          {hidden}
          <fieldset disabled={!lead.can.manage} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t.budgetMin} name="budgetMin" inputMode="decimal" dir="ltr" defaultValue={inputMoney(r.budgetMinMinor, r.currency)} />
              <Field label={t.budgetMax} name="budgetMax" inputMode="decimal" dir="ltr" defaultValue={inputMoney(r.budgetMaxMinor, r.currency)} />
              <Field label={t.currency} name="currency" dir="ltr" maxLength={3} defaultValue={r.currency ?? lead.orgCurrency} />
              <Field label={t.bedrooms} name="bedroomsMin" type="number" min={0} max={20} defaultValue={r.bedroomsMin ?? ""} />
              <Field label={t.city} name="city" maxLength={80} defaultValue={r.city ?? ""} />
              <SelectField label={t.timeline} name="timeline" defaultValue={r.timeline} options={LEAD_TIMELINES.map((x) => ({ value: x, label: t.timelines[x] }))} />
              <SelectField label={t.financingLabel} name="financing" defaultValue={r.financing} options={LEAD_FINANCING.map((x) => ({ value: x, label: t.financingLabels[x] }))} />
            </div>
            <fieldset>
              <legend className="text-sm font-medium">{t.types}</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {PROPERTY_TYPES.map((p) => (
                  <label key={p} className="inline-flex items-center gap-2 rounded-control border border-line px-2.5 py-1.5 text-sm has-[:checked]:border-gulf">
                    <input type="checkbox" name="propertyTypes" value={p} defaultChecked={r.propertyTypes.includes(p)} className="accent-[var(--gulf)]" />{dict.dev.projects.propertyTypes[p]}
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label={t.reqNote} name="note" maxLength={1000} defaultValue={r.note ?? ""} />
          </fieldset>
        </ActionForm>
      </section>

      <section aria-labelledby="matches" className="space-y-3">
        <h2 id="matches" className="text-lg">{dict.crm.matches.title}</h2>
        <p className="text-sm text-ink-muted">{format(dict.crm.matches.intro, { scope: orgType === "developer" ? dict.crm.matches.scopeDeveloper : dict.crm.matches.scopeBrokerage })}</p>
        {!hasRequirements ? <p className="text-sm text-ink-muted">{dict.crm.matches.needRequirements}</p> : matches.length === 0 ? <p className="text-sm text-ink-muted">{dict.crm.matches.none}</p> : (
          <ul className="divide-y divide-line rounded-panel border border-line bg-surface text-sm">
            {matches.map((m) => (
              <li key={m.unitId} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-medium">{m.projectName} · <bdi dir="ltr">{m.code}</bdi></p>
                  <p className="text-xs text-ink-muted">{dict.dev.projects.propertyTypes[m.propertyType as keyof typeof dict.dev.projects.propertyTypes]}{m.bedrooms !== null ? ` · ${m.bedrooms === 0 ? dict.dev.units.studio : `${m.bedrooms} BR`}` : ""}{m.areaSqm ? ` · ${m.areaSqm} m²` : ""} · {m.city}</p>
                  <p className="mt-1 text-xs text-ink-muted">{format(dict.crm.matches.meets, { list: m.criteria.map((c) => dict.crm.matches.criteria[c.criterion]).join(page.locale === "ar" ? "، " : ", ") })}</p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <span className="tabular-nums">{m.price ? money(m.price.minor, m.price.currency, intl) : <span className="text-ink-muted">{dict.crm.matches.priceHidden}</span>}</span>
                  <ProvenanceChip status={m.availability} label={dict.provenance[m.availability]} />
                  {lead.can.deal && (
                    <ActionForm action={createDealAction} submitLabel={dict.crm.matches.deal} pendingLabel={dict.crm.deals.opening} variant="quiet" layout="inline">
                      {hidden}<input type="hidden" name="unitId" value={m.unitId} />
                      {activeRegs.filter((x) => x.projectId === m.projectId).slice(0, 1).map((x) => <input key={x.id} type="hidden" name="registrationId" value={x.id} />)}
                    </ActionForm>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="lead-viewings" className="space-y-3">
        <h2 id="lead-viewings" className="text-lg">{dict.crm.viewings.title}</h2>
        {viewings.items.length > 0 && (
          <ul className="divide-y divide-line rounded-panel border border-line bg-surface text-sm">
            {viewings.items.map((v) => (
              <li key={v.id} className="flex flex-wrap justify-between gap-2 px-4 py-3">
                <span>{v.projectName}{v.unitCode ? ` · ${v.unitCode}` : ""} · {moment(v.scheduledFor, intl, v.timeZone)}</span>
                <Chip tone={v.status === "completed" ? "good" : v.status === "scheduled" ? "neutral" : "muted"}>{dict.crm.viewings.statuses[v.status]}</Chip>
              </li>
            ))}
          </ul>
        )}
        {lead.can.viewing && projects.length > 0 && (
          <details className="rounded-panel border border-line bg-surface open:border-gulf">
            <summary className="cursor-pointer list-none px-5 py-3 text-sm font-medium">{dict.crm.viewings.schedule}</summary>
            <ActionForm action={scheduleViewingAction} submitLabel={dict.crm.viewings.submit} pendingLabel={dict.crm.viewings.submitting} className="border-t border-line px-5 py-4">
              {hidden}
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField label={dict.crm.viewings.project} name="projectId" options={projects.map((p) => ({ value: p.id, label: p.name }))} />
                <Field label={dict.crm.viewings.when} name="when" type="datetime-local" required />
              </div>
            </ActionForm>
          </details>
        )}
      </section>

      {regs && (
        <section aria-labelledby="lead-regs" className="space-y-3">
          <h2 id="lead-regs" className="text-lg">{dict.crm.registrations.titleBrokerage}</h2>
          {regs.items.length > 0 && (
            <ul className="divide-y divide-line rounded-panel border border-line bg-surface text-sm">
              {regs.items.map((x) => (
                <li key={x.id} className="flex flex-wrap justify-between gap-2 px-4 py-3">
                  <span>{x.projectName}{x.developerName ? ` · ${x.developerName}` : ""}</span>
                  <span className="flex items-center gap-2">
                    <Chip tone={x.state === "protected" ? "good" : x.state === "submitted" ? "attention" : "muted"}>{dict.crm.registrations.states[x.state]}</Chip>
                    {x.state === "protected" && x.protectedUntil && <span className="text-xs text-ink-muted">{format(dict.crm.registrations.protectedUntil, { date: moment(x.protectedUntil, intl) })}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {lead.can.register && projects.length > 0 && (
            <ActionForm action={registerClientAction} submitLabel={dict.crm.registrations.submit} pendingLabel={dict.crm.registrations.submitting} className="rounded-panel border border-line bg-surface p-5">
              {hidden}
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField label={dict.crm.registrations.project} name="projectId" options={projects.map((p) => ({ value: p.id, label: p.name }))} />
                <Field label={dict.crm.registrations.note} name="note" maxLength={500} />
              </div>
            </ActionForm>
          )}
        </section>
      )}

      {deals.items.length > 0 && (
        <section aria-labelledby="lead-deals" className="space-y-3">
          <h2 id="lead-deals" className="text-lg">{dict.crm.deals.title}</h2>
          <ul className="divide-y divide-line rounded-panel border border-line bg-surface text-sm">
            {deals.items.map((d) => (
              <li key={d.id} className="flex flex-wrap justify-between gap-2 px-4 py-3">
                <Link href={`${base}/deals`} className="underline underline-offset-4">{d.projectName} · {d.unitCode}</Link>
                <Chip tone={d.stage === "won" ? "good" : d.stage === "lost" ? "muted" : "neutral"}>{dict.crm.deals.stages[d.stage]}</Chip>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="history" className="space-y-3">
        <h2 id="history" className="text-lg">{t.history}</h2>
        {lead.can.manage && (
          <ActionForm action={leadNoteAction} submitLabel={t.noteSave} pendingLabel={dict.crm.registrations.submitting} layout="inline">
            {hidden}<Field label={t.note} name="note" required maxLength={1000} className="min-w-[16rem] flex-1" />
          </ActionForm>
        )}
        <ol className="divide-y divide-line border-y border-line text-sm">
          {lead.events.map((e) => (
            <li key={e.id} className="grid gap-1 py-2 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
              <span className="text-ink-muted">{moment(e.at, intl)}<span className="block text-xs">{e.actorName}</span></span>
              <span>
                <span className="font-medium">{(t.events as Record<string, string>)[e.kind] ?? e.kind}</span>
                {typeof e.detail.text === "string" && <span className="block whitespace-pre-line">{e.detail.text}</span>}
                {typeof e.detail.reason === "string" && <span className="block text-ink-muted">{e.detail.reason}</span>}
                {typeof e.detail.to === "string" && e.kind === "status" && <span className="text-ink-muted"> → {L.statuses[e.detail.to as keyof typeof L.statuses] ?? e.detail.to}</span>}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
