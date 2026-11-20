import Link from "next/link";
import { getLease } from "@baytline/management";
import { format } from "@/i18n/format";
import { orNotFound, pmSection } from "@/server/pm-page";
import { getDb } from "@/server/db";
import { updateLeaseAction, updateTenantContactAction } from "@/server/actions/management";
import { day, money } from "@/lib/dev-format";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Chip } from "@/components/ui/Chip";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field } from "@/components/forms/Field";
import { Back, Facts, Hidden, LeaseFields, leaseTone, occupancyTone, Panel } from "@/components/pm/parts";

export default async function LeasePage({ params }: { params: Promise<{ locale: string; orgId: string; leaseId: string }> }) {
  const { locale, orgId, leaseId } = await params;
  const { page, allowed, section, base, actor } = await pmSection(locale, orgId, "leasing");
  if (!allowed) return <SectionShell page={page} section={section} allowed={false} />;
  const { dict } = page;
  const t = dict.pm.leases;
  const l = await orNotFound(getLease(getDb(), actor, leaseId));
  const live = l.status === "active" || l.status === "renewed";
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  return (
    <div className="space-y-10">
      <Back href={`${base}/leasing`} label={dict.workspaces.management.sections.leasing.label} />
      <SectionHeader eyebrow={`${l.propertyName} · ${l.unitCode}`} title={l.tenantName} intro={t.intro}>
        <div className="flex flex-wrap gap-2">
          <Chip tone={leaseTone(l.status)}>{dict.pm.leaseStatuses[l.status]}</Chip>
          {live && <Chip tone={l.daysToEnd <= 90 ? "attention" : "neutral"}>{l.daysToEnd >= 0 ? format(t.daysLeft, { n: l.daysToEnd }) : format(t.ended, { n: -l.daysToEnd })}</Chip>}
        </div>
      </SectionHeader>

      <Facts items={[
        [t.fields.unit, <Link key="u" href={`${base}/portfolio/units/${l.unitId}`} className="text-gulf-strong underline underline-offset-4">{l.propertyName} · {l.unitCode}</Link>],
        [dict.pm.units.fields.occupancy, l.unitOccupancy && <Chip tone={occupancyTone(l.unitOccupancy as never)}>{dict.pm.occupancy[l.unitOccupancy as keyof typeof dict.pm.occupancy]}</Chip>],
        [t.fields.reference, l.reference],
        [t.fields.startDate, `${day(l.startDate, locale)} – ${day(l.endDate, locale)}`],
        [t.fields.renewalDate, day(l.renewalDate, locale)],
        [t.fields.rent, l.rentMinor && `${money(l.rentMinor, l.currency, locale)}${l.paymentFrequency ? ` · ${dict.pm.frequencies[l.paymentFrequency]}` : ""}`],
        [t.fields.deposit, money(l.depositMinor, l.currency, locale)],
        [t.fields.paymentTerms, l.paymentTerms],
        [t.fields.recordedBy, `${l.createdByName ?? "—"}, ${when.format(l.createdAt)}`],
      ]} />

      <section aria-labelledby="rules-title" className="rounded-panel border border-line bg-surface-sunk p-5">
        <h2 id="rules-title" className="text-lg">{t.rulesTitle}</h2>
        <p className="mt-1 text-sm text-ink-muted">{t.rulesNote}</p>
        <ul className="mt-4 flex flex-wrap gap-3">
          {l.rules.map((r) => (
            <li key={r.category} className="flex items-center gap-2 text-sm">
              {t.ruleCategories[r.category]} <Chip tone={r.status === "configured" ? "good" : "attention"}>{t.ruleStatus[r.status]}</Chip>
            </li>
          ))}
        </ul>
      </section>

      <Panel title={t.contactTitle}>
        {l.canSeeContact && l.contact ? (
          l.canManage ? (
            <ActionForm action={updateTenantContactAction} submitLabel={t.contactSave} pendingLabel={t.saving}>
              <Hidden values={{ locale: page.locale, orgId, tenantId: l.tenantId }} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t.fields.tenantEmail} name="email" type="email" dir="ltr" defaultValue={l.contact.email ?? ""} />
                <Field label={t.fields.tenantPhone} name="phone" type="tel" dir="ltr" defaultValue={l.contact.phone ?? ""} />
              </div>
            </ActionForm>
          ) : (
            <Facts items={[[t.fields.tenantEmail, l.contact.email && <bdi dir="ltr">{l.contact.email}</bdi>], [t.fields.tenantPhone, l.contact.phone && <bdi dir="ltr">{l.contact.phone}</bdi>]]} />
          )
        ) : (
          <p className="text-sm text-ink-muted">{t.contactHidden}</p>
        )}
      </Panel>

      {l.canManage ? (
        <Panel title={t.editTitle}>
          <ActionForm action={updateLeaseAction} submitLabel={t.save} pendingLabel={t.saving}>
            <Hidden values={{ locale: page.locale, orgId, leaseId: l.id }} />
            <LeaseFields dict={dict} l={l} />
          </ActionForm>
        </Panel>
      ) : (
        <p className="text-sm text-ink-muted">{dict.pm.readOnly}</p>
      )}
    </div>
  );
}
