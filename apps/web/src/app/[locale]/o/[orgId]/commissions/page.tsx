import { notFound } from "next/navigation";
import { listClaims } from "@baytline/leads";
import { format } from "@/i18n/format";
import { cxSection } from "@/server/cx-page";
import { getDb } from "@/server/db";
import { calendarDay, moment } from "@/lib/homes-format";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field } from "@/components/forms/Field";
import { money } from "@/components/crm/parts";
import { decideClaimAction, withdrawClaimAction } from "@/server/actions/crm";

const TONE: Record<"submitted" | "approved" | "rejected" | "withdrawn", ChipTone> = { submitted: "attention", approved: "good", rejected: "problem", withdrawn: "muted" };

/** Commission claims. Brokerages see what they sent; developers decide, and the database refuses a decision by the submitter. */
export default async function CommissionsPage({ params }: { params: Promise<{ locale: string; orgId: string }> }) {
  const { locale, orgId } = await params;
  const { page, allowed, section, actor, orgType } = await cxSection(locale, orgId, "commissions");
  if (orgType !== "developer" && orgType !== "brokerage") notFound();
  if (!allowed) return <SectionShell page={page} section={section} allowed={false} />;
  const { items, side, canDecide } = await listClaims(getDb(), actor);
  const { dict } = page;
  const t = dict.crm.claims;
  const intl = page.locale;
  const day = (d: Date | null) => (d ? calendarDay(d.toISOString().slice(0, 10), intl) : "—");
  return (
    <div className="space-y-8">
      <SectionHeader eyebrow={page.ctx.org.name} title={t.title} intro={side === "developer" ? t.introDeveloper : t.introBrokerage} />
      {items.length === 0 ? <p className="rounded-panel border-2 border-dashed border-line px-6 py-10 text-center text-ink-muted">{t.empty}</p> : (
        <ul className="space-y-3">
          {items.map((k) => {
            const hidden = <><input type="hidden" name="locale" value={intl} /><input type="hidden" name="orgId" value={orgId} /><input type="hidden" name="claimId" value={k.id} /></>;
            return (
              <li key={k.id} className="rounded-panel border border-line bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{k.projectName} · {k.unitCode}</p>
                    <p className="text-sm text-ink-muted">{moment(k.submittedAt, intl)}</p>
                  </div>
                  <Chip tone={TONE[k.status]}>{t.statuses[k.status]}</Chip>
                </div>
                <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                  <div><dt className="text-ink-muted">{t.details.client}</dt><dd>{k.clientName}</dd></div>
                  {side === "developer" && <div><dt className="text-ink-muted">{t.details.brokerage}</dt><dd>{k.claimantName}</dd></div>}
                  <div><dt className="text-ink-muted">{t.details.deal}</dt><dd className="tabular-nums">{money(k.dealPriceMinor, k.currency, intl)}</dd></div>
                  <div><dt className="text-ink-muted">{t.details.amount}</dt><dd className="tabular-nums">{money(k.amountMinor, k.currency, intl)}{k.basis === "percent" && k.ratePercent ? ` (${k.ratePercent}%)` : ""}</dd></div>
                  <div className="sm:col-span-2"><dt className="sr-only">{t.details.deal}</dt><dd className="text-ink-muted">{format(t.details.protection, { from: day(k.protectedFrom), until: day(k.protectedUntil) })} · {format(t.details.dealOpened, { when: day(k.dealDate) })}</dd></div>
                </dl>
                {k.note && <p className="mt-2 text-sm">{k.note}</p>}
                {k.decisionNote && <p className="mt-2 rounded-control bg-surface-sunk px-3 py-1.5 text-sm">{k.decisionNote}</p>}
                {side === "developer" && canDecide && k.status === "submitted" && k.submittedBy !== actor.userId && (
                  <ActionForm action={decideClaimAction} submitLabel={t.decide} pendingLabel={t.deciding} className="mt-3 border-t border-line pt-3">
                    {hidden}
                    <fieldset className="flex flex-wrap gap-4 text-sm">
                      <legend className="sr-only">{t.decide}</legend>
                      <label className="flex items-center gap-2"><input type="radio" name="decision" value="approve" defaultChecked className="accent-[var(--gulf)]" />{t.approve}</label>
                      <label className="flex items-center gap-2"><input type="radio" name="decision" value="reject" className="accent-[var(--gulf)]" />{t.reject}</label>
                    </fieldset>
                    <Field label={t.decisionNote} name="note" maxLength={500} hint={t.decisionNoteHint} />
                  </ActionForm>
                )}
                {side === "brokerage" && k.status === "submitted" && (
                  <ActionForm action={withdrawClaimAction} submitLabel={t.withdraw} pendingLabel={t.submitting} variant="quiet" layout="inline" className="mt-3">{hidden}</ActionForm>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
