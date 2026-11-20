import Link from "next/link";
import { LEASE_STATUSES } from "@baytline/core";
import { listLeases, listPmUnits, listTenants } from "@baytline/management";
import { format } from "@/i18n/format";
import { pmSection } from "@/server/pm-page";
import { getDb } from "@/server/db";
import { createLeaseAction } from "@/server/actions/management";
import { buttonClass } from "@/lib/button";
import { day, money } from "@/lib/dev-format";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Chip } from "@/components/ui/Chip";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, SelectField } from "@/components/forms/Field";
import { Empty, Hidden, LeaseFields, leaseTone, Panel } from "@/components/pm/parts";

type Search = { q?: string; status?: string; ending?: string; renewal?: string; unitId?: string };
const WINDOWS = [30, 60, 90, 180];

export default async function LeasingPage({ params, searchParams }: { params: Promise<{ locale: string; orgId: string }>; searchParams: Promise<Search> }) {
  const { locale, orgId } = await params;
  const q = await searchParams;
  const { page, allowed, section, can, actor, base } = await pmSection(locale, orgId, "leasing");
  if (!allowed) return <SectionShell page={page} section={section} allowed={false} />;
  const { dict } = page;
  const t = dict.pm.leases;
  const canManage = can("lease.manage");
  const [leases, units, tenants] = await Promise.all([
    listLeases(getDb(), actor, { q: q.q, status: q.status, unitId: q.unitId, endingWithin: Number(q.ending) || undefined, renewalWithin: Number(q.renewal) || undefined }),
    canManage ? listPmUnits(getDb(), actor) : Promise.resolve([]),
    canManage ? listTenants(getDb(), actor) : Promise.resolve([]),
  ]);
  const filtered = Boolean(q.q || q.status || q.ending || q.renewal || q.unitId);
  const any = { value: "", label: dict.admin.any };
  const windows = [{ value: "", label: t.anyTime }, ...WINDOWS.map((n) => ({ value: String(n), label: format(t.days, { n }) }))];

  return (
    <div className="space-y-8">
      <SectionHeader eyebrow={page.ctx.org.name} title={dict.workspaces.management.sections.leasing.label} intro={t.intro} />
      <form method="get" role="search" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] lg:items-end">
        <Field label={t.searchLabel} name="q" type="search" defaultValue={q.q ?? ""} />
        <SelectField label={t.fields.status} name="status" defaultValue={q.status ?? ""} options={[any, ...LEASE_STATUSES.map((s) => ({ value: s, label: dict.pm.leaseStatuses[s] }))]} />
        <SelectField label={t.endingFilter} name="ending" defaultValue={q.ending ?? ""} options={windows} />
        <SelectField label={t.renewalFilter} name="renewal" defaultValue={q.renewal ?? ""} options={windows} />
        <div className="flex gap-2">
          <button type="submit" className={buttonClass("quiet")}>{dict.admin.search}</button>
          {filtered && <Link href={`${base}/leasing`} className="self-center text-sm text-gulf-strong underline underline-offset-4">{dict.admin.clear}</Link>}
        </div>
      </form>

      {leases.length === 0 ? (
        <Empty>{filtered ? t.noMatches : t.noLeases}</Empty>
      ) : (
        <ul className="grid gap-px overflow-hidden rounded-panel border border-line bg-line">
          {leases.map((l) => (
            <li key={l.id} className="bg-surface">
              <Link href={`${base}/leasing/${l.id}`} className="grid gap-2 px-5 py-4 hover:bg-gulf-tint sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-6">
                <span className="min-w-0">
                  <span className="font-medium text-gulf-strong">{l.tenantName}</span>
                  <span className="block text-sm text-ink-muted">{l.propertyName} · {l.unitCode}{l.reference ? ` · ${l.reference}` : ""}</span>
                </span>
                <span className="text-sm text-ink-muted">
                  {day(l.startDate, locale)} – {day(l.endDate, locale)}
                  <span className="block">{l.rentMinor ? `${money(l.rentMinor, l.currency, locale)}${l.paymentFrequency ? ` · ${dict.pm.frequencies[l.paymentFrequency]}` : ""}` : ""}</span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <Chip tone={leaseTone(l.status)}>{dict.pm.leaseStatuses[l.status]}</Chip>
                  {(l.status === "active" || l.status === "renewed") && l.daysToEnd >= 0 && l.daysToEnd <= 90 && <Chip tone="attention">{format(t.daysLeft, { n: l.daysToEnd })}</Chip>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <Panel title={t.addTitle}>
          {units.length === 0 ? (
            <p className="text-sm text-ink-muted">{dict.pm.units.noUnits}</p>
          ) : (
            <ActionForm action={createLeaseAction} submitLabel={t.create} pendingLabel={t.creating}>
              <Hidden values={{ locale: page.locale, orgId }} />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <SelectField label={t.fields.unit} name="unitId" defaultValue={q.unitId ?? ""} options={units.map((u) => ({ value: u.id, label: `${u.propertyName} · ${u.code}` }))} />
                <SelectField label={t.existingTenant} name="tenantId" defaultValue="" options={[{ value: "", label: t.newTenantTitle }, ...tenants.map((x) => ({ value: x.id, label: x.name }))]} />
              </div>
              <fieldset className="grid gap-4 rounded-control border border-line p-4 sm:grid-cols-3">
                <legend className="px-1 text-sm text-ink-muted">{t.newTenantTitle}</legend>
                <Field label={t.fields.tenantName} name="tenantName" maxLength={160} />
                {can("tenant.contact.view") && <Field label={t.fields.tenantEmail} name="tenantEmail" type="email" dir="ltr" />}
                {can("tenant.contact.view") && <Field label={t.fields.tenantPhone} name="tenantPhone" type="tel" dir="ltr" />}
              </fieldset>
              <LeaseFields dict={dict} />
            </ActionForm>
          )}
        </Panel>
      ) : (
        <p className="text-sm text-ink-muted">{dict.pm.readOnly}</p>
      )}
    </div>
  );
}
