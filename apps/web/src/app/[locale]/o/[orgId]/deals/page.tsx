import Link from "next/link";
import { notFound } from "next/navigation";
import { listDeals } from "@baytline/leads";
import { cxSection } from "@/server/cx-page";
import { getDb } from "@/server/db";
import { format } from "@/i18n/format";
import { ago } from "@/lib/homes-format";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Chip } from "@/components/ui/Chip";
import { ProvenanceChip } from "@/components/ui/ProvenanceChip";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, SelectField } from "@/components/forms/Field";
import { money } from "@/components/crm/parts";
import { submitClaimAction, updateDealAction } from "@/server/actions/crm";

export default async function DealsPage({ params, searchParams }: { params: Promise<{ locale: string; orgId: string }>; searchParams: Promise<{ stage?: string }> }) {
  const { locale, orgId } = await params;
  const { stage } = await searchParams;
  const { page, allowed, section, actor, base, orgType } = await cxSection(locale, orgId, "deals");
  if (orgType !== "developer" && orgType !== "brokerage") notFound();
  if (!allowed) return <SectionShell page={page} section={section} allowed={false} />;
  const filter = stage ?? "open";
  const { items, canManage, canClaim } = await listDeals(getDb(), actor, { stage: filter === "all" ? undefined : filter });
  const { dict } = page;
  const t = dict.crm.deals;
  const c = dict.crm.claims;
  const intl = page.locale;
  const link = "underline-offset-4 aria-[current=page]:font-medium aria-[current=page]:underline";
  return (
    <div className="space-y-8">
      <SectionHeader eyebrow={page.ctx.org.name} title={t.title} intro={t.intro} />
      <nav aria-label={t.title} className="flex gap-4 text-sm">
        <Link href={`${base}/deals`} aria-current={filter === "open" ? "page" : undefined} className={link}>{t.filters.open}</Link>
        <Link href={`${base}/deals?stage=all`} aria-current={filter === "all" ? "page" : undefined} className={link}>{t.filters.all}</Link>
      </nav>
      {items.length === 0 ? <p className="rounded-panel border-2 border-dashed border-line px-6 py-10 text-center text-ink-muted">{t.empty}</p> : (
        <ul className="space-y-4">
          {items.map((d) => {
            const hidden = <><input type="hidden" name="locale" value={page.locale} /><input type="hidden" name="orgId" value={orgId} /><input type="hidden" name="dealId" value={d.id} /></>;
            const closed = d.stage === "won" || d.stage === "lost";
            return (
              <li key={d.id} className="rounded-panel border border-line bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{d.projectName} · <bdi dir="ltr">{d.unitCode}</bdi></p>
                    <Link href={`${base}/leads/${d.leadId}`} className="text-sm text-gulf-strong underline underline-offset-4">{d.leadName}</Link>
                  </div>
                  <Chip tone={d.stage === "won" ? "good" : d.stage === "lost" ? "muted" : "neutral"}>{t.stages[d.stage]}</Chip>
                </div>
                <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                  <div><dt className="text-ink-muted">{t.listPrice}</dt><dd className="tabular-nums">{d.listPriceMinor ? money(d.listPriceMinor, d.currency, intl) : t.noListPrice}</dd></div>
                  <div><dt className="text-ink-muted">{t.availabilityAtOpen}</dt><dd><ProvenanceChip status={d.availabilityAtOpen} label={dict.provenance[d.availabilityAtOpen]} /></dd></div>
                  <div><dt className="text-ink-muted">{t.agreed}</dt><dd className="tabular-nums">{money(d.agreedPriceMinor, d.currency, intl)}</dd></div>
                </dl>
                {d.lostReason && <p className="mt-2 text-sm text-ink-muted">{d.lostReason}</p>}
                {d.closedAt && <p className="mt-1 text-xs text-ink-muted">{format(t.closed, { when: ago(d.closedAt, page.locale) })}</p>}
                {canManage && !closed && (
                  <ActionForm action={updateDealAction} submitLabel={t.update} pendingLabel={dict.crm.viewings.submitting} className="mt-4 border-t border-line pt-4">
                    {hidden}
                    <div className="grid gap-4 sm:grid-cols-3">
                      <SelectField label={t.stage} name="stage" defaultValue={d.stage} options={(["negotiating", "reserved", "contracted", "won", "lost"] as const).map((s) => ({ value: s, label: t.stages[s] }))} />
                      <Field label={format(t.agreedLabel, { currency: d.currency })} name="agreedPrice" inputMode="decimal" dir="ltr" hint={t.agreedHint} />
                      <Field label={t.lostReason} name="lostReason" maxLength={300} />
                    </div>
                  </ActionForm>
                )}
                {d.claim && <p className="mt-3 text-sm"><Chip tone={d.claim.status === "approved" ? "good" : d.claim.status === "submitted" ? "attention" : "muted"}>{c.statuses[d.claim.status as keyof typeof c.statuses]}</Chip> <span className="tabular-nums">{money(d.claim.amountMinor, d.currency, intl)}</span>{d.claim.decisionNote ? ` · ${d.claim.decisionNote}` : ""}</p>}
                {canClaim && d.stage === "won" && (!d.claim || d.claim.status === "rejected" || d.claim.status === "withdrawn") && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm text-gulf-strong">{c.claim}</summary>
                    <ActionForm action={submitClaimAction} submitLabel={c.submit} pendingLabel={c.submitting} className="mt-3">
                      {hidden}
                      <div className="grid gap-4 sm:grid-cols-3">
                        <SelectField label={c.basis} name="basis" options={[{ value: "percent", label: c.bases.percent }, { value: "fixed", label: c.bases.fixed }]} />
                        <Field label={c.rate} name="rate" inputMode="decimal" dir="ltr" />
                        <Field label={format(c.amount, { currency: d.currency })} name="amount" inputMode="decimal" dir="ltr" required hint={c.amountHint} />
                      </div>
                      <Field label={c.note} name="note" maxLength={500} />
                    </ActionForm>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
